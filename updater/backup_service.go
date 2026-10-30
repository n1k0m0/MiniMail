package main

// The application can request exactly one operation from this host process:
// export this configured installation. It never receives the Docker socket,
// arbitrary command execution, host paths or plaintext backup artifacts.
import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

var backupIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
var backupOwnerPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

const backupRetention = 24 * time.Hour

type webBackupJob struct {
	ID        string    `json:"id"`
	Owner     string    `json:"owner"`
	State     string    `json:"state"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
	Bytes     int64     `json:"bytes"`
	Error     string    `json:"error,omitempty"`
}
type webBackupService struct {
	root, store, token string
	mu                 sync.Mutex
	jobs               map[string]*webBackupJob
	workers            sync.WaitGroup
	export             func(context.Context, string, string) error
	acquire            func() (func(), error)
	ctx                context.Context
}

func backupControl(root string) string { return filepath.Join(root, ".minimail/backup-control") }
func backupStore(root string) string {
	return filepath.Join(filepath.Dir(root), ".minimail-web-backups-"+hashBytes([]byte(root))[:16])
}

func loadBackupConfiguration(root string) (Config, error) {
	var c Config
	if err := readJSON(filepath.Join(root, ".minimail/config.json"), &c); err != nil {
		return c, err
	}
	if err := c.validate(); err != nil {
		return c, err
	}
	if c.Root != root {
		return c, errors.New("installation path differs from saved configuration")
	}
	if _, err := os.Lstat(filepath.Join(root, ".minimail/restore-in-progress.json")); !os.IsNotExist(err) {
		return c, errors.New("installation restore is incomplete")
	}
	return c, nil
}

func newWebBackupService(ctx context.Context, root, token string) (*webBackupService, error) {
	store := backupStore(root)
	if err := os.MkdirAll(store, 0700); err != nil {
		return nil, err
	}
	if info, err := os.Lstat(store); err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("invalid backup storage directory")
	}
	if err := securePath(store, true); err != nil {
		return nil, err
	}
	s := &webBackupService{root: root, store: store, token: token, ctx: ctx, jobs: map[string]*webBackupJob{}, acquire: func() (func(), error) { return lockInstallation(root) }}
	s.export = func(ctx context.Context, output, password string) error {
		c, err := loadBackupConfiguration(root)
		if err != nil {
			return err
		}
		if err = recoverBackupControl(ctx, root); err != nil {
			return err
		}
		if err = recoverBackupExport(ctx, c); err != nil {
			return err
		}
		engine := &Engine{Config: c, Runtime: DockerRuntime{}, Source: GitHubSource{}}
		return exportInstallation(ctx, engine, output, password)
	}
	entries, err := os.ReadDir(store)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".minimail-encrypted-") && entry.Type().IsRegular() {
			if err = os.Remove(filepath.Join(store, name)); err != nil {
				return nil, err
			}
			continue
		}
		if !strings.HasSuffix(name, ".json") || !backupIDPattern.MatchString(strings.TrimSuffix(name, ".json")) {
			continue
		}
		if !entry.Type().IsRegular() {
			return nil, errors.New("backup job metadata must be regular files")
		}
		var job webBackupJob
		if err = readJSON(filepath.Join(store, name), &job); err != nil {
			return nil, err
		}
		if job.ID+".json" != name || !backupOwnerPattern.MatchString(job.Owner) {
			return nil, errors.New("invalid backup job inventory")
		}
		if job.State == "running" {
			job.State = "failed"
			job.Error = "interrupted"
			if err = s.save(&job); err != nil {
				return nil, err
			}
		}
		s.jobs[job.ID] = &job
	}
	if err = s.expire(); err != nil {
		return nil, err
	}
	return s, nil
}
func (s *webBackupService) archive(id string) string { return filepath.Join(s.store, id+".age") }
func (s *webBackupService) save(job *webBackupJob) error {
	return writeJSON(filepath.Join(s.store, job.ID+".json"), job, 0600)
}

// Called only under mu, or before the HTTP listener starts. Unlinking an expired
// file leaves any existing authenticated download file descriptor valid.
func (s *webBackupService) expire() error {
	for id, job := range s.jobs {
		if job.State != "running" && time.Now().After(job.ExpiresAt) {
			for _, name := range []string{s.archive(id), filepath.Join(s.store, id+".json")} {
				if err := os.Remove(name); err != nil && !os.IsNotExist(err) {
					return err
				}
			}
			delete(s.jobs, id)
		}
	}
	return nil
}
func backupJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func (s *webBackupService) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	owner := r.Header.Get("X-MiniMail-Backup-Owner")
	if subtle.ConstantTimeCompare([]byte(token), []byte(s.token)) != 1 || !backupOwnerPattern.MatchString(owner) {
		backupJSON(w, 403, map[string]string{"error": "forbidden"})
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.expire(); err != nil {
		backupJSON(w, 503, map[string]string{"error": "storage"})
		return
	}
	if r.URL.Path == "/jobs" && r.Method == "GET" {
		jobs := []webBackupJob{}
		for _, job := range s.jobs {
			if job.Owner == owner {
				copy := *job
				copy.Owner = ""
				jobs = append(jobs, copy)
			}
		}
		backupJSON(w, 200, map[string]any{"configured": true, "jobs": jobs})
		return
	}
	if r.URL.Path == "/jobs" && r.Method == "POST" {
		var input struct {
			ID       string `json:"id"`
			Password string `json:"password"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			backupJSON(w, 400, map[string]string{"error": "input"})
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF || !backupIDPattern.MatchString(input.ID) || len(input.Password) < 12 || len(input.Password) > 1024 {
			backupJSON(w, 400, map[string]string{"error": "input"})
			return
		}
		if job := s.jobs[input.ID]; job != nil {
			if job.Owner != owner {
				backupJSON(w, 404, map[string]string{"error": "missing"})
				return
			}
			copy := *job
			copy.Owner = ""
			backupJSON(w, 200, copy)
			return
		}
		for _, job := range s.jobs {
			if job.State == "running" {
				backupJSON(w, 409, map[string]string{"error": "busy"})
				return
			}
		}
		if len(s.jobs) >= 3 {
			backupJSON(w, 409, map[string]string{"error": "capacity"})
			return
		}
		unlock, err := s.acquire()
		if err != nil {
			backupJSON(w, 409, map[string]string{"error": "busy"})
			return
		}
		job := &webBackupJob{ID: input.ID, Owner: owner, State: "running", CreatedAt: time.Now().UTC(), ExpiresAt: time.Now().UTC().Add(backupRetention)}
		if err = s.save(job); err != nil {
			unlock()
			backupJSON(w, 503, map[string]string{"error": "storage"})
			return
		}
		s.jobs[job.ID] = job
		copy := *job
		copy.Owner = ""
		backupJSON(w, 202, copy)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		s.workers.Add(1)
		go func(password string) {
			defer s.workers.Done()
			defer unlock()
			// Give the authenticated POST time to finish before pausing the app.
			timer := time.NewTimer(time.Second)
			defer timer.Stop()
			select {
			case <-timer.C:
			case <-s.ctx.Done():
			}
			ctx, cancel := context.WithTimeout(s.ctx, 45*time.Minute)
			defer cancel()
			err := s.export(ctx, s.archive(job.ID), password)
			diagnostic := "archive was not published"
			if err != nil {
				diagnostic = strings.ReplaceAll(err.Error(), password, "[redacted]")
			}
			password = ""
			s.mu.Lock()
			defer s.mu.Unlock()
			job.State = "failed"
			job.Error = "export"
			if err == nil {
				if info, e := os.Lstat(s.archive(job.ID)); e == nil && info.Mode().IsRegular() {
					job.State = "ready"
					job.Error = ""
					job.Bytes = info.Size()
				}
			}
			if job.State != "ready" {
				_ = os.Remove(s.archive(job.ID))
				fmt.Fprintln(os.Stderr, "Installation backup failed; job", job.ID, diagnostic)
			}
			if e := s.save(job); e != nil {
				fmt.Fprintln(os.Stderr, "Could not persist installation backup status")
			}
		}(input.Password)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/jobs/")
	if r.Method == "GET" && strings.HasSuffix(id, "/download") {
		id = strings.TrimSuffix(id, "/download")
		job := s.jobs[id]
		if !backupIDPattern.MatchString(id) || job == nil || job.Owner != owner || job.State != "ready" {
			backupJSON(w, 404, map[string]string{"error": "missing"})
			return
		}
		info, err := os.Lstat(s.archive(id))
		if err != nil || !info.Mode().IsRegular() || info.Size() != job.Bytes {
			backupJSON(w, 404, map[string]string{"error": "missing"})
			return
		}
		file, err := os.Open(s.archive(id))
		if err != nil {
			backupJSON(w, 503, map[string]string{"error": "storage"})
			return
		}
		defer file.Close()
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="minimail-server-`+job.CreatedAt.Format("2006-01-02")+`-`+id[:8]+`.age"`)
		// Streaming does not hold the job mutex or allocate the entire archive.
		s.mu.Unlock()
		defer s.mu.Lock()
		http.ServeContent(w, r, "backup.age", info.ModTime(), file)
		return
	}
	backupJSON(w, 404, map[string]string{"error": "missing"})
}

func serveWebBackups(ctx context.Context, root string) error {
	if _, err := loadBackupConfiguration(root); err != nil {
		return err
	}
	unlockDaemon, err := lockBackupDaemon(backupControl(root))
	if err != nil {
		return err
	}
	defer unlockDaemon()
	unlock, err := lockInstallation(root)
	if err != nil {
		return err
	}
	if err = recoverBackupControl(ctx, root); err != nil {
		unlock()
		return err
	}
	c, err := loadBackupConfiguration(root)
	if err == nil {
		err = recoverBackupExport(ctx, c)
	}
	if err == nil {
		engine := &Engine{Config: c, Runtime: DockerRuntime{}, Source: GitHubSource{}}
		err = engine.Recover(ctx)
	}
	if err == nil {
		// No other updater/exporter can be running while this lock is held.
		entries, e := os.ReadDir(filepath.Join(root, ".minimail/backups"))
		if e != nil {
			err = e
		} else {
			for _, entry := range entries {
				if entry.IsDir() && regexp.MustCompile(`^export-[0-9TZ.a-f-]+$`).MatchString(entry.Name()) {
					if e = os.RemoveAll(filepath.Join(root, ".minimail/backups", entry.Name())); e != nil {
						err = e
						break
					}
				}
			}
		}
	}
	if err != nil {
		unlock()
		return err
	}
	raw, err := os.ReadFile(filepath.Join(backupControl(root), "token"))
	if err != nil {
		unlock()
		return err
	}
	token := strings.TrimSpace(string(raw))
	if !backupOwnerPattern.MatchString(token) {
		unlock()
		return errors.New("invalid host backup service token")
	}
	s, err := newWebBackupService(ctx, root, token)
	if err != nil {
		unlock()
		return err
	}
	socket := filepath.Join(backupControl(root), "service.sock")
	if info, e := os.Lstat(socket); e == nil {
		if info.Mode()&os.ModeSocket == 0 {
			unlock()
			return errors.New("refusing to replace a non-socket")
		}
		_ = os.Remove(socket)
	} else if !os.IsNotExist(e) {
		unlock()
		return e
	}
	listener, err := net.Listen("unix", socket)
	if err != nil {
		unlock()
		return err
	}
	defer listener.Close()
	defer os.Remove(socket)
	if err = os.Chmod(socket, 0666); err != nil {
		unlock()
		return err
	}
	unlock()
	server := &http.Server{Handler: s, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 4096}
	done := make(chan struct{})
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_ = server.Shutdown(shutdown)
				return
			case <-done:
				return
			case <-ticker.C:
				s.mu.Lock()
				e := s.expire()
				s.mu.Unlock()
				if e != nil {
					fmt.Fprintln(os.Stderr, "Could not expire a server backup")
				}
			}
		}
	}()
	err = server.Serve(listener)
	close(done)
	<-stopped
	s.workers.Wait()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func initializeBackupControl(root string) error {
	control := backupControl(root)
	if err := os.MkdirAll(control, 0755); err != nil {
		return err
	}
	if info, err := os.Lstat(control); err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("invalid backup control directory")
	}
	if err := os.Chmod(control, 0755); err != nil {
		return err
	}
	tokenPath := filepath.Join(control, "token")
	if info, err := os.Lstat(tokenPath); err == nil {
		if !info.Mode().IsRegular() {
			return errors.New("invalid backup token")
		}
		raw, e := os.ReadFile(tokenPath)
		if e != nil || !backupOwnerPattern.MatchString(strings.TrimSpace(string(raw))) {
			return errors.New("invalid backup token")
		}
		return os.Chmod(tokenPath, 0644)
	} else if !os.IsNotExist(err) {
		return err
	}
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		return err
	}
	if err := writeNew(tokenPath, []byte(hex.EncodeToString(token))); err != nil {
		return err
	}
	return os.Chmod(tokenPath, 0644)
}

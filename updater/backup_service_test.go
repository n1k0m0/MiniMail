package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func backupRequest(s *webBackupService, method, path, owner, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+s.token)
	r.Header.Set("X-MiniMail-Backup-Owner", owner)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func backupTestService(t *testing.T) *webBackupService {
	t.Helper()
	root := filepath.Join(t.TempDir(), "installation")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	s, err := newWebBackupService(context.Background(), root, strings.Repeat("a", 64))
	if err != nil {
		t.Fatal(err)
	}
	var lock sync.Mutex
	s.acquire = func() (func(), error) {
		if !lock.TryLock() {
			return nil, errors.New("busy")
		}
		return lock.Unlock, nil
	}
	t.Cleanup(func() { s.workers.Wait() })
	return s
}
func TestWebBackupScopeEncryptionStreamingAndRecovery(t *testing.T) {
	s := backupTestService(t)
	owner := strings.Repeat("b", 64)
	id := strings.Repeat("c", 32)
	password := "synthetic-web-backup-password"
	s.export = func(ctx context.Context, output, pass string) error {
		input := filepath.Join(t.TempDir(), "archive")
		if err := os.WriteFile(input, []byte("synthetic complete server archive"), 0600); err != nil {
			return err
		}
		return encryptInstallation(input, output, pass)
	}
	// Unknown methods, unauthenticated requests and arbitrary paths cannot execute exports.
	bad := httptest.NewRecorder()
	s.ServeHTTP(bad, httptest.NewRequest("GET", "/jobs", nil))
	if bad.Code != 403 {
		t.Fatal("missing auth accepted")
	}
	if got := backupRequest(s, "POST", "/jobs", owner, `{"id":"../bad","password":"`+password+`"}`); got.Code != 400 {
		t.Fatal(got.Code)
	}
	if got := backupRequest(s, "POST", "/jobs", owner, `{"id":"`+id+`","password":"`+password+`","output":"/tmp/untrusted"}`); got.Code != 400 {
		t.Fatal(got.Code)
	}
	body := `{"id":"` + id + `","password":"` + password + `"}`
	if got := backupRequest(s, "POST", "/jobs", owner, body); got.Code != 202 {
		t.Fatal(got.Code, got.Body.String())
	}
	if got := backupRequest(s, "POST", "/jobs", owner, body); got.Code != 200 {
		t.Fatal("idempotent replay", got.Code)
	}
	if got := backupRequest(s, "POST", "/jobs", strings.Repeat("d", 64), body); got.Code != 404 {
		t.Fatal("foreign job discovered", got.Code)
	}
	if got := backupRequest(s, "POST", "/jobs", owner, strings.Replace(body, id, strings.Repeat("e", 32), 1)); got.Code != 409 {
		t.Fatal("concurrent job accepted", got.Code)
	}
	s.workers.Wait()
	status := backupRequest(s, "GET", "/jobs", owner, "")
	if !strings.Contains(status.Body.String(), `"state":"ready"`) || strings.Contains(status.Body.String(), password) || strings.Contains(status.Body.String(), owner) {
		t.Fatal(status.Body.String())
	}
	foreign := backupRequest(s, "GET", "/jobs", strings.Repeat("d", 64), "")
	if strings.Contains(foreign.Body.String(), id) {
		t.Fatal("foreign job listed")
	}
	if got := backupRequest(s, "GET", "/jobs/"+id+"/download", strings.Repeat("d", 64), ""); got.Code != 404 {
		t.Fatal("foreign download accepted")
	}
	download := backupRequest(s, "GET", "/jobs/"+id+"/download", owner, "")
	if download.Code != 200 || !bytes.HasPrefix(download.Body.Bytes(), []byte("age-encryption.org/v1")) {
		t.Fatal("download is not encrypted", download.Code)
	}
	request := httptest.NewRequest("GET", "/jobs/"+id+"/download", nil)
	request.Header.Set("Authorization", "Bearer "+s.token)
	request.Header.Set("X-MiniMail-Backup-Owner", owner)
	request.Header.Set("Range", "bytes=0-7")
	partial := httptest.NewRecorder()
	s.ServeHTTP(partial, request)
	if partial.Code != http.StatusPartialContent || partial.Body.Len() != 8 {
		t.Fatal("range download", partial.Code, partial.Body.Len())
	}
	plain := filepath.Join(t.TempDir(), "plain")
	if err := decryptInstallation(s.archive(id), plain, password); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(plain)
	if err != nil || string(raw) != "synthetic complete server archive" {
		t.Fatal("archive damaged")
	}
	for _, name := range []string{id + ".json", id + ".age"} {
		raw, err := os.ReadFile(filepath.Join(s.store, name))
		if err != nil || bytes.Contains(raw, []byte(password)) {
			t.Fatal("password persisted")
		}
	}
	// Loading after a daemon restart retains finished encrypted downloads.
	restarted, err := newWebBackupService(context.Background(), s.root, s.token)
	if err != nil {
		t.Fatal(err)
	}
	if got := backupRequest(restarted, "GET", "/jobs/"+id+"/download", owner, ""); got.Code != 200 {
		t.Fatal("restart lost archive")
	}
	restarted.jobs[id].ExpiresAt = time.Now().Add(-time.Second)
	if got := backupRequest(restarted, "GET", "/jobs/"+id+"/download", owner, ""); got.Code != 404 {
		t.Fatal("expired archive downloadable")
	}
	if _, err := os.Stat(s.archive(id)); !os.IsNotExist(err) {
		t.Fatal("expired archive not removed")
	}
}
func TestWebBackupFailuresAndInterruptedJobsHaveNoDownload(t *testing.T) {
	s := backupTestService(t)
	owner := strings.Repeat("b", 64)
	id := strings.Repeat("c", 32)
	s.export = func(ctx context.Context, output, password string) error {
		return errors.New("synthetic private failure")
	}
	if got := backupRequest(s, "POST", "/jobs", owner, `{"id":"`+id+`","password":"synthetic-long-password"}`); got.Code != 202 {
		t.Fatal(got.Code)
	}
	s.workers.Wait()
	if got := backupRequest(s, "GET", "/jobs/"+id+"/download", owner, ""); got.Code != 404 {
		t.Fatal("failed download accepted")
	}
	s.jobs[id].State = "running"
	if err := s.save(s.jobs[id]); err != nil {
		t.Fatal(err)
	}
	restarted, err := newWebBackupService(context.Background(), s.root, s.token)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.jobs[id].State != "failed" || restarted.jobs[id].Error != "interrupted" {
		t.Fatal("interrupted job remained pending")
	}
}
func TestWebBackupArchiveExcludesControlCredentials(t *testing.T) {
	root := t.TempDir()
	payload := t.TempDir()
	if err := initializeBackupControl(root); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "config"), []byte("keep config"), 0600); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "backup.tar.gz")
	if err := createInstallationArchive(root, payload, archive); err != nil {
		t.Fatal(err)
	}
	extracted := t.TempDir()
	if err := extractInstallation(archive, extracted); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(extracted, "installation/.minimail/backup-control/token")); !os.IsNotExist(err) {
		t.Fatal("runtime host credential archived")
	}
	file, err := os.Open(filepath.Join(extracted, "installation/config"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	raw, _ := io.ReadAll(file)
	if string(raw) != "keep config" {
		t.Fatal("configuration omitted")
	}
	job := webBackupJob{ID: strings.Repeat("c", 32), Owner: strings.Repeat("d", 64), State: "running", CreatedAt: time.Now(), ExpiresAt: time.Now().Add(time.Hour)}
	raw, _ = json.Marshal(job)
	if strings.Contains(string(raw), "password") {
		t.Fatal("password field in job metadata")
	}
}

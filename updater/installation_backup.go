package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"filippo.io/age"
	"golang.org/x/term"
)

const installationBackupLimit int64 = 16 << 30

type installationBackup struct {
	Format   int               `json:"format"`
	Config   Config            `json:"configuration"`
	Snapshot Snapshot          `json:"snapshot"`
	State    State             `json:"state"`
	Bindings map[string]string `json:"externalReadOnlyBindings,omitempty"`
}

func backupPassword(stdin, confirm bool) (string, error) {
	var raw []byte
	var err error
	if stdin {
		raw, err = io.ReadAll(io.LimitReader(os.Stdin, 4097))
		raw = bytes.TrimSuffix(bytes.TrimSuffix(raw, []byte("\n")), []byte("\r"))
	} else {
		if !term.IsTerminal(int(os.Stdin.Fd())) {
			return "", errors.New("use --password-stdin for a password pipe; never put passwords in command arguments")
		}
		fmt.Fprint(os.Stderr, "Backup password (at least 12 characters): ")
		raw, err = term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
	}
	if err != nil || len(raw) < 12 || len(raw) > 1024 {
		return "", errors.New("backup password must contain 12 to 1024 bytes")
	}
	if confirm && !stdin {
		fmt.Fprint(os.Stderr, "Repeat backup password: ")
		repeated, e := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		if e != nil || !bytes.Equal(raw, repeated) {
			return "", errors.New("backup passwords do not match")
		}
	}
	return string(raw), nil
}

// Authenticate the entire encrypted stream before parsing any archive entries.
func decryptInstallation(source, destination, password string) error {
	identity, err := age.NewScryptIdentity(password)
	if err != nil {
		return err
	}
	identity.SetMaxWorkFactor(18)
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	reader, err := age.Decrypt(input, identity)
	if err != nil {
		return errors.New("incorrect backup password or damaged installation backup")
	}
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer output.Close()
	n, err := io.Copy(output, io.LimitReader(reader, installationBackupLimit+1))
	if err != nil || n > installationBackupLimit {
		return errors.New("damaged, incomplete or oversized installation backup")
	}
	return output.Sync()
}

func encryptInstallation(source, destination, password string) error {
	recipient, err := age.NewScryptRecipient(password)
	if err != nil {
		return err
	}
	recipient.SetWorkFactor(18)
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	if stat, e := input.Stat(); e != nil || stat.Size() > installationBackupLimit {
		return errors.New("installation backup exceeds 16 GiB")
	}
	file, err := os.CreateTemp(filepath.Dir(destination), ".minimail-encrypted-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if err = securePath(file.Name(), false); err != nil {
		return err
	}
	writer, err := age.Encrypt(file, recipient)
	if err != nil {
		return err
	}
	if _, err = io.Copy(writer, input); err != nil {
		return err
	}
	if err = writer.Close(); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	// A completed archive is published without replacing an older backup.
	if err = os.Link(file.Name(), destination); err != nil {
		return err
	}
	syncDirectory(filepath.Dir(destination))
	return nil
}

func archiveTree(writer *tar.Writer, folder, prefix string, skip func(string) bool) error {
	return filepath.Walk(folder, func(name string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(folder, name)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		relative = filepath.ToSlash(relative)
		if skip != nil && skip(relative) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !info.IsDir() && !info.Mode().IsRegular() {
			return errors.New("installation backup refuses symlinks and special files; replace them with private regular files first")
		}
		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		header.Name = prefix + "/" + relative
		// Names and owner IDs from the original machine do not belong in the archive.
		header.Uname, header.Gname, header.Uid, header.Gid = "", "", 0, 0
		if err = writer.WriteHeader(header); err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		input, err := os.Open(name)
		if err != nil {
			return err
		}
		_, err = io.Copy(writer, input)
		closeErr := input.Close()
		if err != nil {
			return err
		}
		return closeErr
	})
}

func createInstallationArchive(root, payload, destination string) error {
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer output.Close()
	compressed := gzip.NewWriter(output)
	archive := tar.NewWriter(compressed)
	skip := func(relative string) bool {
		return relative == ".git" || relative == "node_modules" || relative == ".minimail/backups" || relative == ".minimail/update.lock" || relative == ".minimail/backup-export.json" || relative == ".minimail/backup-control"
	}
	if err = archiveTree(archive, root, "installation", skip); err != nil {
		return err
	}
	if err = archiveTree(archive, payload, "payload", nil); err != nil {
		return err
	}
	if err = archive.Close(); err != nil {
		return err
	}
	if err = compressed.Close(); err != nil {
		return err
	}
	return output.Sync()
}

func extractInstallation(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	compressed, err := gzip.NewReader(input)
	if err != nil {
		return err
	}
	defer compressed.Close()
	reader := tar.NewReader(compressed)
	var total int64
	count := 0
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		name := header.Name
		if !filepath.IsLocal(name) || strings.ContainsAny(name, "\\:\x00") || (name != "installation" && name != "payload" && !strings.HasPrefix(name, "installation/") && !strings.HasPrefix(name, "payload/")) || filepath.ToSlash(filepath.Clean(name)) != strings.TrimSuffix(name, "/") {
			return errors.New("unsafe installation backup path")
		}
		count++
		if count > 100000 || header.Size < 0 || header.Size > installationBackupLimit-total {
			return errors.New("installation backup exceeds extraction limits")
		}
		total += header.Size
		target := filepath.Join(destination, filepath.FromSlash(name))
		if header.Typeflag == tar.TypeDir {
			if err = os.MkdirAll(target, 0700); err != nil {
				return err
			}
			if err = os.Chmod(target, os.FileMode(header.Mode)&0777); err != nil {
				return err
			}
			continue
		}
		if header.Typeflag != tar.TypeReg {
			return errors.New("installation backup contains a link or special file")
		}
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, os.FileMode(header.Mode)&0777)
		if err != nil {
			return err
		}
		n, err := io.Copy(output, reader)
		closeErr := output.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		if n != header.Size {
			return io.ErrUnexpectedEOF
		}
	}
	// Force gzip's final checksum/trailer verification, too.
	_, err = io.Copy(io.Discard, compressed)
	return err
}

func namedPersistent(spec map[string]any, name, target string) error {
	service, err := service(spec, name)
	if err != nil {
		return err
	}
	volumes, _ := service["volumes"].([]any)
	for _, value := range volumes {
		mount, _ := value.(map[string]any)
		if mount["target"] == target && mount["type"] == "volume" {
			return nil
		}
	}
	return errors.New("installation backup currently requires named Docker volumes for application data and MySQL; use the portable application backup for custom bind-mounted storage")
}

func contained(root, name string) bool {
	relative, err := filepath.Rel(root, name)
	return err == nil && filepath.IsLocal(relative)
}
func validateBackupMounts(c Config, spec map[string]any) error {
	if err := namedPersistent(spec, "minimail", "/app/data"); err != nil {
		return err
	}
	if err := namedPersistent(spec, "database", "/var/lib/mysql"); err != nil {
		return err
	}
	paths := append([]string{c.EnvFile}, c.ComposeFiles...)
	for _, name := range paths {
		if !contained(c.Root, name) {
			return errors.New("installation configuration must be inside the installation directory")
		}
	}
	services, _ := spec["services"].(map[string]any)
	for serviceName, value := range services {
		s, _ := value.(map[string]any)
		mounts, _ := s["volumes"].([]any)
		for _, value := range mounts {
			m, _ := value.(map[string]any)
			if m["type"] == "volume" && !((serviceName == "minimail" && m["target"] == "/app/data") || (serviceName == "database" && m["target"] == "/var/lib/mysql")) {
				return errors.New("additional named volumes require a separate verified backup; installation export refuses to omit them")
			}
			if m["type"] == "bind" {
				source, _ := m["source"].(string)
				if readOnly, _ := m["read_only"].(bool); !contained(c.Root, source) && !readOnly {
					return errors.New("writable external bind mounts require a separate verified backup; installation export refuses to omit them")
				}
			}
		}
	}
	return nil
}

func recoverBackupExport(ctx context.Context, c Config) error {
	filename := filepath.Join(c.Root, ".minimail/backup-export.json")
	var saved struct {
		AppID string `json:"appId"`
	}
	if err := readJSON(filename, &saved); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	info, err := inspect(ctx, saved.AppID)
	if err != nil {
		return err
	}
	if info.Config.Labels["com.docker.compose.project"] != c.Project || info.Config.Labels["com.docker.compose.service"] != "minimail" {
		return errors.New("backup recovery refuses an unrelated application container")
	}
	if _, err = docker(ctx, "start", saved.AppID); err != nil {
		return err
	}
	return os.Remove(filename)
}

func exportInstallation(ctx context.Context, engine *Engine, output, password string) (err error) {
	if output == "" {
		return errors.New("--output is required")
	}
	output, err = filepath.Abs(output)
	if err != nil {
		return err
	}
	if contained(engine.Config.Root, output) {
		return errors.New("store the encrypted installation backup outside the installation directory")
	}
	if _, err = os.Lstat(output); !os.IsNotExist(err) {
		return errors.New("backup destination already exists or cannot be checked")
	}
	if err = engine.Recover(ctx); err != nil {
		return err
	}
	c := engine.Config
	d := DockerRuntime{}
	snapshot, err := d.Snapshot(ctx, c)
	if err != nil {
		return err
	}
	if err = validateBackupMounts(c, snapshot.Compose); err != nil {
		return err
	}
	state, err := engine.loadState()
	if err != nil {
		return err
	}
	protected, err := protectedFiles(c)
	if err != nil {
		return err
	}
	folder := engine.path(filepath.Join("backups", "export-"+nextID(time.Now())))
	if err = os.Mkdir(folder, 0700); err != nil {
		return err
	}
	defer os.RemoveAll(folder)
	payload := filepath.Join(folder, "payload")
	if err = os.Mkdir(payload, 0700); err != nil {
		return err
	}
	spec := cloneSpec(snapshot.Compose)
	services, _ := spec["services"].(map[string]any)
	images := map[string]bool{}
	for name, value := range services {
		id, e := containerID(ctx, c, name)
		if e != nil {
			return e
		}
		info, e := inspect(ctx, id)
		if e != nil {
			return e
		}
		image := info.Image
		images[image] = true
		s := value.(map[string]any)
		s["image"] = image
		s["pull_policy"] = "never"
		delete(s, "build")
	}
	// Pin every service, including optional VPN/reverse proxy containers. Images
	// are included so a recovery does not depend on registry availability.
	snapshot.Compose = spec
	manifest := installationBackup{Format: 1, Config: c, Snapshot: snapshot, State: state, Bindings: map[string]string{}}
	if err = backupConfiguration(payload, protected); err != nil {
		return err
	}
	journal := engine.path("backup-export.json")
	if err = writeJSON(journal, map[string]string{"appId": snapshot.AppID}, 0600); err != nil {
		return err
	}
	defer func() {
		recovery, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
		defer cancel()
		if e := recoverBackupExport(recovery, c); err == nil {
			err = e
		}
	}()
	fmt.Fprintln(os.Stderr, "Stopping MiniMail briefly to create and verify a consistent backup …")
	if err = d.Stop(ctx, snapshot); err != nil {
		return err
	}
	transaction := Transaction{Format: 1, Backup: payload, Snapshot: snapshot, Before: state}
	if err = d.Backup(ctx, c, transaction); err != nil {
		return err
	}
	if err = assertProtected(c, protected); err != nil {
		return err
	}
	if err = recoverBackupExport(ctx, c); err != nil {
		return err
	}
	for _, value := range services {
		settings := value.(map[string]any)
		mounts, _ := settings["volumes"].([]any)
		for _, value := range mounts {
			mount, _ := value.(map[string]any)
			source, _ := mount["source"].(string)
			if mount["type"] != "bind" || contained(c.Root, source) {
				continue
			}
			if _, exists := manifest.Bindings[source]; exists {
				continue
			}
			id := hashBytes([]byte(source))
			destination := filepath.Join(payload, "binds", id, "data")
			resolved, e := filepath.EvalSymlinks(source)
			if e != nil {
				return e
			}
			before, e := backupFingerprint(resolved)
			if e != nil {
				return e
			}
			if e = copyBackupPath(resolved, destination); e != nil {
				return e
			}
			after, e := backupFingerprint(resolved)
			if e != nil {
				return e
			}
			copied, e := backupFingerprint(destination)
			if e != nil {
				return e
			}
			if before != after || before != copied {
				return errors.New("external read-only configuration changed while being copied; backup was not published")
			}
			manifest.Bindings[source] = id
		}
	}
	if err = writeJSON(filepath.Join(payload, "manifest.json"), manifest, 0600); err != nil {
		return err
	}
	args := []string{"image", "save"}
	for image := range images {
		args = append(args, image)
	}
	if _, err = artifact(ctx, filepath.Join(payload, "images.tar"), args...); err != nil {
		return err
	}
	archive := filepath.Join(folder, "installation.tar.gz")
	if err = createInstallationArchive(c.Root, payload, archive); err != nil {
		return err
	}
	if err = validateDataArchive(filepath.Join(payload, "app-data.tar.gz")); err != nil {
		return err
	}
	if err = assertProtected(c, protected); err != nil {
		return err
	}
	if err = encryptInstallation(archive, output, password); err != nil {
		return err
	}
	fmt.Fprintln(os.Stderr, "Encrypted installation backup created; MySQL restore comparison passed. Keep its password separately.")
	return nil
}

func restoreInstallation(ctx context.Context, root, source, password string, confirmed bool) error {
	if !confirmed || source == "" {
		return errors.New("restore requires --input and --confirm-restore; it only accepts an empty installation directory")
	}
	root, err := safeRoot(root)
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	if len(entries) != 0 {
		return errors.New("refusing restore: destination must be completely empty; existing data/configuration will not be overwritten")
	}
	folder, err := os.MkdirTemp("", "minimail-installation-restore-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(folder)
	if err = securePath(folder, true); err != nil {
		return err
	}
	plaintext := filepath.Join(folder, "archive.tar.gz")
	if err = decryptInstallation(source, plaintext, password); err != nil {
		return err
	}
	extracted := filepath.Join(folder, "extracted")
	if err = os.Mkdir(extracted, 0700); err != nil {
		return err
	}
	if err = extractInstallation(plaintext, extracted); err != nil {
		return err
	}
	payload := filepath.Join(extracted, "payload")
	var backup installationBackup
	if err = readJSON(filepath.Join(payload, "manifest.json"), &backup); err != nil {
		return err
	}
	c := backup.Config
	if backup.Format != 1 || c.Root != root {
		return errors.New("installation backups require the original absolute installation path; use the application backup for migration to a different path")
	}
	if err = c.validate(); err != nil {
		return err
	}
	if err = validateBackupMounts(c, backup.Snapshot.Compose); err != nil {
		return err
	}
	ids, err := docker(ctx, "ps", "-aq", "--filter", "label=com.docker.compose.project="+c.Project)
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(ids))) != 0 {
		return errors.New("refusing restore: this Compose project still has containers")
	}
	volumes, _ := backup.Snapshot.Compose["volumes"].(map[string]any)
	for key, value := range volumes {
		volume, _ := value.(map[string]any)
		if external, _ := volume["external"].(bool); external {
			return errors.New("refusing restore into an external Docker volume")
		}
		name, _ := volume["name"].(string)
		if name == "" {
			name = c.Project + "_" + key
		}
		if _, e := docker(ctx, "volume", "inspect", name); e == nil {
			return errors.New("refusing restore: a target Docker volume already exists")
		}
	}
	var verified struct {
		DatabaseSHA256      string `json:"databaseSHA256"`
		AppDataSHA256       string `json:"appDataSHA256"`
		RestoredAndCompared bool   `json:"restoredAndCompared"`
		VerifiedAt          string `json:"verifiedAt"`
	}
	if err = readJSON(filepath.Join(payload, "verified.json"), &verified); err != nil {
		return err
	}
	for name, expected := range map[string]string{"database.sql.gz": verified.DatabaseSHA256, "app-data.tar.gz": verified.AppDataSHA256} {
		if !verified.RestoredAndCompared {
			return errors.New("backup has no restore verification")
		}
		actual, e := hashFile(filepath.Join(payload, name))
		if e != nil {
			return e
		}
		if actual != expected {
			return errors.New("backup artifact checksum differs")
		}
	}
	if err = validateDataArchive(filepath.Join(payload, "app-data.tar.gz")); err != nil {
		return err
	}
	// Restoring only creates new resources; never run this against a live database.
	imageFile, err := os.Open(filepath.Join(payload, "images.tar"))
	if err != nil {
		return err
	}
	defer imageFile.Close()
	load := exec.CommandContext(ctx, "docker", "image", "load")
	load.Stdin = imageFile
	if err = load.Run(); err != nil {
		return errors.New("could not load recovery images")
	}
	if err = os.Mkdir(filepath.Join(root, ".minimail"), 0700); err != nil {
		return err
	}
	unlock, err := lockInstallation(root)
	if err != nil {
		return err
	}
	defer unlock()
	if err = writeJSON(filepath.Join(root, ".minimail/restore-in-progress.json"), map[string]any{"startedAt": time.Now().UTC(), "source": source}, 0600); err != nil {
		return err
	}
	if err = copyInstallationTree(filepath.Join(extracted, "installation"), root); err != nil {
		return err
	}
	// Runtime sockets and host-service credentials are intentionally not archived.
	// Keep a configured read-only bind usable; reinstall the host service after recovery.
	if err = os.MkdirAll(backupControl(root), 0755); err != nil {
		return err
	}
	if err = os.Chmod(backupControl(root), 0755); err != nil {
		return err
	}
	for source, id := range backup.Bindings {
		if id != hashBytes([]byte(source)) || contained(root, source) {
			return errors.New("invalid external configuration inventory")
		}
		if err = copyBackupPath(filepath.Join(payload, "binds", id, "data"), filepath.Join(root, ".minimail/restored-binds", id, "data")); err != nil {
			return err
		}
	}
	for _, value := range backup.Snapshot.Compose["services"].(map[string]any) {
		settings := value.(map[string]any)
		mounts, _ := settings["volumes"].([]any)
		for _, value := range mounts {
			mount, _ := value.(map[string]any)
			source, _ := mount["source"].(string)
			if mount["type"] == "bind" && !contained(root, source) {
				id, exists := backup.Bindings[source]
				if !exists {
					return errors.New("external configuration is missing from the backup")
				}
				mount["source"] = filepath.Join(root, ".minimail/restored-binds", id, "data")
			}
		}
	}
	if err = ensureStateDir(root); err != nil {
		return err
	}
	// Earlier update snapshots and images are not part of this standalone
	// recovery point. Do not advertise an unavailable rollback target.
	backup.State.Previous = nil
	backup.State.Backup = ""
	// docker image save/load preserves the image ID, but registry digest aliases
	// are not guaranteed. Future failure recovery must resolve the restored image
	// even when the original registry is unavailable.
	backup.State.Current.Image = backup.Snapshot.AppImage
	if err = writeJSON(filepath.Join(root, ".minimail/state.json"), backup.State, 0600); err != nil {
		return err
	}
	restoreCompose := filepath.Join(root, ".minimail/restore.compose.json")
	if err = writeJSON(restoreCompose, escaped(backup.Snapshot.Compose), 0600); err != nil {
		return err
	}
	if _, err = docker(ctx, append(frozenArgs(c, restoreCompose), "up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180", "database")...); err != nil {
		return fmt.Errorf("starting the recovery database: %w", err)
	}
	dbID, err := containerID(ctx, c, "database")
	if err != nil {
		return err
	}
	file, err := os.Open(filepath.Join(payload, "database.sql.gz"))
	if err != nil {
		return err
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gz.Close()
	importSQL := exec.CommandContext(ctx, "docker", "exec", "-i", dbID, "sh", "-c", `MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --max-allowed-packet=128M -u "$MYSQL_USER" "$MYSQL_DATABASE"`)
	importSQL.Stdin = gz
	if err = importSQL.Run(); err != nil {
		return errors.New("database recovery failed; the restored application has not been started")
	}
	dbInfo, err := inspect(ctx, dbID)
	if err != nil {
		return err
	}
	expected := map[string]tableRecord{}
	if err = readJSON(filepath.Join(payload, "database-inventory.json"), &expected); err != nil {
		return err
	}
	actual, err := inventory(ctx, dbID, envMap(dbInfo.Config.Env)["MYSQL_DATABASE"], false)
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(expected, actual) {
		return errors.New("restored database differs from backup; application remains stopped")
	}
	// Expire sessions in a recovered installation, including sessions from before
	// a password reset performed after the backup was made.
	if _, err = sql(ctx, dbID, "DELETE FROM sessions"); err != nil {
		return err
	}
	if _, err = docker(ctx, append(frozenArgs(c, restoreCompose), "create", "--no-build", "--pull", "never", "minimail")...); err != nil {
		return fmt.Errorf("creating the stopped recovery application: %w", err)
	}
	appID, err := containerID(ctx, c, "minimail")
	if err != nil {
		return err
	}
	data, err := os.Open(filepath.Join(payload, "app-data.tar.gz"))
	if err != nil {
		return err
	}
	defer data.Close()
	command := exec.CommandContext(ctx, "docker", "run", "--rm", "-i", "--network", "none", "--read-only", "--user", "0:0", "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "FOWNER", "--cap-add", "DAC_OVERRIDE", "--security-opt", "no-new-privileges:true", "--volumes-from", appID, "--entrypoint", "tar", backup.Snapshot.AppImage, "-xzf", "-", "-C", "/app/data")
	command.Stdin = data
	if err = command.Run(); err != nil {
		return errors.New("application data recovery failed; application remains stopped")
	}
	// Keep the original private Compose files byte-identical. A separate owned
	// override pins all recovered images without changing private configuration.
	ownedOverride := map[string]any{}
	currentOverride := filepath.Join(root, ".minimail/current.compose.json")
	if err = readJSON(currentOverride, &ownedOverride); err != nil && !os.IsNotExist(err) {
		return err
	}
	pinned, _ := ownedOverride["services"].(map[string]any)
	if pinned == nil {
		pinned = map[string]any{}
		ownedOverride["services"] = pinned
	}
	for name, value := range backup.Snapshot.Compose["services"].(map[string]any) {
		s := value.(map[string]any)
		settings, _ := pinned[name].(map[string]any)
		if settings == nil {
			settings = map[string]any{}
			pinned[name] = settings
		}
		settings["image"] = s["image"]
		settings["pull_policy"] = "never"
		// Preserve the original private Compose bytes while redirecting recovered
		// external read-only mounts to their private copies inside this root.
		serviceMounts, _ := s["volumes"].([]any)
		for _, value := range serviceMounts {
			mount, _ := value.(map[string]any)
			source, _ := mount["source"].(string)
			if mount["type"] != "bind" || !contained(filepath.Join(root, ".minimail/restored-binds"), source) {
				continue
			}
			owned, _ := settings["volumes"].([]any)
			filtered := []any{}
			for _, item := range owned {
				old, _ := item.(map[string]any)
				if old["target"] != mount["target"] {
					filtered = append(filtered, item)
				}
			}
			settings["volumes"] = append(filtered, mount)
		}
	}
	if err = writeJSON(currentOverride, ownedOverride, 0600); err != nil {
		return err
	}
	if _, err = docker(ctx, append(composeArgs(c, configuredFiles(c)), "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180")...); err != nil {
		return fmt.Errorf("starting recovered services: %w", err)
	}
	if _, err = (DockerRuntime{}).Snapshot(ctx, c); err != nil {
		return err
	}
	if err = os.Remove(filepath.Join(root, ".minimail/restore-in-progress.json")); err != nil {
		return err
	}
	fmt.Fprintln(os.Stderr, "Installation restored and healthy. All users must sign in again. Reinstall the update timer separately if required.")
	return nil
}

func copyInstallationTree(source, destination string) error {
	return filepath.Walk(source, func(name string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(source, name)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		target := filepath.Join(destination, relative)
		if info.IsDir() {
			if err = os.MkdirAll(target, 0700); err != nil {
				return err
			}
			return os.Chmod(target, info.Mode().Perm())
		}
		input, err := os.Open(name)
		if err != nil {
			return err
		}
		defer input.Close()
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm())
		if err != nil {
			return err
		}
		_, err = io.Copy(output, input)
		closeErr := output.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		return os.Chmod(target, info.Mode().Perm())
	})
}

func copyBackupPath(source, destination string) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
		return err
	}
	if info.IsDir() {
		if err = os.Mkdir(destination, info.Mode().Perm()); err != nil {
			return err
		}
		if err = os.Chmod(destination, info.Mode().Perm()); err != nil {
			return err
		}
		return copyInstallationTree(source, destination)
	}
	if !info.Mode().IsRegular() {
		return errors.New("backup refuses a link or special configuration file")
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm())
	if err != nil {
		return err
	}
	_, err = io.Copy(output, input)
	closed := output.Close()
	if err != nil {
		return err
	}
	if closed != nil {
		return closed
	}
	return os.Chmod(destination, info.Mode().Perm())
}

func backupFingerprint(root string) (string, error) {
	hash := sha256.New()
	err := filepath.Walk(root, func(name string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, name)
		if err != nil {
			return err
		}
		fmt.Fprintf(hash, "%s\x00%d\x00", relative, info.Mode().Perm())
		if info.IsDir() {
			return nil
		}
		if !info.Mode().IsRegular() {
			return errors.New("backup refuses a link or special configuration file")
		}
		digest, err := hashFile(name)
		if err != nil {
			return err
		}
		fmt.Fprint(hash, digest, "\x00")
		return nil
	})
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func hashFile(name string) (string, error) {
	file, err := os.Open(name)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func validateDataArchive(name string) error {
	input, err := os.Open(name)
	if err != nil {
		return err
	}
	defer input.Close()
	gz, err := gzip.NewReader(input)
	if err != nil {
		return err
	}
	defer gz.Close()
	reader := tar.NewReader(gz)
	var total int64
	count := 0
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		name := strings.TrimPrefix(header.Name, "./")
		name = strings.TrimSuffix(name, "/")
		if name == "" && header.Name == "./" {
			name = "."
		}
		if name != "." && (!filepath.IsLocal(name) || strings.ContainsAny(name, "\\:\x00") || filepath.ToSlash(filepath.Clean(name)) != name) {
			return errors.New("unsafe application data path in backup")
		}
		if header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeDir {
			return errors.New("application data backup contains a link or special file")
		}
		count++
		if header.Size < 0 || header.Size > installationBackupLimit-total || count > 100000 {
			return errors.New("application data backup exceeds extraction limits")
		}
		total += header.Size
	}
	_, err = io.Copy(io.Discard, gz)
	return err
}

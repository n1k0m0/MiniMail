package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"
)

type DockerRuntime struct{ fixtureImages map[string]string }

func (d DockerRuntime) reference(image string) string {
	if v := d.fixtureImages[image]; v != "" {
		return v
	}
	return image
}

func docker(ctx context.Context, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, "docker", args...)
	var out, stderr bytes.Buffer
	command.Stdout = &out
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		return nil, fmt.Errorf("Docker %s failed (%v); private command output is withheld", args[0], err)
	}
	if out.Len() > 32<<20 {
		return nil, errors.New("Docker response exceeds limit")
	}
	return out.Bytes(), nil
}
func composeArgs(c Config, files []string) []string {
	args := []string{"compose", "--project-name", c.Project, "--project-directory", c.Root, "--env-file", c.EnvFile}
	for _, file := range files {
		args = append(args, "-f", file)
	}
	return args
}
func configuredFiles(c Config) []string {
	files := append([]string{}, c.ComposeFiles...)
	if _, e := os.Stat(filepath.Join(c.Root, ".minimail/current.compose.json")); e == nil {
		files = append(files, filepath.Join(c.Root, ".minimail/current.compose.json"))
	}
	return files
}
func frozenArgs(c Config, file string) []string {
	c.EnvFile = filepath.Join(c.Root, ".minimail/empty.env")
	return composeArgs(c, []string{file})
}
func containerID(ctx context.Context, c Config, service string) (string, error) {
	raw, e := docker(ctx, "ps", "-aq", "--filter", "label=com.docker.compose.project="+c.Project, "--filter", "label=com.docker.compose.service="+service, "--filter", "label=com.docker.compose.oneoff=False")
	if e != nil {
		return "", e
	}
	ids := strings.Fields(string(raw))
	if len(ids) != 1 {
		return "", fmt.Errorf("expected exactly one %s container, got %d", service, len(ids))
	}
	return ids[0], nil
}

type containerInfo struct {
	ID     string `json:"Id"`
	Image  string `json:"Image"`
	Config struct {
		Env    []string          `json:"Env"`
		Labels map[string]string `json:"Labels"`
		User   string            `json:"User"`
	} `json:"Config"`
	State struct {
		Running bool `json:"Running"`
		Health  struct {
			Status string `json:"Status"`
		} `json:"Health"`
	} `json:"State"`
	Mounts []struct {
		Type, Name, Source, Destination string
		RW                              bool
	} `json:"Mounts"`
}

func inspect(ctx context.Context, id string) (containerInfo, error) {
	var infos []containerInfo
	raw, e := docker(ctx, "inspect", id)
	if e != nil {
		return containerInfo{}, e
	}
	if e = json.Unmarshal(raw, &infos); e != nil || len(infos) != 1 {
		return containerInfo{}, errors.New("invalid Docker inspect response")
	}
	return infos[0], nil
}
func mounts(info containerInfo, app bool) ([]string, error) {
	result := []string{}
	found := false
	for _, m := range info.Mounts {
		if m.Destination == "/app/update-status" {
			continue
		}
		if (app && m.Destination == "/app/data") || (!app && m.Destination == "/var/lib/mysql") {
			if m.Type != "volume" && m.Type != "bind" {
				return nil, errors.New("persistent storage must use an existing volume or bind mount")
			}
			found = true
		}
		result = append(result, fmt.Sprintf("%s|%s|%s|%s|%t", m.Type, m.Name, m.Source, m.Destination, m.RW))
	}
	if !found {
		return nil, errors.New("expected persistent data mount is missing")
	}
	sort.Strings(result)
	return result, nil
}
func envMap(env []string) map[string]string {
	result := map[string]string{}
	for _, v := range env {
		key, value, ok := strings.Cut(v, "=")
		if ok {
			result[key] = value
		}
	}
	return result
}
func service(spec map[string]any, name string) (map[string]any, error) {
	services, ok := spec["services"].(map[string]any)
	if !ok {
		return nil, errors.New("Compose services are missing")
	}
	item, ok := services[name].(map[string]any)
	if !ok {
		return nil, errors.New("Compose service is missing")
	}
	return item, nil
}
func (d DockerRuntime) Snapshot(ctx context.Context, c Config) (Snapshot, error) {
	var result Snapshot
	appID, e := containerID(ctx, c, "minimail")
	if e != nil {
		return result, e
	}
	dbID, e := containerID(ctx, c, "database")
	if e != nil {
		return result, e
	}
	app, e := inspect(ctx, appID)
	if e != nil {
		return result, e
	}
	database, e := inspect(ctx, dbID)
	if e != nil {
		return result, e
	}
	if !app.State.Running || !database.State.Running || database.State.Health.Status != "healthy" {
		return result, errors.New("application and database must be running and database healthy before an update")
	}
	for name, image := range map[string]string{"application": app.Image, "database": database.Image} {
		if _, err := docker(ctx, "image", "inspect", image); err != nil {
			return result, fmt.Errorf("the running %s image is unavailable locally; restore its exact image or perform separately verified container maintenance before updating; no services changed", name)
		}
	}
	for _, info := range []containerInfo{app, database} {
		if info.Config.Labels["com.docker.compose.project"] != c.Project {
			return result, errors.New("Compose project identity differs from running containers")
		}
	}
	for name, info := range map[string]containerInfo{"minimail": app, "database": database} {
		raw, e := docker(ctx, append(composeArgs(c, configuredFiles(c)), "config", "--hash", name)...)
		if e != nil {
			return result, e
		}
		fields := strings.Fields(string(raw))
		if len(fields) != 2 || fields[1] != info.Config.Labels["com.docker.compose.config-hash"] {
			return result, errors.New("private Compose configuration differs from the running services; reconcile it explicitly before updating")
		}
	}
	raw, e := docker(ctx, append(composeArgs(c, configuredFiles(c)), "config", "--format", "json")...)
	if e != nil {
		return result, e
	}
	if e = json.Unmarshal(raw, &result.Compose); e != nil {
		return result, e
	}
	// `compose config` emits a reusable Compose model: literal dollars are
	// already escaped as $$. Decode once for runtime comparisons, then escape
	// once again when writing the frozen file. Never interpolate a secret twice.
	result.Compose = unescaped(result.Compose).(map[string]any)
	s, e := service(result.Compose, "minimail")
	if e != nil {
		return result, e
	}
	environment, ok := s["environment"].(map[string]any)
	if !ok {
		return result, errors.New("application environment is missing")
	}
	actual := envMap(app.Config.Env)
	for _, key := range []string{"APP_ENCRYPTION_KEY", "MYSQL_HOST", "MYSQL_PORT", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"} {
		expected, _ := environment[key].(string)
		if expected == "" || expected != actual[key] {
			return result, fmt.Errorf("%s differs from the running application; refusing to change encryption/database configuration", key)
		}
	}
	if len(actual["APP_ENCRYPTION_KEY"]) != 64 {
		return result, errors.New("encryption key is invalid")
	}
	result.AppID = appID
	result.DBID = dbID
	result.AppImage = app.Image
	result.DBImage = database.Image
	if result.AppMounts, e = mounts(app, true); e != nil {
		return result, e
	}
	result.DBMounts, e = mounts(database, false)
	return result, e
}
func imageOverride(image, status string) map[string]any {
	return map[string]any{"services": map[string]any{"minimail": map[string]any{"image": image, "pull_policy": "never", "volumes": []any{map[string]any{"type": "bind", "source": status, "target": "/app/update-status", "read_only": true, "bind": map[string]any{"create_host_path": false}}}}}}
}
func preserveImageOverride(previous json.RawMessage, image, status string) (map[string]any, error) {
	result := map[string]any{}
	if len(previous) > 0 {
		if err := json.Unmarshal(previous, &result); err != nil {
			return nil, errors.New("invalid saved image override")
		}
	}
	if result == nil {
		result = map[string]any{}
	}
	services, _ := result["services"].(map[string]any)
	if services == nil {
		services = map[string]any{}
		result["services"] = services
	}
	app, _ := services["minimail"].(map[string]any)
	if app == nil {
		app = map[string]any{}
		services["minimail"] = app
	}
	app["image"], app["pull_policy"] = image, "never"
	volumes, _ := app["volumes"].([]any)
	hasStatus := false
	for _, value := range volumes {
		mount, _ := value.(map[string]any)
		hasStatus = hasStatus || mount["target"] == "/app/update-status"
	}
	if !hasStatus {
		desired, _ := service(imageOverride(image, status), "minimail")
		app["volumes"] = append(volumes, desired["volumes"].([]any)...)
	}
	return result, nil
}
func cloneSpec(spec map[string]any) map[string]any {
	raw, _ := json.Marshal(spec)
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	return result
}
func escaped(value any) any {
	return mapStrings(value, func(s string) string { return strings.ReplaceAll(s, "$", "$$") })
}
func unescaped(value any) any {
	return mapStrings(value, func(s string) string { return strings.ReplaceAll(s, "$$", "$") })
}
func mapStrings(value any, convert func(string) string) any {
	switch v := value.(type) {
	case string:
		return convert(v)
	case []any:
		for i := range v {
			v[i] = mapStrings(v[i], convert)
		}
		return v
	case map[string]any:
		for key, item := range v {
			v[key] = mapStrings(item, convert)
		}
		return v
	}
	return value
}
func frozenSpec(s Snapshot, c Config, image string, status bool) map[string]any {
	spec := cloneSpec(s.Compose)
	app, _ := service(spec, "minimail")
	app["image"] = image
	app["pull_policy"] = "never"
	delete(app, "build")
	if status {
		volumes, _ := app["volumes"].([]any)
		filtered := []any{}
		for _, v := range volumes {
			if m, ok := v.(map[string]any); !ok || m["target"] != "/app/update-status" {
				filtered = append(filtered, v)
			}
		}
		override, _ := service(imageOverride(image, filepath.Join(c.Root, ".minimail/status")), "minimail")
		app["volumes"] = append(filtered, override["volumes"].([]any)...)
	}
	return escaped(spec).(map[string]any)
}
func prepareFrozen(folder string, s Snapshot, c Config, image string) error {
	if e := writeJSON(filepath.Join(folder, "previous.compose.json"), frozenSpec(s, c, s.AppImage, false), 0600); e != nil {
		return e
	}
	return writeJSON(filepath.Join(folder, "next.compose.json"), frozenSpec(s, c, image, true), 0600)
}
func (d DockerRuntime) Prepare(ctx context.Context, m Manifest) error {
	if d.fixtureImages != nil {
		_, e := docker(ctx, "image", "inspect", d.reference(m.Image))
		return e
	}
	if _, e := docker(ctx, "pull", m.Image); e != nil {
		return e
	}
	raw, e := docker(ctx, "image", "inspect", m.Image)
	if e != nil {
		return e
	}
	var items []struct {
		RepoDigests []string
		Config      struct{ Labels map[string]string }
	}
	if e = json.Unmarshal(raw, &items); e != nil || len(items) != 1 {
		return errors.New("invalid image metadata")
	}
	labels := items[0].Config.Labels
	if labels["org.opencontainers.image.version"] != m.Version || labels["org.opencontainers.image.revision"] != m.Revision || labels["io.minimail.schema"] != strconv.Itoa(m.Schema) {
		return errors.New("image labels differ from signed release")
	}
	found := false
	for _, digest := range items[0].RepoDigests {
		if digest == m.Image {
			found = true
		}
	}
	if !found {
		return errors.New("downloaded image digest differs from signed release")
	}
	return nil
}
func runCandidate(ctx context.Context, c Config, file, script string) ([]byte, error) {
	args := composeArgs(c, []string{file})
	relative, _ := filepath.Rel(filepath.Join(c.Root, ".minimail/backups"), file)
	if relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		args = frozenArgs(c, file)
	}
	return docker(ctx, append(args, "run", "--rm", "--no-deps", "--pull", "never", "--entrypoint", "node", "minimail", script)...)
}
func (d DockerRuntime) Preflight(ctx context.Context, c Config, s Snapshot, m Manifest, folder string) (SchemaStatus, error) {
	var result SchemaStatus
	if e := prepareFrozen(folder, s, c, d.reference(m.Image)); e != nil {
		return result, e
	}
	raw, e := runCandidate(ctx, c, filepath.Join(folder, "next.compose.json"), "server/migration-status.js")
	if e != nil {
		return result, e
	}
	if e = json.Unmarshal(raw, &result); e != nil {
		return result, e
	}
	return result, nil
}
func (d DockerRuntime) Stop(ctx context.Context, s Snapshot) error {
	_, e := docker(ctx, "stop", "--time", "30", s.AppID)
	return e
}
func (d DockerRuntime) Start(ctx context.Context, c Config, file string) error {
	_, e := docker(ctx, append(frozenArgs(c, file), "up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "100", "minimail")...)
	return e
}
func (d DockerRuntime) Migrate(ctx context.Context, c Config, t Transaction) error {
	_, e := runCandidate(ctx, c, filepath.Join(t.Backup, "next.compose.json"), "server/migrate.js")
	return e
}
func (d DockerRuntime) Health(ctx context.Context, c Config, want Deployment, before Snapshot) error {
	appID, e := containerID(ctx, c, "minimail")
	if e != nil {
		return e
	}
	app, e := inspect(ctx, appID)
	if e != nil {
		return e
	}
	database, e := inspect(ctx, before.DBID)
	if e != nil {
		return e
	}
	dbID, e := containerID(ctx, c, "database")
	if e != nil {
		return e
	}
	if dbID != before.DBID || database.Image != before.DBImage || !app.State.Running || app.State.Health.Status != "healthy" || database.State.Health.Status != "healthy" {
		return errors.New("container identity/health validation failed")
	}
	a, e := mounts(app, true)
	if e != nil {
		return e
	}
	b, e := mounts(database, false)
	if e != nil {
		return e
	}
	if !reflect.DeepEqual(a, before.AppMounts) || !reflect.DeepEqual(b, before.DBMounts) {
		return errors.New("persistent storage mounts changed")
	}
	if want.Revision != "legacy" {
		if app.Config.Labels["org.opencontainers.image.version"] != want.Version || app.Config.Labels["org.opencontainers.image.revision"] != want.Revision {
			return errors.New("running image version differs from selected release")
		}
	}
	expectedImage, e := docker(ctx, "image", "inspect", "--format", "{{.Id}}", d.reference(want.Image))
	if e != nil {
		return e
	}
	if app.Image != strings.TrimSpace(string(expectedImage)) {
		return errors.New("running image content differs from the selected version")
	}
	schema, e := d.CurrentSchema(ctx, c)
	if e != nil {
		return e
	}
	if schema < want.ReadMin || schema > want.ReadMax {
		return errors.New("running application cannot read database schema")
	}
	return nil
}
func sql(ctx context.Context, id, query string) ([]byte, error) {
	return docker(ctx, "exec", id, "sh", "-c", `MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --batch --skip-column-names --raw -u "$MYSQL_USER" "$MYSQL_DATABASE" -e "$1"`, "minimail-sql", query)
}
func (d DockerRuntime) CurrentSchema(ctx context.Context, c Config) (int, error) {
	id, e := containerID(ctx, c, "database")
	if e != nil {
		return 0, e
	}
	raw, e := sql(ctx, id, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='schema_migrations'")
	if e != nil {
		return 0, e
	}
	if strings.TrimSpace(string(raw)) == "0" {
		return 1, nil
	}
	raw, e = sql(ctx, id, "SELECT COALESCE(MAX(version),1) FROM schema_migrations")
	if e != nil {
		return 0, e
	}
	return strconv.Atoi(strings.TrimSpace(string(raw)))
}
func artifact(ctx context.Context, name string, args ...string) (string, error) {
	file, e := os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return "", e
	}
	command := exec.CommandContext(ctx, "docker", args...)
	hash := sha256.New()
	command.Stdout = io.MultiWriter(file, hash)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	e = command.Run()
	if e == nil {
		e = file.Sync()
	}
	closeError := file.Close()
	if e == nil {
		e = closeError
	}
	if e != nil {
		return "", errors.New("backup command failed; private command output withheld")
	}
	stat, e := os.Stat(name)
	if e != nil || stat.Size() < 20 {
		return "", errors.New("backup is empty")
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
func gzipDump(ctx context.Context, name, id string) (string, error) {
	file, e := os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return "", e
	}
	hash := sha256.New()
	z := gzip.NewWriter(io.MultiWriter(file, hash))
	command := exec.CommandContext(ctx, "docker", "exec", id, "sh", "-c", `MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump --single-transaction --quick --routines --events --triggers --hex-blob --no-tablespaces --set-gtid-purged=OFF -u "$MYSQL_USER" --databases "$MYSQL_DATABASE"`)
	command.Stdout = z
	var stderr bytes.Buffer
	command.Stderr = &stderr
	e = command.Run()
	ze := z.Close()
	if e == nil {
		e = ze
	}
	if e == nil {
		e = file.Sync()
	}
	ce := file.Close()
	if e == nil {
		e = ce
	}
	if e != nil {
		return "", errors.New("database backup failed; application will be recovered without modifying SQL data")
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
func checkGzip(name string) error {
	file, e := os.Open(name)
	if e != nil {
		return e
	}
	defer file.Close()
	z, e := gzip.NewReader(file)
	if e != nil {
		return e
	}
	defer z.Close()
	n, e := io.Copy(io.Discard, z)
	if e != nil {
		return e
	}
	if n == 0 {
		return errors.New("empty compressed backup")
	}
	return nil
}

type tableRecord struct {
	Rows     string `json:"rows"`
	Checksum string `json:"checksum"`
}

func inventory(ctx context.Context, id, databaseName string, root bool) (map[string]tableRecord, error) {
	query := func(q string) ([]byte, error) {
		if !root {
			return sql(ctx, id, q)
		}
		return docker(ctx, "exec", id, "mysql", "-uroot", "--batch", "--skip-column-names", "--raw", databaseName, "-e", q)
	}
	raw, e := query("SHOW TABLES")
	if e != nil {
		return nil, e
	}
	result := map[string]tableRecord{}
	for _, table := range strings.Fields(string(raw)) {
		if !regexpIdentifier(table) {
			return nil, errors.New("backup has unsupported table identifier")
		}
		count, e := query("SELECT COUNT(*) FROM `" + table + "`")
		if e != nil {
			return nil, e
		}
		sum, e := query("CHECKSUM TABLE `" + table + "` EXTENDED")
		if e != nil {
			return nil, e
		}
		fields := strings.Fields(string(sum))
		if len(fields) != 2 || fields[1] == "NULL" {
			return nil, errors.New("database cannot calculate backup checksums")
		}
		result[table] = tableRecord{strings.TrimSpace(string(count)), fields[1]}
	}
	return result, nil
}
func regexpIdentifier(s string) bool {
	if len(s) < 1 || len(s) > 64 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_') {
			return false
		}
	}
	return true
}
func restoreName(t Transaction) string { return "minimail-restore-" + filepath.Base(t.Backup) }
func appDataReadArgs(s Snapshot, command string, args ...string) []string {
	// Older deployments may contain root-owned SQLite snapshots or key files.
	// Read them without changing their owners/modes. The helper has no network,
	// no writable filesystem, and only the capability required for DAC reads.
	base := []string{"run", "--rm", "--network", "none", "--read-only", "--user", "0:0", "--cap-drop", "ALL", "--cap-add", "DAC_OVERRIDE", "--security-opt", "no-new-privileges:true", "--pids-limit", "64", "--memory", "64m", "--cpus", "1", "--volumes-from", s.AppID + ":ro", "--entrypoint", command, s.AppImage}
	return append(base, args...)
}
func (d DockerRuntime) Backup(ctx context.Context, c Config, t Transaction) error {
	sizeRaw, e := sql(ctx, t.Snapshot.DBID, "SELECT COALESCE(SUM(DATA_LENGTH+INDEX_LENGTH),0) FROM information_schema.tables WHERE table_schema=DATABASE()")
	if e != nil {
		return e
	}
	size, e := strconv.ParseUint(strings.TrimSpace(string(sizeRaw)), 10, 64)
	if e != nil {
		return e
	}
	free, e := freeBytes(t.Backup)
	if e != nil {
		return e
	}
	dataSizeRaw, e := docker(ctx, appDataReadArgs(t.Snapshot, "du", "-sk", "/app/data")...)
	if e != nil {
		return e
	}
	fields := strings.Fields(string(dataSizeRaw))
	if len(fields) != 2 {
		return errors.New("cannot estimate persistent app-data backup size")
	}
	dataKiB, e := strconv.ParseUint(fields[0], 10, 64)
	if e != nil {
		return e
	}
	if size > free/3 || dataKiB > free/2048 || free < size*3+dataKiB*2048+(512<<20) {
		return errors.New("insufficient backup disk space; no migrations performed")
	}
	dbInfo, e := inspect(ctx, t.Snapshot.DBID)
	if e != nil {
		return e
	}
	databaseName := envMap(dbInfo.Config.Env)["MYSQL_DATABASE"]
	if !regexpIdentifier(databaseName) {
		return errors.New("invalid database identifier")
	}
	expected, e := inventory(ctx, t.Snapshot.DBID, databaseName, false)
	if e != nil {
		return e
	}
	if e = writeJSON(filepath.Join(t.Backup, "database-inventory.json"), expected, 0600); e != nil {
		return e
	}
	dump := filepath.Join(t.Backup, "database.sql.gz")
	dbHash, e := gzipDump(ctx, dump, t.Snapshot.DBID)
	if e != nil {
		return e
	}
	if e = checkGzip(dump); e != nil {
		return e
	}
	data := filepath.Join(t.Backup, "app-data.tar.gz")
	dataHash, e := artifact(ctx, data, appDataReadArgs(t.Snapshot, "tar", "-czf", "-", "-C", "/app/data", ".")...)
	if e != nil {
		return e
	}
	if e = checkGzip(data); e != nil {
		return e
	}
	name := restoreName(t)
	_, e = docker(ctx, "run", "-d", "--name", name, "--label", "io.minimail.backup-check="+c.Project, "--network", "none", "--memory", "1536m", "--cpus", "1", "--pids-limit", "256", "-e", "MYSQL_ALLOW_EMPTY_PASSWORD=yes", t.Snapshot.DBImage, "--innodb-buffer-pool-size=64M", "--max-connections=20", "--performance-schema=OFF", "--mysqlx=OFF", "--event-scheduler=OFF")
	if e != nil {
		return e
	}
	defer d.Cleanup(context.WithoutCancel(ctx), c, t)
	ready := false
	for i := 0; i < 80; i++ {
		if _, e = docker(ctx, "exec", name, "mysqladmin", "ping", "-h", "127.0.0.1", "--silent"); e == nil {
			ready = true
			break
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
	if !ready {
		return errors.New("isolated backup restore database did not start")
	}
	file, e := os.Open(dump)
	if e != nil {
		return e
	}
	defer file.Close()
	z, e := gzip.NewReader(file)
	if e != nil {
		return e
	}
	defer z.Close()
	command := exec.CommandContext(ctx, "docker", "exec", "-i", name, "mysql", "-uroot", "--max-allowed-packet=128M")
	command.Stdin = z
	var private bytes.Buffer
	command.Stderr = &private
	if e = command.Run(); e != nil {
		return errors.New("backup could not be restored into the isolated database")
	}
	restored, e := inventory(ctx, name, databaseName, true)
	if e != nil {
		return e
	}
	if !reflect.DeepEqual(expected, restored) {
		return errors.New("restored backup row counts/checksums differ; no migrations performed")
	}
	return writeJSON(filepath.Join(t.Backup, "verified.json"), map[string]any{"databaseSHA256": dbHash, "appDataSHA256": dataHash, "restoredAndCompared": true, "verifiedAt": time.Now().UTC().Format(time.RFC3339)}, 0600)
}
func (d DockerRuntime) Cleanup(ctx context.Context, c Config, t Transaction) error {
	raw, e := docker(ctx, "ps", "-aq", "--filter", "name=^/"+restoreName(t)+"$")
	if e != nil {
		return e
	}
	if strings.TrimSpace(string(raw)) == "" {
		return nil
	}
	info, e := inspect(ctx, restoreName(t))
	if e != nil {
		return e
	}
	if info.Config.Labels["io.minimail.backup-check"] != c.Project {
		return errors.New("refused to remove an unrelated restore-check container")
	}
	_, e = docker(ctx, "rm", "-f", "-v", restoreName(t))
	return e
}

package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := runCLI(ctx, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "MiniMail:", err)
		os.Exit(1)
	}
}

type pathFlags []string

func (p *pathFlags) String() string         { return strings.Join(*p, ",") }
func (p *pathFlags) Set(value string) error { *p = append(*p, value); return nil }
func runCLI(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return errors.New("usage: minimail <install|adopt|check|apply|rollback|recover|configure|status|compose|service-install|cycle|version> --root PATH")
	}
	action := args[0]
	if action == "version" {
		fmt.Println("MiniMail updater", updaterVersion)
		return nil
	}
	flags := flag.NewFlagSet(action, flag.ContinueOnError)
	rootArg := flags.String("root", ".", "installation directory")
	tag := flags.String("version", "", "explicit release version")
	mode := flags.String("mode", "", "off, notify, manual or auto")
	channel := flags.String("channel", "", "stable or preview")
	zone := flags.String("timezone", "", "IANA maintenance timezone")
	window := flags.String("window", "", "maintenance window HH:MM-HH:MM")
	project := flags.String("project", "minimail", "Compose project name (fresh installs only)")
	bundle := flags.String("bundle", "", "extracted signed installation package")
	admin := flags.String("admin", "admin", "initial administrator username")
	backupOutput := flags.String("output", "", "new encrypted installation backup file")
	backupInput := flags.String("input", "", "encrypted installation backup to restore")
	passwordStdin := flags.Bool("password-stdin", false, "read backup password from a pipe instead of a hidden terminal prompt")
	confirmRestore := flags.Bool("confirm-restore", false, "restore into an empty directory and new Docker volumes")
	var composeFiles pathFlags
	flags.Var(&composeFiles, "compose", "configuration file (repeat to register overrides)")
	if e := flags.Parse(args[1:]); e != nil {
		return e
	}
	if action == "release-info" {
		selected := *channel
		if selected == "" {
			selected = "stable"
		}
		m, e := (GitHubSource{}).Fetch(ctx, selected, *tag)
		if errors.Is(e, errNoRelease) {
			fmt.Println(`{"none":true}`)
			return nil
		}
		if e != nil {
			return e
		}
		raw, _ := json.Marshal(m)
		fmt.Println(string(raw))
		return nil
	}
	if action == "install" {
		return install(ctx, *rootArg, *bundle, *project, *admin)
	}
	if action == "backup-import" {
		password, err := backupPassword(*passwordStdin, false)
		if err != nil {
			return err
		}
		return restoreInstallation(ctx, *rootArg, *backupInput, password, *confirmRestore)
	}
	root, e := safeRoot(*rootArg)
	if e != nil {
		return e
	}
	if action == "backup-service-install" {
		return installBackupService(ctx, root)
	}
	if action == "backup-serve" {
		return serveWebBackups(ctx, root)
	}
	// Installing a system service may use sudo, but the scheduled updater must
	// retain the installation owner's identity and Docker access.
	if action == "service-install" {
		var c Config
		if e = readJSON(filepath.Join(root, ".minimail/config.json"), &c); e != nil {
			return e
		}
		if e = c.validate(); e != nil {
			return e
		}
		if c.Root != root {
			return errors.New("installation path differs from saved configuration")
		}
		return installService(c)
	}
	if e = ensureStateDir(root); e != nil {
		return e
	}
	unlock, e := lockInstallation(root)
	if e != nil {
		return e
	}
	defer unlock()
	if action == "adopt" {
		return adopt(ctx, root)
	}
	var c Config
	if e = readJSON(filepath.Join(root, ".minimail/config.json"), &c); e != nil {
		return e
	}
	if e = c.validate(); e != nil {
		return e
	}
	if c.Root != root {
		return errors.New("installation path differs from saved configuration")
	}
	if _, err := os.Stat(filepath.Join(root, ".minimail/restore-in-progress.json")); err == nil {
		return errors.New("an installation restore is incomplete; the updater will not change data or start the application")
	}
	if e = recoverBackupControl(ctx, root); e != nil {
		return e
	}
	if e = recoverBackupExport(ctx, c); e != nil {
		return e
	}
	engine := Engine{Config: c, Runtime: DockerRuntime{}, Source: GitHubSource{}}
	if action == "status" {
		var state State
		if e = readJSON(engine.path("state.json"), &state); e != nil {
			return e
		}
		raw, _ := json.MarshalIndent(map[string]any{"configuration": c, "state": state}, "", "  ")
		fmt.Println(string(raw))
		return nil
	}
	if action == "configure" {
		if e = engine.Recover(ctx); e != nil {
			return e
		}
		if *mode != "" {
			c.Mode = *mode
		}
		if len(composeFiles) > 0 {
			c.ComposeFiles = nil
			for _, name := range composeFiles {
				file := absolutePath(root, name)
				if info, e := os.Stat(file); e != nil || !info.Mode().IsRegular() {
					return errors.New("registered Compose file is missing")
				}
				c.ComposeFiles = append(c.ComposeFiles, file)
			}
		}
		if *channel != "" {
			c.Channel = *channel
		}
		if *zone != "" {
			c.Timezone = *zone
		}
		if *window != "" {
			parts := strings.Split(*window, "-")
			if len(parts) != 2 {
				return errors.New("window must be HH:MM-HH:MM")
			}
			c.WindowStart, e = parseMinute(parts[0])
			if e != nil {
				return e
			}
			c.WindowEnd, e = parseMinute(parts[1])
			if e != nil {
				return e
			}
		}
		if e = c.validate(); e != nil {
			return e
		}
		if e = writeJSON(engine.path("config.json"), c, 0600); e != nil {
			return e
		}
		engine.Config = c
		state, e := engine.loadState()
		if e != nil {
			return e
		}
		return engine.status(state, "configured", "", nil)
	}
	if action == "compose" {
		if e = engine.Recover(ctx); e != nil {
			return e
		}
		command := exec.CommandContext(ctx, "docker", append(composeArgs(c, configuredFiles(c)), flags.Args()...)...)
		command.Stdin = os.Stdin
		command.Stdout = os.Stdout
		command.Stderr = os.Stderr
		return command.Run()
	}
	switch action {
	case "backup-export":
		password, err := backupPassword(*passwordStdin, true)
		if err != nil {
			return err
		}
		return exportInstallation(ctx, &engine, *backupOutput, password)
	case "check":
		return engine.Check(ctx, false)
	case "cycle":
		return engine.Check(ctx, true)
	case "recover":
		return engine.Recover(ctx)
	case "rollback":
		return engine.Rollback(ctx)
	case "apply":
		selected := c.Channel
		if *tag != "" {
			selected = "preview"
		}
		m, e := engine.Source.Fetch(ctx, selected, *tag)
		if e != nil {
			return e
		}
		return engine.Apply(ctx, m, false)
	}
	return errors.New("unknown updater command")
}
func parseMinute(s string) (int, error) {
	parts := strings.Split(s, ":")
	if len(parts) != 2 || len(parts[0]) != 2 || len(parts[1]) != 2 {
		return 0, errors.New("invalid maintenance time")
	}
	h, e := strconv.Atoi(parts[0])
	if e != nil || h < 0 || h > 23 {
		return 0, errors.New("invalid maintenance hour")
	}
	m, e := strconv.Atoi(parts[1])
	if e != nil || m < 0 || m > 59 {
		return 0, errors.New("invalid maintenance minute")
	}
	return h*60 + m, nil
}

func adopt(ctx context.Context, root string) error {
	configPath := filepath.Join(root, ".minimail/config.json")
	if _, e := os.Stat(configPath); e == nil {
		return errors.New("installation is already managed; configuration was preserved")
	}
	// Find the existing app by its exact Compose working-directory label. Never
	// infer a new project name from a folder and accidentally create a new DB.
	raw, e := docker(ctx, "ps", "-q", "--filter", "label=com.docker.compose.service=minimail")
	if e != nil {
		return e
	}
	matches := []containerInfo{}
	for _, id := range strings.Fields(string(raw)) {
		info, e := inspect(ctx, id)
		if e != nil {
			return e
		}
		label := info.Config.Labels["com.docker.compose.project.working_dir"]
		if filepath.Clean(label) == root {
			matches = append(matches, info)
		}
	}
	if len(matches) != 1 {
		return errors.New("expected exactly one running MiniMail installation at this directory")
	}
	app := matches[0]
	project := app.Config.Labels["com.docker.compose.project"]
	files := strings.Split(app.Config.Labels["com.docker.compose.project.config_files"], ",")
	c := Config{Format: 1, Root: root, Project: project, EnvFile: filepath.Join(root, ".env"), Mode: "notify", Channel: "stable", Timezone: "UTC", WindowStart: 180, WindowEnd: 240}
	for _, f := range files {
		if f == "" || strings.Contains(f, ".minimail") {
			return errors.New("invalid legacy Compose files")
		}
		c.ComposeFiles = append(c.ComposeFiles, absolutePath(root, f))
	}
	if e = c.validate(); e != nil {
		return e
	}
	snapshot, e := (DockerRuntime{}).Snapshot(ctx, c)
	if e != nil {
		return e
	}
	deployment := Deployment{Version: "0.0.0", Revision: "legacy", Image: snapshot.AppImage, Schema: 1, ReadMin: 1, ReadMax: 1}
	labels := app.Config.Labels
	if v := labels["org.opencontainers.image.version"]; v != "" {
		if _, e = parseVersion(v); e != nil {
			return e
		}
		deployment.Version = v
		deployment.Revision = labels["org.opencontainers.image.revision"]
		if !revisionPattern.MatchString(deployment.Revision) {
			return errors.New("invalid image revision")
		}
		schema, e := strconv.Atoi(labels["io.minimail.schema"])
		if e != nil || schema < 1 || schema > 2 {
			return errors.New("unsupported adoption schema")
		}
		deployment.Schema = schema
		deployment.ReadMin, e = strconv.Atoi(labels["io.minimail.read-schema-min"])
		if e != nil {
			return e
		}
		deployment.ReadMax, e = strconv.Atoi(labels["io.minimail.read-schema-max"])
		if e != nil || deployment.ReadMin < 1 || deployment.ReadMin > schema || deployment.ReadMax < schema {
			return errors.New("unsupported image schema compatibility range")
		}
	} else {
		// Legacy versions lack a ledger. Only the audited, known schema baseline is
		// adopted automatically; arbitrary old versions require a manual migration.
		hash, e := docker(ctx, "exec", app.ID, "node", "--input-type=module", "-e", `import fs from 'node:fs';import crypto from 'node:crypto';console.log(crypto.createHash('sha256').update(fs.readFileSync('server/schema.js','utf8').replace(/\r\n/g,'\n')).digest('hex'))`)
		if e != nil {
			return e
		}
		if strings.TrimSpace(string(hash)) != legacySchemaHash {
			return errors.New("legacy schema is not the audited supported baseline; adoption stopped without touching data")
		}
	}
	if _, e = protectedFiles(c); e != nil {
		return e
	}
	if e = installBinary(root); e != nil {
		return e
	}
	state := State{Current: deployment}
	if e = writeJSON(filepath.Join(root, ".minimail/state.json"), state, 0600); e != nil {
		return e
	}
	if e = writeJSON(configPath, c, 0600); e != nil {
		return e
	}
	engine := Engine{Config: c}
	fmt.Println("Existing installation adopted; no containers, secrets, configuration or data changed.")
	return engine.status(state, "adopted", "", nil)
}

// Filled from the audited baseline by the release preparation script.
const legacySchemaHash = "8f63a06756b688a9abb5432aa9373ed66e62c98c55b18a06f14bedf156a5a6ef"

func installBinary(root string) error {
	source, e := os.Executable()
	if e != nil {
		return e
	}
	directory := filepath.Join(root, ".minimail/bin")
	if e = os.MkdirAll(directory, 0700); e != nil {
		return e
	}
	name := "minimail"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	target := filepath.Join(directory, name)
	a, _ := filepath.Abs(source)
	b, _ := filepath.Abs(target)
	if a == b {
		return nil
	}
	raw, e := os.ReadFile(source)
	if e != nil {
		return e
	}
	return writeAtomic(target, raw, 0700)
}

func readBundle(folder string) (Manifest, map[string][]byte, error) {
	var m Manifest
	raw, e := os.ReadFile(filepath.Join(folder, "bundle.json"))
	if e != nil {
		return m, nil, e
	}
	signature, e := os.ReadFile(filepath.Join(folder, "bundle.json.sig"))
	if e != nil {
		return m, nil, e
	}
	m, e = verifyManifest(raw, signature, trustedKeyPEM)
	if e != nil {
		return m, nil, e
	}
	content := map[string][]byte{}
	total := 0
	for name, want := range m.Assets {
		path := filepath.Join(folder, name)
		info, e := os.Lstat(path)
		if e != nil {
			return m, nil, e
		}
		if !info.Mode().IsRegular() || info.Size() > 64<<20 {
			return m, nil, errors.New("invalid installation bundle member")
		}
		data, e := os.ReadFile(path)
		if e != nil {
			return m, nil, e
		}
		total += len(data)
		if total > 96<<20 || hashBytes(data) != want {
			return m, nil, errors.New("installation bundle checksum verification failed")
		}
		content[name] = data
	}
	return m, content, nil
}
func randomHex() string {
	var value [32]byte
	if _, e := rand.Read(value[:]); e != nil {
		panic(e)
	}
	return hex.EncodeToString(value[:])
}
func install(ctx context.Context, directory, bundle, project, admin string) error {
	return installWith(ctx, directory, bundle, project, admin, DockerRuntime{})
}
func installWith(ctx context.Context, directory, bundle, project, admin string, d DockerRuntime) error {
	if !projectPattern.MatchString(project) {
		return errors.New("invalid Compose project name")
	}
	if bundle == "" {
		exe, e := os.Executable()
		if e != nil {
			return e
		}
		bundle = filepath.Dir(exe)
	}
	m, files, e := readBundle(bundle)
	if e != nil {
		return e
	}
	if e = os.MkdirAll(directory, 0700); e != nil {
		return e
	}
	root, e := safeRoot(directory)
	if e != nil {
		return e
	}
	if e = ensureStateDir(root); e != nil {
		return e
	}
	unlock, e := lockInstallation(root)
	if e != nil {
		return e
	}
	defer unlock()
	stateDir := filepath.Join(root, ".minimail")
	marker := filepath.Join(stateDir, "installing.json")
	if _, e = os.Stat(filepath.Join(stateDir, "state.json")); e == nil {
		if e = installBinary(root); e != nil {
			return e
		}
		fmt.Println("Installation is already initialized. Use check/apply; existing configuration was preserved.")
		return nil
	}
	if _, e = os.Stat(marker); os.IsNotExist(e) {
		if _, e = os.Stat(filepath.Join(root, ".env")); !os.IsNotExist(e) {
			return errors.New("existing environment detected; use adopt for an existing installation")
		}
		occupied, e := docker(ctx, "ps", "-aq", "--filter", "label=com.docker.compose.project="+project)
		if e != nil {
			return e
		}
		if len(strings.Fields(string(occupied))) > 0 {
			return errors.New("Compose project already exists; use adopt to preserve its volumes")
		}
		if e = writeJSON(marker, m, 0600); e != nil {
			return e
		}
	} else if e != nil {
		return e
	} else {
		var previous Manifest
		if e = readJSON(marker, &previous); e != nil {
			return e
		}
		if previous.Version != m.Version || previous.Revision != m.Revision {
			return errors.New("resume installation using the original signed release bundle")
		}
	}
	names := []string{"compose.yaml", "compose.vpn.yaml", "compose.https.yaml", "Caddyfile.example", "LICENSE", "NOTICE"}
	for _, name := range []string{"compose.geoip.yaml", "install-update-task.ps1", "README.md", "GO-LICENSE", "THIRD-PARTY-NOTICES.txt", "release-public-key.pem"} {
		if _, ok := files[name]; ok {
			names = append(names, name)
		}
	}
	for _, name := range names {
		data, ok := files[name]
		if !ok {
			return fmt.Errorf("bundle member %s is missing", name)
		}
		target := filepath.Join(root, name)
		old, e := os.ReadFile(target)
		if e == nil {
			if !bytesEqual(old, data) {
				return fmt.Errorf("existing %s differs; refused to overwrite it", name)
			}
		} else if !os.IsNotExist(e) {
			return e
		} else if e = writeAtomic(target, data, 0600); e != nil {
			return e
		}
	}
	env := filepath.Join(root, ".env")
	if _, e = os.Stat(env); os.IsNotExist(e) {
		if e = writeNew(env, []byte("APP_ENCRYPTION_KEY="+randomHex()+"\nMYSQL_PASSWORD="+randomHex()+"\nMYSQL_ROOT_PASSWORD="+randomHex()+"\n")); e != nil {
			return e
		}
		if e = securePath(env, false); e != nil {
			return e
		}
	}
	c := Config{1, root, project, env, []string{filepath.Join(root, "compose.yaml")}, "notify", "stable", "UTC", 180, 240}
	if e = c.validate(); e != nil {
		return e
	}
	if e = writeJSON(filepath.Join(stateDir, "config.json"), c, 0600); e != nil {
		return e
	}
	if d.fixtureImages == nil {
		if _, e = docker(ctx, append(composeArgs(c, c.ComposeFiles), "pull")...); e != nil {
			return e
		}
	}
	if _, e = docker(ctx, append(composeArgs(c, c.ComposeFiles), "up", "-d", "--wait", "--wait-timeout", "120", "database")...); e != nil {
		return e
	}
	if _, e = runCandidate(ctx, c, c.ComposeFiles[0], "server/migrate.js"); e != nil {
		return e
	}
	status, e := runCandidate(ctx, c, c.ComposeFiles[0], "server/install-status.js")
	if e != nil {
		return e
	}
	if strings.TrimSpace(string(status)) == "needs-admin" {
		command := exec.CommandContext(ctx, "docker", append(composeArgs(c, c.ComposeFiles), "run", "--rm", "--no-deps", "--entrypoint", "node", "minimail", "server/create-admin.js", admin)...)
		command.Stdin = os.Stdin
		command.Stdout = os.Stdout
		command.Stderr = os.Stderr
		if e = command.Run(); e != nil {
			return e
		}
	}
	if e = writeJSON(filepath.Join(stateDir, "current.compose.json"), imageOverride(d.reference(m.Image), filepath.Join(stateDir, "status")), 0600); e != nil {
		return e
	}
	if _, e = docker(ctx, append(composeArgs(c, configuredFiles(c)), "up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "100", "minimail")...); e != nil {
		return e
	}
	state := State{Current: Deployment{m.Version, m.Revision, m.Image, m.Schema, m.ReadSchemaMin, m.ReadSchemaMax}, UpdatedAt: time.Now().UTC().Format(time.RFC3339)}
	if e = writeJSON(filepath.Join(stateDir, "state.json"), state, 0600); e != nil {
		return e
	}
	if e = installBinary(root); e != nil {
		return e
	}
	if e = os.Remove(marker); e != nil {
		return e
	}
	engine := Engine{Config: c}
	if e = engine.status(state, "installed", "", nil); e != nil {
		return e
	}
	fmt.Println("MiniMail installed. Configure HTTPS, then sign in and enroll 2FA. Automatic installation is disabled; update mode is notify.")
	return nil
}
func bytesEqual(a, b []byte) bool { return string(a) == string(b) }

func installService(c Config) error {
	if runtime.GOOS != "linux" {
		return errors.New("automatic service installation supports Linux/systemd; other hosts can schedule the documented cycle command")
	}
	if os.Geteuid() != 0 {
		return errors.New("service-install requires root; installation configuration was not changed")
	}
	owner, e := serviceOwner(c.Root)
	if e != nil {
		return e
	}
	quote := func(s string) string { return strconv.Quote(strings.ReplaceAll(s, "%", "%%")) }
	executable := filepath.Join(c.Root, ".minimail/bin/minimail")
	if _, e := os.Stat(executable); e != nil {
		return e
	}
	name := "minimail-update-" + c.Project
	unit := "[Unit]\nDescription=MiniMail verified update check and recovery\nAfter=docker.service network-online.target\nRequires=docker.service\n\n[Service]\nType=oneshot\nUser=" + owner + "\nUMask=0077\nExecStart=" + quote(executable) + " cycle --root " + quote(c.Root) + "\nTimeoutStartSec=25min\n"
	timer := "[Unit]\nDescription=MiniMail hourly update check\n\n[Timer]\nOnCalendar=hourly\nRandomizedDelaySec=5min\nPersistent=true\nUnit=" + name + ".service\n\n[Install]\nWantedBy=timers.target\n"
	for suffix, data := range map[string]string{".service": unit, ".timer": timer} {
		path := filepath.Join("/etc/systemd/system", name+suffix)
		if old, e := os.ReadFile(path); e == nil && string(old) != data {
			return errors.New("a different systemd unit already exists; refused to replace it")
		}
		if e := writeAtomic(path, []byte(data), 0644); e != nil {
			return e
		}
	}
	if e := exec.Command("systemctl", "daemon-reload").Run(); e != nil {
		return e
	}
	if e := exec.Command("systemctl", "enable", "--now", name+".timer").Run(); e != nil {
		return e
	}
	fmt.Println("Update-check timer enabled. Current update policy:", c.Mode)
	return nil
}

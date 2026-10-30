package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

type backupControlJournal struct {
	Previous json.RawMessage `json:"previousOverride"`
	Snapshot Snapshot        `json:"snapshot"`
	Current  Deployment      `json:"current"`
}

func ownedBackupWrite(root, name string, raw []byte) error {
	if err := writeAtomic(name, raw, 0600); err != nil {
		return err
	}
	if runtime.GOOS != "windows" && os.Geteuid() == 0 {
		owner, err := serviceOwner(root)
		if err != nil {
			return err
		}
		id, err := strconv.Atoi(owner)
		if err != nil {
			return err
		}
		return os.Chown(name, id, -1)
	}
	return nil
}
func recoverBackupControl(ctx context.Context, root string) error {
	path := filepath.Join(root, ".minimail/backup-control-enable.json")
	var journal backupControlJournal
	if err := readJSON(path, &journal); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	c, err := loadBackupConfiguration(root)
	if err != nil {
		return err
	}
	if err = ownedBackupWrite(root, filepath.Join(root, ".minimail/current.compose.json"), journal.Previous); err != nil {
		return err
	}
	frozen := filepath.Join(root, ".minimail/backup-control-recovery.compose.json")
	if err = writeJSON(frozen, escaped(journal.Snapshot.Compose), 0600); err != nil {
		return err
	}
	if err = (DockerRuntime{}).Start(ctx, c, frozen); err != nil {
		return err
	}
	if err = (DockerRuntime{}).Health(ctx, c, journal.Current, journal.Snapshot); err != nil {
		return err
	}
	if err = os.Remove(path); err != nil {
		return err
	}
	_ = os.Remove(frozen)
	return nil
}
func enableBackupControl(ctx context.Context, c Config) (err error) {
	d := DockerRuntime{}
	before, err := d.Snapshot(ctx, c)
	if err != nil {
		return err
	}
	app, err := service(before.Compose, "minimail")
	if err != nil {
		return err
	}
	volumes, _ := app["volumes"].([]any)
	for _, value := range volumes {
		m, _ := value.(map[string]any)
		if m["target"] == "/app/backup-control" {
			if m["source"] == backupControl(c.Root) && m["type"] == "bind" && m["read_only"] == true {
				return nil
			}
			return errors.New("a different backup-control mount already exists")
		}
	}
	protected, err := protectedFiles(c)
	if err != nil {
		return err
	}
	var state State
	if err = readJSON(filepath.Join(c.Root, ".minimail/state.json"), &state); err != nil {
		return err
	}
	current := state.Current
	current.Image = before.AppImage
	path := filepath.Join(c.Root, ".minimail/current.compose.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var override map[string]any
	if err = json.Unmarshal(raw, &override); err != nil {
		return err
	}
	settings, err := service(override, "minimail")
	if err != nil {
		return err
	}
	owned, _ := settings["volumes"].([]any)
	settings["volumes"] = append(owned, map[string]any{"type": "bind", "source": backupControl(c.Root), "target": "/app/backup-control", "read_only": true, "bind": map[string]any{"create_host_path": false}})
	desired, err := json.MarshalIndent(override, "", "  ")
	if err != nil {
		return err
	}
	journal := filepath.Join(c.Root, ".minimail/backup-control-enable.json")
	if err = writeJSON(journal, backupControlJournal{Previous: raw, Snapshot: before, Current: current}, 0600); err != nil {
		return err
	}
	defer func() {
		if err != nil {
			recovery, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Minute)
			defer cancel()
			if e := recoverBackupControl(recovery, c.Root); e != nil {
				err = fmt.Errorf("backup mount setup failed; recovery remains pending: %w", e)
			}
		}
	}()
	if err = ownedBackupWrite(c.Root, path, desired); err != nil {
		return err
	}
	if _, err = docker(ctx, append(composeArgs(c, configuredFiles(c)), "up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "100", "minimail")...); err != nil {
		return err
	}
	before.AppMounts = append(before.AppMounts, "bind||"+backupControl(c.Root)+"|/app/backup-control|false")
	sort.Strings(before.AppMounts)
	if err = d.Health(ctx, c, current, before); err != nil {
		return err
	}
	if err = assertProtected(c, protected); err != nil {
		return err
	}
	return os.Remove(journal)
}

func installBackupService(ctx context.Context, root string) error {
	if runtime.GOOS != "linux" || os.Geteuid() != 0 {
		return errors.New("backup-service-install requires Linux/systemd and root")
	}
	c, err := loadBackupConfiguration(root)
	if err != nil {
		return err
	}
	unlock, err := lockInstallation(root)
	if err != nil {
		return err
	}
	defer func() { unlock() }()
	if err = recoverBackupControl(ctx, root); err != nil {
		return err
	}
	if err = recoverBackupExport(ctx, c); err != nil {
		return err
	}
	engine := &Engine{Config: c, Runtime: DockerRuntime{}, Source: GitHubSource{}}
	if err = engine.Recover(ctx); err != nil {
		return err
	}
	owner, err := serviceOwner(root)
	if err != nil {
		return err
	}
	uid, err := strconv.Atoi(owner)
	if err != nil {
		return err
	}
	executable := filepath.Join(root, ".minimail/bin/minimail")
	if info, e := os.Lstat(executable); e != nil || !info.Mode().IsRegular() {
		return errors.New("install the updater executable first")
	}
	name := "minimail-backup-" + c.Project + ".service"
	quote := func(s string) string { return strconv.Quote(strings.ReplaceAll(s, "%", "%%")) }
	unit := "[Unit]\nDescription=MiniMail scoped encrypted installation backups\nAfter=docker.service network-online.target\nRequires=docker.service\nStartLimitIntervalSec=0\n\n[Service]\nType=simple\nUser=" + owner + "\nUMask=0077\nExecStart=" + quote(executable) + " backup-serve --root " + quote(root) + "\nRestart=on-failure\nRestartSec=10s\nTimeoutStopSec=180s\nKillSignal=SIGINT\n\n[Install]\nWantedBy=multi-user.target\n"
	unitPath := filepath.Join("/etc/systemd/system", name)
	if old, e := os.ReadFile(unitPath); e == nil && string(old) != unit {
		return errors.New("a different backup systemd unit exists; refused to replace it")
	}
	if err = initializeBackupControl(root); err != nil {
		return err
	}
	for _, path := range []string{backupControl(root), filepath.Join(backupControl(root), "token")} {
		if err = os.Chown(path, uid, -1); err != nil {
			return err
		}
	}
	store := backupStore(root)
	if err = os.MkdirAll(store, 0700); err != nil {
		return err
	}
	if info, e := os.Lstat(store); e != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("invalid backup storage directory")
	}
	if err = os.Chmod(store, 0700); err != nil {
		return err
	}
	if err = os.Chown(store, uid, -1); err != nil {
		return err
	}
	if err = writeAtomic(unitPath, []byte(unit), 0644); err != nil {
		return err
	}
	// Release the installation lock before starting the independently locked daemon.
	if err = enableBackupControl(ctx, c); err != nil {
		return err
	}
	unlock()
	unlock = func() {}
	if err = exec.CommandContext(ctx, "systemctl", "daemon-reload").Run(); err != nil {
		return err
	}
	if err = exec.CommandContext(ctx, "systemctl", "enable", name).Run(); err != nil {
		return err
	}
	if err = exec.CommandContext(ctx, "systemctl", "restart", name).Run(); err != nil {
		return err
	}
	fmt.Println("Encrypted server backups are available in Administration > Backup. Archives expire after 24 hours; downloads stay encrypted.")
	return nil
}

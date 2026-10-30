package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"time"
	_ "time/tzdata"
)

type Config struct {
	Format       int      `json:"format"`
	Root         string   `json:"root"`
	Project      string   `json:"project"`
	EnvFile      string   `json:"envFile"`
	ComposeFiles []string `json:"composeFiles"`
	Mode         string   `json:"mode"`
	Channel      string   `json:"channel"`
	Timezone     string   `json:"timezone"`
	WindowStart  int      `json:"windowStart"`
	WindowEnd    int      `json:"windowEnd"`
}

var projectPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,62}$`)

func (c Config) validate() error {
	if c.Format != 1 || !projectPattern.MatchString(c.Project) || !filepath.IsAbs(c.Root) || !filepath.IsAbs(c.EnvFile) || len(c.ComposeFiles) == 0 || len(c.ComposeFiles) > 12 {
		return errors.New("invalid updater installation configuration")
	}
	for _, f := range c.ComposeFiles {
		if !filepath.IsAbs(f) {
			return errors.New("compose paths must be absolute")
		}
	}
	if c.Mode != "off" && c.Mode != "notify" && c.Mode != "manual" && c.Mode != "auto" {
		return errors.New("invalid update mode")
	}
	if c.Channel != "stable" && c.Channel != "preview" {
		return errors.New("invalid release channel")
	}
	if c.Mode == "auto" && c.Channel != "stable" {
		return errors.New("automatic updates only accept the stable channel")
	}
	if _, e := time.LoadLocation(c.Timezone); e != nil {
		return e
	}
	if c.WindowStart < 0 || c.WindowStart >= 1440 || c.WindowEnd < 0 || c.WindowEnd >= 1440 || c.WindowStart == c.WindowEnd {
		return errors.New("invalid maintenance window")
	}
	return nil
}
func (c Config) inWindow(now time.Time) bool {
	zone, e := time.LoadLocation(c.Timezone)
	if e != nil {
		return false
	}
	local := now.In(zone)
	minute := local.Hour()*60 + local.Minute()
	if c.WindowStart < c.WindowEnd {
		return minute >= c.WindowStart && minute < c.WindowEnd
	}
	return minute >= c.WindowStart || minute < c.WindowEnd
}

type Deployment struct {
	Version  string `json:"version"`
	Revision string `json:"revision"`
	Image    string `json:"image"`
	Schema   int    `json:"schema"`
	ReadMin  int    `json:"readMin"`
	ReadMax  int    `json:"readMax"`
}
type State struct {
	Current   Deployment  `json:"current"`
	Previous  *Deployment `json:"previous,omitempty"`
	Backup    string      `json:"backup,omitempty"`
	UpdatedAt string      `json:"updatedAt,omitempty"`
}
type Snapshot struct {
	AppID     string         `json:"appId"`
	DBID      string         `json:"databaseId"`
	AppImage  string         `json:"appImage"`
	DBImage   string         `json:"databaseImage"`
	Compose   map[string]any `json:"compose"`
	AppMounts []string       `json:"appMounts"`
	DBMounts  []string       `json:"databaseMounts"`
}
type Transaction struct {
	Format      int                      `json:"format"`
	Backup      string                   `json:"backup"`
	Phase       string                   `json:"phase"`
	Snapshot    Snapshot                 `json:"snapshot"`
	Before      State                    `json:"before"`
	Next        Deployment               `json:"next"`
	Protected   map[string]protectedFile `json:"protected"`
	OldOverride json.RawMessage          `json:"oldOverride,omitempty"`
}
type SchemaStatus struct {
	Schema       int    `json:"schema"`
	Dirty        bool   `json:"dirty"`
	Resumable    bool   `json:"resumable"`
	Version      string `json:"version"`
	Revision     string `json:"revision"`
	Legacy       bool   `json:"legacy"`
	EncryptionOK bool   `json:"encryptionOK"`
}
type UpdateStatus struct {
	Installed  string `json:"installed"`
	Mode       string `json:"mode"`
	Channel    string `json:"channel"`
	Available  string `json:"available,omitempty"`
	ReleaseURL string `json:"releaseUrl,omitempty"`
	CheckedAt  string `json:"checkedAt,omitempty"`
	UpdatedAt  string `json:"updatedAt,omitempty"`
	Result     string `json:"result"`
	Message    string `json:"message,omitempty"`
}

type Runtime interface {
	Snapshot(context.Context, Config) (Snapshot, error)
	Prepare(context.Context, Manifest) error
	Preflight(context.Context, Config, Snapshot, Manifest, string) (SchemaStatus, error)
	Stop(context.Context, Snapshot) error
	Backup(context.Context, Config, Transaction) error
	Migrate(context.Context, Config, Transaction) error
	Start(context.Context, Config, string) error
	Health(context.Context, Config, Deployment, Snapshot) error
	CurrentSchema(context.Context, Config) (int, error)
	Cleanup(context.Context, Config, Transaction) error
}
type Engine struct {
	Config     Config
	Runtime    Runtime
	Source     ReleaseSource
	Now        func() time.Time
	afterPhase func(string) error
}

func (e *Engine) now() time.Time {
	if e.Now != nil {
		return e.Now()
	}
	return time.Now()
}
func (e *Engine) path(name string) string { return filepath.Join(e.Config.Root, ".minimail", name) }
func (e *Engine) imageReference(image string) string {
	if runtime, ok := e.Runtime.(DockerRuntime); ok {
		return runtime.reference(image)
	}
	return image
}
func (e *Engine) loadState() (State, error) {
	var state State
	err := readJSON(e.path("state.json"), &state)
	return state, err
}
func (e *Engine) status(state State, result, message string, m *Manifest) error {
	status := UpdateStatus{Installed: state.Current.Version, Mode: e.Config.Mode, Channel: e.Config.Channel, CheckedAt: e.now().UTC().Format(time.RFC3339), UpdatedAt: state.UpdatedAt, Result: result, Message: message}
	if m != nil && compareVersion(m.Version, state.Current.Version) > 0 {
		status.Available = m.Version
		status.ReleaseURL = "https://github.com/" + repository + "/releases/tag/v" + m.Version
	}
	return writeJSON(e.path("status/updates.json"), status, 0644)
}
func (e *Engine) phase(t *Transaction, phase string) error {
	t.Phase = phase
	if err := writeJSON(e.path("transaction.json"), t, 0600); err != nil {
		return err
	}
	if e.afterPhase != nil {
		return e.afterPhase(phase)
	}
	return nil
}
func nextID(now time.Time) string {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return now.UTC().Format("20060102T150405Z") + "-" + hex.EncodeToString(b[:])
}
func compatible(old Deployment, m Manifest) bool {
	return m.Schema >= old.ReadMin && m.Schema <= old.ReadMax && old.Schema >= m.ReadSchemaMin && old.Schema <= m.ReadSchemaMax
}

func (e *Engine) Check(ctx context.Context, automatic bool) error {
	if err := e.Recover(ctx); err != nil {
		return err
	}
	state, err := e.loadState()
	if err != nil {
		return err
	}
	if automatic && e.Config.Mode == "off" {
		return e.status(state, "disabled", "", nil)
	}
	m, err := e.Source.Fetch(ctx, e.Config.Channel, "")
	if errors.Is(err, errNoRelease) {
		return e.status(state, "current", "No release is published for the selected channel.", nil)
	}
	if err != nil {
		_ = e.status(state, "check-failed", "Release verification or download failed; installation unchanged.", nil)
		return err
	}
	if automatic && e.Config.Mode == "auto" && safeAutomatic(state.Current.Version, m) && compatible(state.Current, m) && e.Config.inWindow(e.now()) {
		return e.Apply(ctx, m, true)
	}
	return e.status(state, "checked", "", &m)
}
func (e *Engine) Apply(ctx context.Context, m Manifest, automatic bool) (result error) {
	if err := m.validate(); err != nil {
		return err
	}
	if err := e.Recover(ctx); err != nil {
		return err
	}
	before, err := e.loadState()
	if err != nil {
		return err
	}
	if compareVersion(m.Version, before.Current.Version) <= 0 {
		return errors.New("target must be newer; use rollback explicitly to return to the previous version")
	}
	if automatic && (!safeAutomatic(before.Current.Version, m) || e.Config.Mode != "auto" || e.Config.Channel != "stable" || !e.Config.inWindow(e.now())) {
		return errors.New("release is not eligible for automatic installation")
	}
	if !compatible(before.Current, m) {
		return errors.New("schema compatibility does not permit safe rollback; a documented manual migration is required, no services changed")
	}
	if m.MinAppVersion != "" {
		if _, err := parseVersion(before.Current.Version); err != nil || compareVersion(before.Current.Version, m.MinAppVersion) < 0 {
			return fmt.Errorf("install compatibility release %s first; no services changed", m.MinAppVersion)
		}
	}
	protected, err := protectedFiles(e.Config)
	if err != nil {
		return err
	}
	snapshot, err := e.Runtime.Snapshot(ctx, e.Config)
	if err != nil {
		return err
	}
	if err = e.Runtime.Health(ctx, e.Config, before.Current, snapshot); err != nil {
		return err
	}
	if err = e.Runtime.Prepare(ctx, m); err != nil {
		return err
	}
	backup := e.path(filepath.Join("backups", nextID(e.now())))
	if err = os.Mkdir(backup, 0700); err != nil {
		return err
	}
	syncDirectory(filepath.Dir(backup))
	if err = backupConfiguration(backup, protected); err != nil {
		return err
	}
	if err = writeJSON(filepath.Join(backup, "snapshot.json"), snapshot, 0600); err != nil {
		return err
	}
	schema, err := e.Runtime.Preflight(ctx, e.Config, snapshot, m, backup)
	if err != nil {
		return err
	}
	if (schema.Dirty && !schema.Resumable) || !schema.EncryptionOK || schema.Schema < before.Current.ReadMin || schema.Schema > before.Current.ReadMax || schema.Schema > m.Schema {
		return errors.New("database schema/encryption preflight failed; no services changed")
	}
	next := Deployment{m.Version, m.Revision, m.Image, m.Schema, m.ReadSchemaMin, m.ReadSchemaMax}
	t := Transaction{Format: 1, Backup: backup, Snapshot: snapshot, Before: before, Next: next, Protected: protected}
	if raw, readErr := os.ReadFile(e.path("current.compose.json")); readErr == nil {
		t.OldOverride = raw
	} else if !os.IsNotExist(readErr) {
		return readErr
	}
	nextOverride, err := preserveImageOverride(t.OldOverride, e.imageReference(next.Image), e.path("status"))
	if err != nil {
		return err
	}
	if err = assertProtected(e.Config, protected); err != nil {
		return err
	}
	// Persist the recovery journal before stopping the sole application writer.
	if err = e.phase(&t, "prepared"); err != nil {
		return err
	}
	// Once maintenance starts, Ctrl-C does not cancel recovery half-way through.
	safeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Minute)
	defer cancel()
	defer func() {
		if result != nil {
			recovery := e.Recover(safeCtx)
			if recovery != nil {
				result = fmt.Errorf("%w; recovery requires attention: %v", result, recovery)
			}
		}
	}()
	if err = e.phase(&t, "stopping"); err != nil {
		return err
	}
	if err = e.Runtime.Stop(safeCtx, snapshot); err != nil {
		return err
	}
	if err = e.phase(&t, "backing-up"); err != nil {
		return err
	}
	if err = e.Runtime.Backup(safeCtx, e.Config, t); err != nil {
		return err
	}
	if err = assertProtected(e.Config, protected); err != nil {
		return err
	}
	if err = e.phase(&t, "migrating"); err != nil {
		return err
	}
	if err = e.Runtime.Migrate(safeCtx, e.Config, t); err != nil {
		return err
	}
	if err = e.phase(&t, "starting"); err != nil {
		return err
	}
	if err = e.Runtime.Start(safeCtx, e.Config, filepath.Join(backup, "next.compose.json")); err != nil {
		return err
	}
	if err = e.Runtime.Health(safeCtx, e.Config, next, snapshot); err != nil {
		return err
	}
	if err = assertProtected(e.Config, protected); err != nil {
		return err
	}
	if err = e.phase(&t, "committing"); err != nil {
		return err
	}
	if err = writeJSON(e.path("current.compose.json"), nextOverride, 0600); err != nil {
		return err
	}
	after := State{Current: next, Previous: &before.Current, Backup: backup, UpdatedAt: e.now().UTC().Format(time.RFC3339)}
	if err = writeJSON(e.path("state.json"), after, 0600); err != nil {
		return err
	}
	if err = e.Runtime.Cleanup(safeCtx, e.Config, t); err != nil {
		return err
	}
	if err = e.phase(&t, "committed"); err != nil {
		return err
	}
	if err = os.Remove(e.path("transaction.json")); err != nil {
		return err
	}
	syncDirectory(e.path("."))
	return e.status(after, "updated", "", nil)
}

func (e *Engine) Recover(ctx context.Context) error {
	var t Transaction
	err := readJSON(e.path("transaction.json"), &t)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if t.Format != 1 || filepath.Dir(t.Backup) != e.path("backups") {
		return errors.New("invalid recovery journal; refused to modify services")
	}
	if t.Phase == "committed" {
		state, err := e.loadState()
		if err != nil {
			return err
		}
		if state.Current.Version != t.Next.Version || state.Current.Image != t.Next.Image {
			return errors.New("committed updater state is inconsistent; database/configuration left untouched")
		}
		if err = e.Runtime.Cleanup(ctx, e.Config, t); err != nil {
			return err
		}
		if err = os.Remove(e.path("transaction.json")); err != nil {
			return err
		}
		syncDirectory(e.path("."))
		return e.status(state, "updated", "Committed update recovered without reverting data or configuration.", nil)
	}
	if t.Phase == "prepared" {
		if err = e.Runtime.Cleanup(ctx, e.Config, t); err != nil {
			return err
		}
		return os.Remove(e.path("transaction.json"))
	}
	// Restoring a SQL backup automatically would lose mail/user changes. Recover
	// only the program image, and only within its declared schema read range.
	schema, err := e.Runtime.CurrentSchema(ctx, e.Config)
	if err != nil {
		return err
	}
	if schema < t.Before.Current.ReadMin || schema > t.Before.Current.ReadMax {
		return errors.New("previous image cannot read the current schema; database kept intact, manual recovery required")
	}
	if err = e.Runtime.Start(ctx, e.Config, filepath.Join(t.Backup, "previous.compose.json")); err != nil {
		return err
	}
	if err = e.Runtime.Health(ctx, e.Config, t.Before.Current, t.Snapshot); err != nil {
		return err
	}
	// Recovery starts the exact previous image ID. Keep our own image pointer in
	// step with that frozen spec so a later retry does not mistake a tag-vs-ID
	// spelling difference for an operator's private configuration change.
	override := map[string]any{"services": map[string]any{"minimail": map[string]any{}}}
	if len(t.OldOverride) > 0 {
		if err = json.Unmarshal(t.OldOverride, &override); err != nil {
			return err
		}
	}
	app, err := service(override, "minimail")
	if err != nil {
		return err
	}
	app["image"] = t.Snapshot.AppImage
	app["pull_policy"] = "never"
	if err = writeJSON(e.path("current.compose.json"), override, 0600); err != nil {
		return err
	}
	if err = writeJSON(e.path("state.json"), t.Before, 0600); err != nil {
		return err
	}
	if err = e.Runtime.Cleanup(ctx, e.Config, t); err != nil {
		return err
	}
	if err = os.Remove(e.path("transaction.json")); err != nil {
		return err
	}
	return e.status(t.Before, "recovered", "Previous application restored; SQL data and private configuration were not restored or overwritten.", nil)
}

func (e *Engine) Rollback(ctx context.Context) (result error) {
	if err := e.Recover(ctx); err != nil {
		return err
	}
	state, err := e.loadState()
	if err != nil {
		return err
	}
	if state.Previous == nil || state.Backup == "" {
		return errors.New("no previous application version is recorded")
	}
	var protected map[string]protectedFile
	if err = readJSON(filepath.Join(state.Backup, "protected.json"), &protected); err != nil {
		return err
	}
	if err = assertProtected(e.Config, protected); err != nil {
		return err
	}
	schema, err := e.Runtime.CurrentSchema(ctx, e.Config)
	if err != nil {
		return err
	}
	if schema < state.Previous.ReadMin || schema > state.Previous.ReadMax {
		return errors.New("previous application cannot read current schema; no changes made")
	}
	current, err := e.Runtime.Snapshot(ctx, e.Config)
	if err != nil {
		return err
	}
	folder := e.path(filepath.Join("backups", nextID(e.now())+"-rollback"))
	if err = os.Mkdir(folder, 0700); err != nil {
		return err
	}
	syncDirectory(filepath.Dir(folder))
	if err = backupConfiguration(folder, protected); err != nil {
		return err
	}
	if err = writeJSON(filepath.Join(folder, "snapshot.json"), current, 0600); err != nil {
		return err
	}
	if err = prepareFrozen(folder, current, e.Config, e.imageReference(state.Previous.Image)); err != nil {
		return err
	}
	t := Transaction{Format: 1, Backup: folder, Snapshot: current, Before: state, Next: *state.Previous, Protected: protected}
	t.OldOverride, _ = os.ReadFile(e.path("current.compose.json"))
	nextOverride, err := preserveImageOverride(t.OldOverride, e.imageReference(state.Previous.Image), e.path("status"))
	if err != nil {
		return err
	}
	if err = e.phase(&t, "prepared"); err != nil {
		return err
	}
	safeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Minute)
	defer cancel()
	defer func() {
		if result != nil {
			if recovery := e.Recover(safeCtx); recovery != nil {
				result = fmt.Errorf("%w; recovery requires attention: %v", result, recovery)
			}
		}
	}()
	if err = e.phase(&t, "stopping"); err != nil {
		return err
	}
	if err = e.Runtime.Stop(safeCtx, current); err != nil {
		return err
	}
	if err = e.phase(&t, "backing-up"); err != nil {
		return err
	}
	if err = e.Runtime.Backup(safeCtx, e.Config, t); err != nil {
		return err
	}
	if err = assertProtected(e.Config, protected); err != nil {
		return err
	}
	if err = e.phase(&t, "starting"); err != nil {
		return err
	}
	if err = e.Runtime.Start(safeCtx, e.Config, filepath.Join(folder, "next.compose.json")); err != nil {
		return err
	}
	if err = e.Runtime.Health(safeCtx, e.Config, *state.Previous, current); err != nil {
		return err
	}
	if err = assertProtected(e.Config, protected); err != nil {
		return err
	}
	if err = e.phase(&t, "committing"); err != nil {
		return err
	}
	if err = writeJSON(e.path("current.compose.json"), nextOverride, 0600); err != nil {
		return err
	}
	next := State{Current: *state.Previous, Previous: &state.Current, Backup: folder, UpdatedAt: e.now().UTC().Format(time.RFC3339)}
	if err = writeJSON(e.path("state.json"), next, 0600); err != nil {
		return err
	}
	if err = e.Runtime.Cleanup(safeCtx, e.Config, t); err != nil {
		return err
	}
	if err = e.phase(&t, "committed"); err != nil {
		return err
	}
	if err = os.Remove(e.path("transaction.json")); err != nil {
		return err
	}
	return e.status(next, "rolled-back", "Application reverted; SQL data and private configuration preserved.", nil)
}

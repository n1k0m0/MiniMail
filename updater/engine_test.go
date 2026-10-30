package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testManifest() Manifest {
	return Manifest{Format: 1, Version: "0.1.1", Revision: strings.Repeat("a", 40), Image: "ghcr.io/n1k0m0/minimail@sha256:" + strings.Repeat("b", 64), DatabaseImage: "ghcr.io/n1k0m0/minimail-database@sha256:" + strings.Repeat("c", 64), Schema: 1, ReadSchemaMin: 1, ReadSchemaMax: 1, MinUpdater: "0.1.0", AutomaticPatchSafe: true, Assets: map[string]string{"test.zip": strings.Repeat("d", 64)}}
}

type fakeRuntime struct {
	snapshot Snapshot
	calls    []string
	active   string
	schema   int
	fail     string
	onStart  func(string)
}

func (r *fakeRuntime) Snapshot(context.Context, Config) (Snapshot, error) {
	r.calls = append(r.calls, "snapshot")
	s := r.snapshot
	if r.active != "stopped" {
		s.AppImage = r.active
		s.Compose = cloneSpec(s.Compose)
		app, _ := service(s.Compose, "minimail")
		app["image"] = r.active
	}
	return s, nil
}
func (r *fakeRuntime) Prepare(context.Context, Manifest) error {
	r.calls = append(r.calls, "pull")
	if r.fail == "pull" {
		return errors.New("pull failed")
	}
	return nil
}
func (r *fakeRuntime) Preflight(_ context.Context, c Config, s Snapshot, m Manifest, p string) (SchemaStatus, error) {
	r.calls = append(r.calls, "preflight")
	if err := prepareFrozen(p, s, c, m.Image); err != nil {
		return SchemaStatus{}, err
	}
	return SchemaStatus{Schema: r.schema, EncryptionOK: true}, nil
}
func (r *fakeRuntime) Stop(context.Context, Snapshot) error {
	r.calls = append(r.calls, "stop")
	r.active = "stopped"
	return nil
}
func (r *fakeRuntime) Backup(context.Context, Config, Transaction) error {
	r.calls = append(r.calls, "backup-and-restore")
	if r.fail == "backup" {
		return errors.New("backup restore mismatch")
	}
	return nil
}
func (r *fakeRuntime) Migrate(context.Context, Config, Transaction) error {
	r.calls = append(r.calls, "migrate")
	if r.fail == "migration" {
		return errors.New("migration failed")
	}
	return nil
}
func (r *fakeRuntime) Start(_ context.Context, _ Config, file string) error {
	r.calls = append(r.calls, "start")
	var spec map[string]any
	if err := readJSON(file, &spec); err != nil {
		return err
	}
	app, _ := service(spec, "minimail")
	r.active = app["image"].(string)
	if r.onStart != nil {
		r.onStart(r.active)
	}
	return nil
}
func (r *fakeRuntime) Health(_ context.Context, _ Config, d Deployment, _ Snapshot) error {
	r.calls = append(r.calls, "health")
	if r.fail == "health" && d.Version != "0.1.0" {
		return errors.New("health failed")
	}
	return nil
}
func (r *fakeRuntime) CurrentSchema(context.Context, Config) (int, error) { return r.schema, nil }
func (r *fakeRuntime) Cleanup(context.Context, Config, Transaction) error { return nil }

type fixtureSource struct{ manifest Manifest }

func (f fixtureSource) Fetch(context.Context, string, string) (Manifest, error) {
	return f.manifest, nil
}
func fixtureEngine(t *testing.T) (*Engine, *fakeRuntime) {
	t.Helper()
	root := t.TempDir()
	env := filepath.Join(root, ".env")
	compose := filepath.Join(root, "compose.yaml")
	os.WriteFile(env, []byte("APP_ENCRYPTION_KEY="+strings.Repeat("a", 64)+"\nMYSQL_PASSWORD=keep-this-$VALUE\n"), 0600)
	os.WriteFile(compose, []byte("private: configuration\n"), 0600)
	os.Mkdir(filepath.Join(root, "local"), 0700)
	os.WriteFile(filepath.Join(root, "local", "private.conf"), []byte("preserve private configuration"), 0600)
	if err := ensureStateDir(root); err != nil {
		t.Fatal(err)
	}
	config := Config{1, root, "minimail-test", env, []string{compose}, "notify", "stable", "Europe/Berlin", 180, 240}
	old := Deployment{"0.1.0", strings.Repeat("a", 40), "ghcr.io/n1k0m0/minimail@sha256:" + strings.Repeat("a", 64), 1, 1, 1}
	runtime := &fakeRuntime{schema: 1, active: old.Image, snapshot: Snapshot{AppID: "app", DBID: "database", AppImage: old.Image, Compose: map[string]any{"services": map[string]any{"minimail": map[string]any{"image": old.Image, "environment": map[string]any{"SECRET": "keep-$VALUE"}}}}}}
	engine := &Engine{Config: config, Runtime: runtime, Source: fixtureSource{testManifest()}, Now: func() time.Time { return time.Date(2026, 10, 30, 2, 15, 0, 0, time.UTC) }}
	if err := writeJSON(engine.path("config.json"), config, 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(engine.path("state.json"), State{Current: old}, 0600); err != nil {
		t.Fatal(err)
	}
	return engine, runtime
}
func TestSuccessfulUpdateAndRollbackPreserveDataAndConfiguration(t *testing.T) {
	e, r := fixtureEngine(t)
	before, _ := protectedFiles(e.Config)
	data := filepath.Join(e.Config.Root, "data-sentinel")
	os.WriteFile(data, []byte("original encrypted data"), 0600)
	if err := e.Apply(context.Background(), testManifest(), false); err != nil {
		t.Fatal(err)
	}
	if err := assertProtected(e.Config, before); err != nil {
		t.Fatal(err)
	}
	state, _ := e.loadState()
	if state.Current.Version != "0.1.1" || state.Previous.Version != "0.1.0" {
		t.Fatal(state)
	}
	os.WriteFile(data, []byte("new mail after the update"), 0600)
	if err := e.Rollback(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := assertProtected(e.Config, before); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(data)
	if string(raw) != "new mail after the update" {
		t.Fatal("rollback lost newly written data")
	}
	state, _ = e.loadState()
	if state.Current.Version != "0.1.0" || r.active != state.Current.Image {
		t.Fatal(state, r.active)
	}
	if err := e.Rollback(context.Background()); err != nil {
		t.Fatal(err)
	}
	state, _ = e.loadState()
	if state.Current.Version != "0.1.1" {
		t.Fatal("second rollback could not return to newer image")
	}
}
func TestFailureStagesRecoverWithoutRestoringSQLOrSecrets(t *testing.T) {
	for _, failure := range []string{"pull", "backup", "migration", "health"} {
		t.Run(failure, func(t *testing.T) {
			e, r := fixtureEngine(t)
			r.fail = failure
			before, _ := protectedFiles(e.Config)
			if err := e.Apply(context.Background(), testManifest(), false); err == nil {
				t.Fatal("expected failure")
			}
			state, _ := e.loadState()
			if state.Current.Version != "0.1.0" || r.active != state.Current.Image {
				t.Fatal("previous app was not recovered", state, r.active)
			}
			if err := assertProtected(e.Config, before); err != nil {
				t.Fatal(err)
			}
			if failure == "backup" && strings.Contains(strings.Join(r.calls, ","), "migrate") {
				t.Fatal("migration ran despite invalid backup")
			}
		})
	}
}
func TestPowerLossAtEveryDurablePhaseCanRecover(t *testing.T) {
	for _, phase := range []string{"prepared", "stopping", "backing-up", "migrating", "starting", "committing"} {
		t.Run(phase, func(t *testing.T) {
			e, r := fixtureEngine(t)
			e.afterPhase = func(p string) error {
				if p == phase {
					panic("simulated process loss")
				}
				return nil
			}
			func() {
				defer func() {
					if recover() == nil {
						t.Fatal("fault hook was not reached")
					}
				}()
				_ = e.Apply(context.Background(), testManifest(), false)
			}()
			e.afterPhase = nil
			if err := e.Recover(context.Background()); err != nil {
				t.Fatal(err)
			}
			state, _ := e.loadState()
			if state.Current.Version != "0.1.0" || r.active != state.Current.Image {
				t.Fatal("interrupted update was not recovered", r.active)
			}
			if _, err := os.Stat(e.path("transaction.json")); !os.IsNotExist(err) {
				t.Fatal("recovery journal not cleared")
			}
		})
	}
}
func TestConfigurationEditedDuringUpdateIsNotOverwritten(t *testing.T) {
	e, r := fixtureEngine(t)
	original, _ := os.ReadFile(e.Config.EnvFile)
	modified := append(original, []byte("# operator change\n")...)
	r.onStart = func(image string) {
		if image == testManifest().Image {
			os.WriteFile(e.Config.EnvFile, modified, 0600)
		}
	}
	if err := e.Apply(context.Background(), testManifest(), false); err == nil {
		t.Fatal("configuration edit should stop the update")
	}
	actual, _ := os.ReadFile(e.Config.EnvFile)
	if string(actual) != string(modified) {
		t.Fatal("operator configuration was overwritten")
	}
	state, _ := e.loadState()
	if state.Current.Version != "0.1.0" {
		t.Fatal(state)
	}
}
func TestPowerLossAfterCommitKeepsTheNewVersion(t *testing.T) {
	e, r := fixtureEngine(t)
	e.afterPhase = func(phase string) error {
		if phase == "committed" {
			panic("power loss after durable commit")
		}
		return nil
	}
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("commit hook not reached")
			}
		}()
		_ = e.Apply(context.Background(), testManifest(), false)
	}()
	e.afterPhase = nil
	if err := e.Recover(context.Background()); err != nil {
		t.Fatal(err)
	}
	state, _ := e.loadState()
	if state.Current.Version != "0.1.1" || r.active != state.Current.Image {
		t.Fatal("committed update was incorrectly reverted")
	}
}
func TestNewSecretCreationNeverReplacesAnExistingKey(t *testing.T) {
	file := filepath.Join(t.TempDir(), ".env")
	if err := writeNew(file, []byte("original key")); err != nil {
		t.Fatal(err)
	}
	if err := writeNew(file, []byte("replacement")); err == nil {
		t.Fatal("existing secret was overwritten")
	}
	raw, _ := os.ReadFile(file)
	if string(raw) != "original key" {
		t.Fatal("key changed")
	}
}
func TestOversizedRecoveryMetadataIsRefusedBeforeReplacingState(t *testing.T) {
	file := filepath.Join(t.TempDir(), "state.json")
	if err := writeJSON(file, map[string]string{"version": "original"}, 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(file, map[string]string{"oversized": strings.Repeat("x", 4<<20)}, 0600); err == nil {
		t.Fatal("unrecoverable metadata was written")
	}
	var value map[string]string
	if err := readJSON(file, &value); err != nil || value["version"] != "original" {
		t.Fatal("original state was not retained")
	}
}
func TestIncompatibleSchemaStopsBeforePullOrMaintenance(t *testing.T) {
	e, r := fixtureEngine(t)
	m := testManifest()
	m.Schema = 2
	m.ReadSchemaMax = 2
	if err := e.Apply(context.Background(), m, false); err == nil {
		t.Fatal("incompatible schema accepted")
	}
	if len(r.calls) != 0 {
		t.Fatal(r.calls)
	}
}
func TestAutomaticPolicyRequiresStablePatchWindowAndExplicitOptIn(t *testing.T) {
	e, r := fixtureEngine(t)
	if err := e.Check(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	if r.active == testManifest().Image {
		t.Fatal("notify mode applied an update")
	}
	e.Config.Mode = "auto"
	if err := e.Check(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	if r.active != testManifest().Image {
		t.Fatal("eligible patch was not applied")
	}
	for _, next := range []string{"0.2.0", "1.0.0", "0.1.2-rc.1", "0.1.0"} {
		m := testManifest()
		m.Version = next
		if safeAutomatic("0.1.0", m) {
			t.Fatal("unsafe automatic target", next)
		}
	}
	e.Config.Timezone = "Europe/Berlin"
	if e.Config.inWindow(time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)) {
		t.Fatal("outside maintenance window")
	}
	e.Config.Channel = "preview"
	if e.Config.validate() == nil {
		t.Fatal("automatic previews accepted")
	}
}
func TestSignaturesAuthenticateTheEntireManifest(t *testing.T) {
	public, private, _ := ed25519.GenerateKey(rand.Reader)
	der, _ := x509.MarshalPKIXPublicKey(public)
	key := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})
	raw, _ := json.Marshal(testManifest())
	signature := []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(private, raw)))
	if _, err := verifyManifest(raw, signature, key); err != nil {
		t.Fatal(err)
	}
	tampered := []byte(strings.Replace(string(raw), "0.1.1", "0.1.2", 1))
	if _, err := verifyManifest(tampered, signature, key); err == nil {
		t.Fatal("modified manifest accepted")
	}
	if _, err := verifyManifest(raw, signature, trustedKeyPEM); err == nil {
		t.Fatal("untrusted signer accepted")
	}
}
func TestExclusiveLockAndFrozenSecretInterpolation(t *testing.T) {
	e, r := fixtureEngine(t)
	unlock, err := lockInstallation(e.Config.Root)
	if err != nil {
		t.Fatal(err)
	}
	if another, err := lockInstallation(e.Config.Root); err == nil {
		another()
		t.Fatal("concurrent lock accepted")
	}
	unlock()
	unlock, err = lockInstallation(e.Config.Root)
	if err != nil {
		t.Fatal(err)
	}
	unlock()
	frozen := frozenSpec(r.snapshot, e.Config, r.snapshot.AppImage, false)
	s, _ := service(frozen, "minimail")
	if s["environment"].(map[string]any)["SECRET"] != "keep-$$VALUE" {
		t.Fatal("Compose would interpolate an existing secret a second time")
	}
	for _, secret := range []string{"keep-$VALUE", "literal-$$pair", "${NOT_AN_ENVIRONMENT_VARIABLE} with spaces"} {
		decoded := unescaped(escaped(secret))
		if decoded != secret {
			t.Fatal("Compose canonical output did not retain the original credential")
		}
	}
}

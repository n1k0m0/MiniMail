package main

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"
)

func TestFrozenUpdatePreservesManagedMountOrder(t *testing.T) {
	c := Config{Root: t.TempDir()}
	current := imageOverride("old-image", filepath.Join(c.Root, ".minimail/status"))
	app, err := service(current, "minimail")
	if err != nil {
		t.Fatal(err)
	}
	mounts := app["volumes"].([]any)
	app["volumes"] = append(mounts, map[string]any{"type": "bind", "source": backupControl(c.Root), "target": "/app/backup-control", "read_only": true, "bind": map[string]any{"create_host_path": false}})
	raw, _ := json.Marshal(current)
	managed, err := preserveImageOverride(raw, "new-image", filepath.Join(c.Root, ".minimail/status"))
	if err != nil {
		t.Fatal(err)
	}
	frozen := unescaped(frozenSpec(Snapshot{Compose: current}, c, "new-image", true)).(map[string]any)
	if !reflect.DeepEqual(managed, frozen) {
		before, _ := json.Marshal(managed)
		after, _ := json.Marshal(frozen)
		t.Fatalf("frozen startup differs from persistent image configuration: %s / %s", before, after)
	}
}

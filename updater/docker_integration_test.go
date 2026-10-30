//go:build !windows

package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Only image transport is substituted with locally built fixtures. Containers,
// private configuration, MySQL dumps/restores, migrations, health and rollback
// use the real Docker runtime. This cannot be selected through the public CLI.
func TestDockerLifecycle(t *testing.T) {
	runDockerLifecycle(t, false)
}
func TestDockerPreviousReleaseUpgrade(t *testing.T) {
	if os.Getenv("MINIMAIL_TEST_BASELINE_IMAGE") == "" {
		t.Skip("previous release image is unavailable")
	}
	runDockerLifecycle(t, true)
}
func runDockerLifecycle(t *testing.T, previousRelease bool) {
	if os.Getenv("MINIMAIL_DOCKER_TEST") != "1" {
		t.Skip("requires disposable Docker test images")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	oldImage, newImage, dbImage := os.Getenv("MINIMAIL_TEST_OLD_IMAGE"), os.Getenv("MINIMAIL_TEST_NEW_IMAGE"), os.Getenv("MINIMAIL_TEST_DB_IMAGE")
	if previousRelease {
		oldImage = os.Getenv("MINIMAIL_TEST_BASELINE_IMAGE")
	}
	if oldImage == "" || newImage == "" || dbImage == "" {
		t.Fatal("test images are missing")
	}
	root := filepath.Join(t.TempDir(), "installation with spaces")
	if e := os.Mkdir(root, 0700); e != nil {
		t.Fatal(e)
	}
	if e := ensureStateDir(root); e != nil {
		t.Fatal(e)
	}
	project := "minimail-e2e-" + strings.ToLower(randomHex()[:12])
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		ids, _ := docker(cleanup, "ps", "-aq", "--filter", "label=com.docker.compose.project="+project)
		for _, id := range strings.Fields(string(ids)) {
			_, _ = docker(cleanup, "rm", "-f", "-v", id)
		}
		ids, _ = docker(cleanup, "ps", "-aq", "--filter", "label=io.minimail.backup-check="+project)
		for _, id := range strings.Fields(string(ids)) {
			_, _ = docker(cleanup, "rm", "-f", "-v", id)
		}
		for _, kind := range []string{"volume", "network"} {
			items, _ := docker(cleanup, kind, "ls", "-q", "--filter", "label=com.docker.compose.project="+project)
			for _, item := range strings.Fields(string(items)) {
				_, _ = docker(cleanup, kind, "rm", item)
			}
		}
	})
	public, private, _ := ed25519.GenerateKey(rand.Reader)
	der, _ := x509.MarshalPKIXPublicKey(public)
	previousKey := trustedKeyPEM
	trustedKeyPEM = pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})
	defer func() { trustedKeyPEM = previousKey }()
	bundle := t.TempDir()
	m := testManifest()
	m.Version = "0.0.0"
	oldCanonical := "ghcr.io/n1k0m0/minimail@sha256:" + strings.Repeat("e", 64)
	m.Image = oldCanonical
	spec := `services:
  minimail:
    image: ` + oldImage + `
    depends_on:
      database:
        condition: service_healthy
    read_only: true
    tmpfs: [/tmp]
    environment:
      APP_ENCRYPTION_KEY: ${APP_ENCRYPTION_KEY:?}
      MYSQL_HOST: database
      MYSQL_PORT: "3306"
      MYSQL_DATABASE: minimail
      MYSQL_USER: minimail
      MYSQL_PASSWORD: ${MYSQL_PASSWORD:?}
      DISABLE_MAIL_CHECKS: "1"
    volumes: [app-data:/app/data]
  database:
    image: ` + dbImage + `
    environment:
      MYSQL_DATABASE: minimail
      MYSQL_USER: minimail
      MYSQL_PASSWORD: ${MYSQL_PASSWORD:?}
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:?}
    volumes: [database-data:/var/lib/mysql]
    healthcheck:
      test: [CMD, mysqladmin, ping, -h, 127.0.0.1, --silent]
      interval: 2s
      timeout: 3s
      retries: 40
volumes:
  app-data:
  database-data:
`
	files := map[string][]byte{"compose.yaml": []byte(spec), "compose.vpn.yaml": []byte("services: {}\n"), "compose.https.yaml": []byte("services: {}\n"), "Caddyfile.example": []byte("# synthetic\n"), "LICENSE": []byte("Apache-2.0 fixture\n"), "NOTICE": []byte("Synthetic fixture\n")}
	m.Assets = map[string]string{}
	for name, raw := range files {
		if e := os.WriteFile(filepath.Join(bundle, name), raw, 0600); e != nil {
			t.Fatal(e)
		}
		m.Assets[name] = hashBytes(raw)
	}
	raw, _ := json.Marshal(m)
	os.WriteFile(filepath.Join(bundle, "bundle.json"), raw, 0600)
	os.WriteFile(filepath.Join(bundle, "bundle.json.sig"), []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(private, raw))), 0600)
	// Resume a new install at its durable secret-generation boundary. This also
	// tests literal $, spaces, existing encryption keys and interrupted setup.
	if e := writeJSON(filepath.Join(root, ".minimail/installing.json"), m, 0600); e != nil {
		t.Fatal(e)
	}
	env := []byte("APP_ENCRYPTION_KEY=" + randomHex() + "\nMYSQL_PASSWORD='synthetic-$password with spaces'\nMYSQL_ROOT_PASSWORD=" + randomHex() + "\n# operator configuration must remain byte-identical\n")
	if e := os.WriteFile(filepath.Join(root, ".env"), env, 0600); e != nil {
		t.Fatal(e)
	}
	d := DockerRuntime{fixtureImages: map[string]string{oldCanonical: oldImage, testManifest().Image: newImage}}
	if previousRelease {
		if err := os.WriteFile(filepath.Join(root, "compose.yaml"), []byte(spec), 0600); err != nil {
			t.Fatal(err)
		}
		c := Config{1, root, project, filepath.Join(root, ".env"), []string{filepath.Join(root, "compose.yaml")}, "notify", "stable", "UTC", 180, 240}
		if _, err := docker(ctx, append(composeArgs(c, c.ComposeFiles), "up", "-d", "--wait", "--wait-timeout", "180")...); err != nil {
			t.Fatal("baseline start:", err)
		}
		if err := adopt(ctx, root); err != nil {
			t.Fatal("adopt previous version:", err)
		}
	} else if e := installWith(ctx, root, bundle, project, "release-test", d); e != nil {
		t.Fatal("fresh installation:", e)
	}
	var config Config
	if e := readJSON(filepath.Join(root, ".minimail/config.json"), &config); e != nil {
		t.Fatal(e)
	}
	e := Engine{Config: config, Runtime: d}
	id, err := containerID(ctx, config, "minimail")
	if err != nil {
		t.Fatal(err)
	}
	seed := `import {db} from '/app/server/db.js';import {encrypt} from '/app/server/security.js';import fs from 'node:fs';
 if(!(await db.prepare('SELECT id FROM users LIMIT 1').get()))await db.prepare('INSERT INTO users(username,password_hash,created_at,role) VALUES (?,?,?,?)').run('fixture-user','unused-synthetic-hash',1,'admin');
 const owner=(await db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()).id;
 await db.prepare('INSERT INTO accounts(user_id,name,email,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,username,password_enc,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(owner,'Synthetic','owner@example.test','imap.example.test',993,1,'smtp.example.test',465,1,'owner',encrypt('encrypted credential $value'),1);
 await db.prepare('INSERT INTO drafts(user_id,id,data_enc,updated_at) VALUES (?,?,?,?)').run(owner,'preserved',encrypt(JSON.stringify({text:'Private draft Ä',attachments:[{name:'data.bin',data:'AP8='}]})),1);
 await db.prepare('INSERT INTO contacts(user_id,name,email,created_at,updated_at) VALUES (?,?,?,?,?)').run(owner,'Änne','contact@example.test',1,1);
 await db.prepare('UPDATE users SET totp_secret=? WHERE id=?').run(encrypt('JBSWY3DPEHPK3PXP'),owner);
 await db.prepare('INSERT INTO auth_totp_state(user_id,secret_hash,last_counter) VALUES (?,?,?)').run(owner,'f'.repeat(64),12345);
 fs.writeFileSync('/app/data/preserved.bin',Buffer.from([0,255,1,7]));await db.close();`
	seedCommand := exec.CommandContext(ctx, "docker", "exec", "-i", id, "sh", "-c", "cat > /tmp/release-seed.mjs")
	seedCommand.Stdin = strings.NewReader(seed)
	if err = seedCommand.Run(); err != nil {
		t.Fatal(err)
	}
	if _, err = docker(ctx, "exec", id, "node", "/tmp/release-seed.mjs"); err != nil {
		t.Fatal(err)
	}
	protected, err := protectedFiles(config)
	if err != nil {
		t.Fatal(err)
	}
	databaseID, err := containerID(ctx, config, "database")
	if err != nil {
		t.Fatal(err)
	}
	before, err := inventory(ctx, databaseID, "minimail", false)
	if err != nil {
		t.Fatal(err)
	}
	next := testManifest()
	next.Version = "999.0.0-rc.1"
	if err = e.Apply(ctx, next, false); err != nil {
		t.Fatal("upgrade:", err)
	}
	if err = assertProtected(config, protected); err != nil {
		t.Fatal(err)
	}
	after, err := inventory(ctx, databaseID, "minimail", false)
	if err != nil {
		t.Fatal(err)
	}
	if previousRelease {
		delete(before, "schema_migrations")
		delete(after, "schema_migrations")
	}
	a, _ := json.Marshal(before)
	b, _ := json.Marshal(after)
	if string(a) != string(b) {
		t.Fatal("upgrade changed existing rows/checksums")
	}
	if _, err = sql(ctx, databaseID, "UPDATE contacts SET name='New data after update' WHERE email='contact@example.test'"); err != nil {
		t.Fatal(err)
	}
	postUpdate, err := inventory(ctx, databaseID, "minimail", false)
	if err != nil {
		t.Fatal(err)
	}
	if err = e.Rollback(ctx); err != nil {
		t.Fatal("rollback:", err)
	}
	after, err = inventory(ctx, databaseID, "minimail", false)
	if err != nil {
		t.Fatal(err)
	}
	a, _ = json.Marshal(postUpdate)
	b, _ = json.Marshal(after)
	if string(a) != string(b) {
		t.Fatal("rollback lost newly written SQL data")
	}
	if err = assertProtected(config, protected); err != nil {
		t.Fatal(err)
	}
	id, err = containerID(ctx, config, "minimail")
	if err != nil {
		t.Fatal(err)
	}
	value, err := docker(ctx, "exec", id, "node", "-e", `const fs=require('fs');if(fs.readFileSync('/app/data/preserved.bin').toString('hex')!=='00ff0107')process.exit(1)`)
	if err != nil {
		t.Fatal(err, string(value))
	}
	if !previousRelease {
		if err = installWith(ctx, root, bundle, project, "another-admin", d); err != nil {
			t.Fatal("idempotent installer:", err)
		}
	}
	if err = assertProtected(config, protected); err != nil {
		t.Fatal(err)
	}
	t.Log("Fresh install, verified dump/restore, upgrade and rollback preserve ciphertext, credentials, 2FA replay state, drafts, binary files, private configuration and post-update writes.")
}

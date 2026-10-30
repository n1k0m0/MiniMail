package main

import (
	"archive/tar"
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInstallationEncryptionAuthenticatesAndNeverOverwrites(t *testing.T) {
	folder := t.TempDir()
	plain := filepath.Join(folder, "plain")
	encrypted := filepath.Join(folder, "backup.age")
	restored := filepath.Join(folder, "restored")
	password := "synthetic-long-backup-passphrase"
	if err := os.WriteFile(plain, []byte("private synthetic state"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := encryptInstallation(plain, encrypted, password); err != nil {
		t.Fatal(err)
	}
	if err := decryptInstallation(encrypted, restored, password); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(restored)
	if string(raw) != "private synthetic state" {
		t.Fatal("roundtrip differs")
	}
	before, _ := os.ReadFile(encrypted)
	if err := encryptInstallation(plain, encrypted, password); err == nil {
		t.Fatal("existing archive overwritten")
	}
	after, _ := os.ReadFile(encrypted)
	if string(before) != string(after) {
		t.Fatal("existing archive changed")
	}
	if err := decryptInstallation(encrypted, filepath.Join(folder, "wrong"), "wrong-but-long-passphrase"); err == nil {
		t.Fatal("wrong password accepted")
	}
	if err := os.WriteFile(filepath.Join(folder, "truncated"), before[:len(before)-1], 0600); err != nil {
		t.Fatal(err)
	}
	if err := decryptInstallation(filepath.Join(folder, "truncated"), filepath.Join(folder, "out"), password); err == nil {
		t.Fatal("truncated archive accepted")
	}
}

func TestInstallationArchivesRejectTraversalAndLinks(t *testing.T) {
	for _, header := range []*tar.Header{
		{Name: "installation/../../escaped", Typeflag: tar.TypeReg, Mode: 0600, Size: 0},
		{Name: "installation/link", Typeflag: tar.TypeSymlink, Mode: 0600, Linkname: "../../escaped"},
		{Name: "payload/hardlink", Typeflag: tar.TypeLink, Mode: 0600, Linkname: "/etc/passwd"},
		{Name: "installation/C:\\escaped", Typeflag: tar.TypeReg, Mode: 0600, Size: 0},
	} {
		t.Run(strings.ReplaceAll(header.Name, "/", "_"), func(t *testing.T) {
			folder := t.TempDir()
			source := filepath.Join(folder, "archive.tar.gz")
			file, _ := os.Create(source)
			gz := gzip.NewWriter(file)
			archive := tar.NewWriter(gz)
			if err := archive.WriteHeader(header); err != nil {
				t.Fatal(err)
			}
			archive.Close()
			gz.Close()
			file.Close()
			if err := extractInstallation(source, filepath.Join(folder, "extracted")); err == nil {
				t.Fatal("unsafe archive accepted")
			}
		})
	}
}

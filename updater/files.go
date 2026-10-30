package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func writeAtomic(name string, value []byte, mode os.FileMode) error {
	if stat, e := os.Lstat(name); e == nil && stat.Mode()&os.ModeSymlink != 0 {
		return errors.New("managed files must not be symlinks")
	}
	file, e := os.CreateTemp(filepath.Dir(name), ".minimail-write-*")
	if e != nil {
		return e
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	if e = file.Chmod(mode); e == nil {
		_, e = file.Write(value)
	}
	if e == nil {
		e = file.Sync()
	}
	closeError := file.Close()
	if e == nil {
		e = closeError
	}
	if e != nil {
		return e
	}
	if e = replaceFile(temporary, name); e != nil {
		return e
	}
	syncDirectory(filepath.Dir(name))
	return nil
}
func writeJSON(name string, value any, mode os.FileMode) error {
	raw, e := json.MarshalIndent(value, "", "  ")
	if e != nil {
		return e
	}
	if len(raw)+1 >= 4<<20 {
		return errors.New("updater metadata exceeds its recovery read limit; no state was written")
	}
	return writeAtomic(name, append(raw, '\n'), mode)
}

// Publish a complete new secret file without ever replacing an existing one.
func writeNew(name string, raw []byte) error {
	file, e := os.CreateTemp(filepath.Dir(name), ".minimail-secret-*")
	if e != nil {
		return e
	}
	defer os.Remove(file.Name())
	if e = securePath(file.Name(), false); e == nil {
		_, e = file.Write(raw)
	}
	if e == nil {
		e = file.Sync()
	}
	closeErr := file.Close()
	if e == nil {
		e = closeErr
	}
	if e != nil {
		return e
	}
	if e = os.Link(file.Name(), name); e != nil {
		return e
	}
	syncDirectory(filepath.Dir(name))
	return nil
}
func readJSON(name string, value any) error {
	file, e := os.Open(name)
	if e != nil {
		return e
	}
	defer file.Close()
	d := json.NewDecoder(io.LimitReader(file, 4<<20))
	d.DisallowUnknownFields()
	if e = d.Decode(value); e != nil {
		return e
	}
	if e = d.Decode(new(any)); e != io.EOF {
		return errors.New("trailing state data")
	}
	return nil
}
func hashBytes(raw []byte) string { hash := sha256.Sum256(raw); return hex.EncodeToString(hash[:]) }

type protectedFile struct {
	Hash string      `json:"sha256"`
	Mode os.FileMode `json:"mode"`
	Link string      `json:"link,omitempty"`
}

func protectedFiles(c Config) (map[string]protectedFile, error) {
	paths := append([]string{c.EnvFile}, c.ComposeFiles...)
	local := filepath.Join(c.Root, "local")
	if _, e := os.Stat(local); e == nil {
		paths = append(paths, local)
	}
	restored := filepath.Join(c.Root, ".minimail/restored-binds")
	if _, e := os.Stat(restored); e == nil {
		paths = append(paths, restored)
	}
	result := map[string]protectedFile{}
	add := func(name string, info os.FileInfo) error {
		p := protectedFile{Mode: info.Mode()}
		if info.Mode()&os.ModeSymlink != 0 {
			link, e := os.Readlink(name)
			if e != nil {
				return e
			}
			p.Link = link
			p.Hash = hashBytes([]byte(link))
			if target, e := os.Stat(name); e == nil && target.Mode().IsRegular() {
				raw, e := os.ReadFile(name)
				if e != nil {
					return e
				}
				p.Hash = hashBytes(append([]byte(link+"\x00"), raw...))
			}
		} else if info.Mode().IsRegular() {
			raw, e := os.ReadFile(name)
			if e != nil {
				return e
			}
			p.Hash = hashBytes(raw)
		} else if !info.IsDir() {
			return fmt.Errorf("cannot protect special configuration file %s", name)
		}
		result[name] = p
		return nil
	}
	for _, name := range paths {
		info, e := os.Lstat(name)
		if e != nil {
			return nil, e
		}
		if info.IsDir() {
			if e = filepath.Walk(name, func(p string, i os.FileInfo, e error) error {
				if e != nil {
					return e
				}
				return add(p, i)
			}); e != nil {
				return nil, e
			}
		} else if e = add(name, info); e != nil {
			return nil, e
		}
	}
	return result, nil
}
func assertProtected(c Config, expected map[string]protectedFile) error {
	now, e := protectedFiles(c)
	if e != nil {
		return e
	}
	a, _ := json.Marshal(now)
	b, _ := json.Marshal(expected)
	if string(a) != string(b) {
		return errors.New("configuration changed during the update; it has not been overwritten")
	}
	return nil
}
func backupConfiguration(destination string, files map[string]protectedFile) error {
	if e := os.MkdirAll(filepath.Join(destination, "configuration"), 0700); e != nil {
		return e
	}
	index := map[string]string{}
	n := 0
	for name, info := range files {
		if info.Mode.IsDir() {
			continue
		}
		n++
		target := filepath.Join(destination, "configuration", fmt.Sprintf("%04d", n))
		raw, e := os.ReadFile(name)
		if e != nil {
			return e
		}
		if e = writeAtomic(target, raw, 0600); e != nil {
			return e
		}
		index[target] = name
	}
	if e := writeJSON(filepath.Join(destination, "configuration-index.json"), index, 0600); e != nil {
		return e
	}
	return writeJSON(filepath.Join(destination, "protected.json"), files, 0600)
}
func absolutePath(root, name string) string {
	if filepath.IsAbs(name) {
		return filepath.Clean(name)
	}
	return filepath.Join(root, name)
}
func safeRoot(name string) (string, error) {
	p, e := filepath.Abs(name)
	if e != nil {
		return "", e
	}
	if strings.ContainsAny(p, "\r\n\x00") {
		return "", errors.New("invalid installation path")
	}
	return filepath.EvalSymlinks(p)
}
func ensureStateDir(root string) error {
	state := filepath.Join(root, ".minimail")
	if info, e := os.Lstat(state); e == nil && (info.Mode()&os.ModeSymlink != 0 || !info.IsDir()) {
		return errors.New("updater state path must be a real private directory")
	}
	if e := os.MkdirAll(state, 0700); e != nil {
		return e
	}
	if e := securePath(state, true); e != nil {
		return e
	}
	if e := os.MkdirAll(filepath.Join(state, "status"), 0755); e != nil {
		return e
	}
	if e := os.Chmod(filepath.Join(state, "status"), 0755); e != nil {
		return e
	}
	if e := os.MkdirAll(filepath.Join(state, "backups"), 0700); e != nil {
		return e
	}
	file, e := os.OpenFile(filepath.Join(state, "empty.env"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e == nil {
		return file.Close()
	}
	if !os.IsExist(e) {
		return e
	}
	info, e := os.Lstat(filepath.Join(state, "empty.env"))
	if e != nil {
		return e
	}
	if !info.Mode().IsRegular() || info.Size() != 0 {
		return errors.New("managed empty environment file was changed")
	}
	return nil
}

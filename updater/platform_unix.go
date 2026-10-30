//go:build !windows

package main

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
)

func lockInstallation(root string) (func(), error) {
	file, e := os.OpenFile(root+"/.minimail/update.lock", os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	if e = syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		file.Close()
		return nil, errors.New("another updater is active")
	}
	return func() { file.Close() }, nil
}
func securePath(path string, directory bool) error {
	mode := os.FileMode(0600)
	if directory {
		mode = 0700
	}
	info, e := os.Stat(path)
	if e != nil {
		return e
	}
	if stat, ok := info.Sys().(*syscall.Stat_t); ok && int(stat.Uid) != os.Geteuid() {
		return errors.New("updater files must be owned by the account running the updater")
	}
	return os.Chmod(path, mode)
}
func serviceOwner(root string) (string, error) {
	info, e := os.Stat(filepath.Join(root, ".minimail"))
	if e != nil {
		return "", e
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return "", errors.New("cannot determine installation owner")
	}
	return strconv.FormatUint(uint64(stat.Uid), 10), nil
}
func syncDirectory(path string) {
	if file, e := os.Open(path); e == nil {
		_ = file.Sync()
		_ = file.Close()
	}
}
func replaceFile(source, target string) error { return os.Rename(source, target) }
func freeBytes(path string) (uint64, error) {
	var info syscall.Statfs_t
	if e := syscall.Statfs(path, &info); e != nil {
		return 0, e
	}
	return uint64(info.Bavail) * uint64(info.Bsize), nil
}

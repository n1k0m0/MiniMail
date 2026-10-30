package main

import (
	"errors"
	"os"
	"os/exec"
	"os/user"
	"syscall"
	"unsafe"
)

var kernel = syscall.NewLazyDLL("kernel32.dll")

func serviceOwner(string) (string, error) { return "", errors.New("systemd is unavailable on Windows") }
func lockBackupDaemon(string) (func(), error) {
	return nil, errors.New("the web backup host service requires Linux")
}

func lockInstallation(root string) (func(), error) {
	file, e := os.OpenFile(root+"/.minimail/update.lock", os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	var overlap syscall.Overlapped
	result, _, _ := kernel.NewProc("LockFileEx").Call(file.Fd(), 3, 0, 1, 0, uintptr(unsafe.Pointer(&overlap)))
	if result == 0 {
		file.Close()
		return nil, errors.New("another updater is active")
	}
	return func() { file.Close() }, nil
}
func securePath(path string, directory bool) error {
	current, e := user.Current()
	if e != nil {
		return e
	}
	access := "F"
	if directory {
		access = "(OI)(CI)F"
	}
	command := exec.Command("icacls", path, "/inheritance:r", "/grant:r", "*"+current.Uid+":"+access, "*S-1-5-18:"+access, "*S-1-5-32-544:"+access)
	if e = command.Run(); e != nil {
		return errors.New("cannot secure updater/backup file permissions")
	}
	return nil
}
func syncDirectory(string) {}
func replaceFile(source, target string) error {
	a, e := syscall.UTF16PtrFromString(source)
	if e != nil {
		return e
	}
	b, e := syscall.UTF16PtrFromString(target)
	if e != nil {
		return e
	}
	result, _, failure := kernel.NewProc("MoveFileExW").Call(uintptr(unsafe.Pointer(a)), uintptr(unsafe.Pointer(b)), 1|8)
	if result == 0 {
		return failure
	}
	return nil
}
func freeBytes(path string) (uint64, error) {
	name, e := syscall.UTF16PtrFromString(path)
	if e != nil {
		return 0, e
	}
	var available, total, free uint64
	result, _, err := kernel.NewProc("GetDiskFreeSpaceExW").Call(uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(&available)), uintptr(unsafe.Pointer(&total)), uintptr(unsafe.Pointer(&free)))
	if result == 0 {
		return 0, err
	}
	return available, nil
}

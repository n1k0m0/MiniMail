# Changelog

## 0.1.0-rc.2

- Back up legacy app-data files owned by a different user without changing their contents, ownership or permissions. The temporary backup helper has read-only mounts and filesystem, no network, and one capability for reading protected files.
- Test protected legacy files during installation, upgrade and rollback. Updates continue to abort before migration when a backup cannot be completed and verified.

## 0.1.0-rc.1

- Initial Apache 2.0 release with signed installation packages and AMD64/ARM64 app, database and optional VPN images.
- Add a standalone updater, durable migration/recovery journals, SQL backup restoration checks, compatibility-gated rollback and an administrator update page.
- Preserve existing secrets, private configuration and persistent volumes. Default to notification-only checks; unattended stable patch updates require explicit opt-in.

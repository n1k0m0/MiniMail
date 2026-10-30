# Changelog

## 0.1.0-rc.4

- Back up legacy app-data files owned by a different user without changing their contents, ownership or permissions. The temporary backup helper has read-only mounts and filesystem, no network, and one capability for reading protected files.
- Test protected legacy files during installation, upgrade and rollback. Updates continue to abort before migration when a backup cannot be completed and verified.
- Require host updater 0.1.1 so existing installations receive the backup fix too. Download the new package and run its installer with the existing installation as the target; this replaces the updater without resetting the installation. Then run `apply`.
- Derive the signed minimum updater version from the updater source to keep compatibility checks in step with host-tool fixes.
- Keep updater-owned image metadata aligned after automatic recovery, so an aborted update can be retried without editing private Compose files. The Docker lifecycle test now injects a failure after backup verification and checks recovery followed by a clean retry.

The rc.2 and rc.3 tags were used for validation; neither release was published.

## 0.1.0-rc.1

- Initial Apache 2.0 release with signed installation packages and AMD64/ARM64 app, database and optional VPN images.
- Add a standalone updater, durable migration/recovery journals, SQL backup restoration checks, compatibility-gated rollback and an administrator update page.
- Preserve existing secrets, private configuration and persistent volumes. Default to notification-only checks; unattended stable patch updates require explicit opt-in.

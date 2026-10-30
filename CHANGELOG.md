# Changelog

## 0.1.0-rc.15

- Add a personal Notifications settings page with independent mail/calendar switches, browser permission handling, a test pop-up, background inbox observation and cross-tab deduplication. Keep in-app reminders independent and notify again for snoozed occurrences. Preferences are isolated by user and browser; both default off.
- Add asynchronous full installation backup creation and streamed/resumable encrypted downloads to the administrator interface, requiring password/2FA and explicit pause consent. Scope jobs to the requesting admin session; keep backup passwords out of persisted state and logs.
- Add opt-in Linux/systemd host backup service in updater 0.1.7. Expose only fixed-installation export through an authenticated read-only Unix socket; serialize with updates, recover paused apps after interruption, preserve private configuration, expire encrypted downloads after 24 hours and exclude runtime sockets/credentials from recovery archives.
- Test admin/session isolation, encryption, interrupted jobs, range downloads and full Docker disaster recovery with the host-service mount, followed by updates and rollback.

## 0.1.0-rc.14

- Replace the top navigation envelope with a compact two-line MiniMail wordmark, using the application's local Manrope font and colors matched to the blue rail.
- Allow the host updater to adopt existing labeled schema 2 installations. Keep unknown schema versions blocked; retain the same configuration/data protections. This is covered by the previous-release Docker upgrade test. Includes host updater 0.1.6.

The rc.13 tag was used for validation; its release was not published.

## 0.1.0-rc.12

- Add private per-mailbox filters with AND/OR conditions, priorities, automatic incoming-mail processing, confirmed runs on existing folders, durable checkpoints and resumable failures. Preserve automatic invitation import before moving mail and require IMAP MOVE for filtered moves.
- Add folder/subfolder creation and confirmed folder deletion through the sidebar context menu. Move complete folder trees into the mailbox's Trash; list and remove dependent filters only after the server confirms the move. Reconcile interrupted folder operations without issuing permanent folder deletes.
- Add two nullable encrypted columns through an idempotent, journaled schema migration. Preserve the baseline schema checksum and support old application backups. Include filter configuration and progress in password-encrypted backups, including restores under a different encryption key.
- Require compatibility release rc.11 before this upgrade and host updater 0.1.5; enforce the minimum application version in signed manifests before touching services. Extend upgrade tests to compare every original account field through the additive migration and preserve rollback data.

## 0.1.0-rc.11

- Teach the compatibility reader the exact next additive migration. It leaves schema 1 unchanged on normal startup and can safely finish an interrupted column addition when recovering an upgrade.

## 0.1.0-rc.10

- Prepare a compatibility reader for the additive mailbox-filter schema. Keep the existing schema and data unchanged while allowing a compatible application rollback after the next upgrade.
- Derive signed schema support from the application source and keep future mailbox filter state out of account API responses.

## 0.1.0-rc.9

- Preserve recovered read-only configuration mounts and non-application image pins during updates, rollback and failure recovery. Include relocated private configuration in protected update backups.
- Extend the real Docker recovery test with a subsequent application update and rollback; require host updater 0.1.4.

The rc.8 tag was used for validation; its release was not published.

## 0.1.0-rc.8

- Flush and exclusively publish encrypted safety backups before a restore can replace database rows. Never overwrite an older archive, including on filesystem errors.
- Handle late stream failures without leaving an export or maintenance gate waiting indefinitely. Test a disk-full safety-copy failure and a writer error after the SQL snapshot closes; existing database data remain intact.
- Report insufficient backup storage explicitly to administrators.

## 0.1.0-rc.7

- Add password-encrypted administrator export/import of all stored application data, with password/2FA reauthentication, authenticated streaming encryption, bounded parsing, cross-key portability and an automatic encrypted safety backup before transactional restore.
- Fence stale HTTP/background database writes during restore, preserve 2FA replay protection and invalidate restored sessions. Preserve existing schema, server configuration and encryption keys.
- Add standalone encrypted full installation backup/recovery commands to host updater 0.1.3, including verified SQL, private configuration, complete app-data and runtime images. Disaster recovery only accepts an empty directory and new Docker volumes; unsafe archive paths, links and existing resources are rejected.
- Document backup scope, external IMAP data, recovery steps and dependency licenses. Test tampering, rollback, different encryption keys, role restrictions and real Docker disaster recovery.

## 0.1.0-rc.6

- Add a per-user primary calendar for new events and tasks, including writable CalDAV calendars. Preserve the independent email-invitation destination and existing event calendars. Store the preference with calendar metadata without a schema change.

## 0.1.0-rc.5

- Verify that the exact running application and database images remain available before maintenance starts. If an old image was removed or cannot be resolved, stop before pausing the application or touching the database.
- Require host updater 0.1.2. Missing images require separate verified maintenance; the updater does not silently replace the production database image with another build.

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

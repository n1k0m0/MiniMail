# Code review: security, correctness and performance

Review date: 2026-10-31. Baseline: `80fe1af` (0.1.0-rc.20).

This review covers the current application, its Go updater/backup service,
Docker configuration, installation scripts and GitHub workflows. It combines
manual review of sensitive paths, dependency scans and automated regression
coverage. It is not an external penetration test or a guarantee that the
project has no remaining vulnerabilities. Production data and configuration
are not required for these checks.

## Fixed findings

| Finding | Impact | Correction and coverage |
| --- | --- | --- |
| Discovery writes used a stale contact snapshot | A background scan could overwrite a manually saved key, attach a key after an address change, or apply a trust upgrade to different key material. | Conditional writes bind the contact owner, address and exact previous material. Deterministic concurrent-edit tests exercise the discovery path. |
| Contact address changes cleared keys in a separate statement | Another request could observe the new address with the old address's encryption material; a subsequent key save could also be erased. | A single SQL statement clears key material and trust metadata with the address change, preserving case-only edits. Key import/accept operations also require the originally validated address; stale deletes require the original key. Postbox key imports have the same address guard. |
| OpenPGP verification loaded trust separately from its key | A concurrent key replacement could label a signature made with an unconfirmed key as trusted. | Material and trust are read together and retained throughout verification. Regression coverage includes detached MIME signatures, encrypted/signed messages and cleartext signatures with a key replacement during processing. |
| MySQL key removal reset `crypto_mode` before testing that column | Because MySQL evaluates single-table assignments left to right, default sign/encrypt flags could remain enabled after removing the active key. | Reset dependent flags before the mode; test both key types with matching and unrelated active modes. |
| Inherited object properties were accepted as crypto kinds | Names such as `constructor` reached SQL identifier construction instead of returning 404. This was an error-handling flaw, not a demonstrated SQL injection. | Explicit kind allowlist and HTTP regression checks. |
| Single-message API inputs lacked strict UID/flag validation | Malformed identifiers reached IMAP, and truthy strings such as `"false"` could change a flag unexpectedly. | Reject ranges, noncanonical/out-of-range UIDs and unknown/nonboolean flags before network access. Keep the IMAP unsigned 32-bit UID limit. |
| Reminder state was scanned once per expanded event | Looking up dismissed/snoozed occurrences took O(events × saved states) work on every reminder poll. | Index states once by item and occurrence, reducing lookup work to O(events + saved states). Dismissal, user isolation and snooze behavior remain covered. |

These changes require no schema migration and do not rewrite existing user
data, encryption keys, installation settings or backup formats.

## Other areas checked

- Authentication, session rotation, TOTP replay handling, administrator routes,
  user-scoped mailbox/contact/calendar/draft access and backup reauthentication.
- Bound SQL parameters and the small number of generated SQL identifiers.
- Mail HTML sanitization, attachment download headers, MIME/crypto limits and
  TLS requirements for IMAP and SMTP.
- Calendar HTTPS restrictions, private-address allowlists, DNS pinning,
  same-origin redirects and CalDAV collection path boundaries.
- Calendar workers, recurrence budgets, per-user storage quotas, conditional
  remote writes and cache retention after sync errors.
- Password-encrypted backups, streaming, session-bound download ownership,
  the fixed Unix-socket host bridge, restore guards and installation locking.
- Signed release metadata, pinned image digests, update recovery, configuration
  preservation and full-backup recovery tests.
- Container user/capabilities, private database networking, local port binding,
  Docker build context exclusions and workflow permissions.
- Tracked application/install assets searched for personal infrastructure and
  embedded private keys. Matches were UI placeholders/parsing code, rather than
  deployment credentials. This check does not certify every historical Git
  object or external service.

## Verification

- `npm audit --json`: no known vulnerabilities in the installed npm tree.
- `go test ./...` and `go vet ./...`: local Windows checks pass.
- `govulncheck`: no affected symbols or imported packages. It additionally
  reports [GO-2026-5932](https://pkg.go.dev/vuln/GO-2026-5932) for the unused,
  unmaintained `golang.org/x/crypto/openpgp` package. MiniMail's Go code uses
  age; it does not import that OpenPGP package. Removing the entire indirect
  crypto module would remove dependencies needed by age.
- Local database-independent Node tests and `npm run build` pass.
- The [Checks workflow](https://github.com/n1k0m0/MiniMail/actions/workflows/ci.yml)
  runs the complete Node suite against MySQL 8.4, Windows/Linux Go checks,
  installer checks, and Docker installation/update/rollback/full-recovery
  lifecycle tests. The local Docker engine is unavailable, so these checks
  are performed on GitHub runners, using synthetic data.

Background external-IMAP operations still depend on provider response times;
there was no production load test. Browser notifications require an open
MiniMail tab. No new image, release or production deployment is implied by
pushing these source changes.

The SQL assignment-order fix follows the
[MySQL 8.4 UPDATE documentation](https://dev.mysql.com/doc/refman/8.4/en/update.html).

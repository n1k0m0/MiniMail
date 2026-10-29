# MiniMail

A self-hosted, multi-user webmail client for IMAP and SMTP, built with React, Express and MySQL 8.4. MiniMail keeps your messages on your mail servers and provides a lightweight browser interface for reading, searching, composing and organizing mail.

## Features

- Multiple isolated web users, administrator-managed accounts and mandatory TOTP two-factor authentication.
- Multiple mailboxes per user, a primary inbox, nested folders, search, conversation view, drag-and-drop, spam/archive/trash actions and automatic inbox checks.
- Plain-text composition, reply/reply-all, forwarding, Cc/Bcc, signatures, contacts and attachments.
- Encrypted saved drafts, including attachments; protection against accidentally closing an unsaved message.
- OpenPGP and S/MIME signing/decryption/encryption, manually confirmed recipient keys, and collection of public keys from incoming mail.
- Optional AI-assisted writing and summaries through an administrator-configured self-hosted OpenAI-compatible endpoint.
- Raw message source and relay trace inspection, with optional offline IP geolocation.
- German and English interfaces, light/dark themes and responsive layouts.
- Optional server-side OpenVPN routing for selected mailboxes. Other mailboxes connect directly.

## Requirements

**Recommended:** Docker Engine with Docker Compose v2, or Docker Desktop using Linux containers. The shell installer also uses OpenSSL to generate an encryption key. The PowerShell installer uses the operating system's cryptographic random generator.

For development without Docker, use **Node.js 24 or newer**, npm and **MySQL 8.4**. S/MIME operations also require an OpenSSL executable. OAuth-only mail providers are not supported; many providers require an app password for IMAP/SMTP.

The optional VPN container requires a Linux Docker host with `/dev/net/tun`, `NET_ADMIN` and iptables support. It is separate from the unprivileged MiniMail application.

## Quick installation with Docker

Clone the repository:

```sh
git clone https://github.com/n1k0m0/minimail.git
cd minimail
```

On Linux or macOS:

```sh
sh scripts/install.sh admin
```

On Windows, from PowerShell:

```powershell
.\scripts\install.ps1 -AdminUsername admin
```

The installer:

1. Creates `.env` with a random 256-bit encryption key **only if the file does not already exist**.
2. Generates distinct MySQL application/root passwords when missing, builds the application and database images from `Dockerfile` and `database/Dockerfile`, and waits for MySQL to be ready.
3. Checks whether an administrator exists and, on a new installation, prompts for a password in an interactive terminal. The password is not echoed or passed as a command-line argument.
4. Starts MiniMail at **http://127.0.0.1:3000**.

Configure HTTPS as described below, then open your HTTPS address, sign in and enroll an authenticator app. To test sign-in locally without a reverse proxy, use the development setup instead. Then connect a mailbox in Settings. Additional users can be created by an administrator under **Settings → User management**. Temporary passwords must be changed before a new user enrolls their own 2FA.

**Production cookies require HTTPS.** Direct HTTP access is intended only to check whether the service responds; production sign-in must go through an HTTPS reverse proxy. For local sign-in during development, use the development instructions below.

Keep `.env` private and back it up with the database. On Windows, restrict its filesystem permissions to the account operating the installation. Do not replace an existing encryption key: doing so makes saved credentials, private keys, TOTP secrets and drafts unreadable.

### Manual Docker installation

```sh
cp .env.example .env
# Run this three times and fill APP_ENCRYPTION_KEY, MYSQL_PASSWORD and MYSQL_ROOT_PASSWORD:
openssl rand -hex 32

docker compose build
docker compose up -d --wait database
docker compose run --rm --no-deps minimail node server/create-admin.js admin
docker compose up -d
```

`APP_ENCRYPTION_KEY` must contain exactly 64 hexadecimal characters. `.env.example` contains placeholders, never working credentials. Use different, long random passwords for MySQL; the installer generates 64-character hexadecimal values. The application uses its own database account and never connects as MySQL root. There is no public user registration.

### HTTPS reverse proxy

The default Compose file publishes only `127.0.0.1:3000`. A reverse proxy running on the host can forward to it. For example, after configuring your own DNS name, a host-based Caddy configuration can use:

```caddyfile
mail.example.com {
    reverse_proxy 127.0.0.1:3000
    header Strict-Transport-Security "max-age=31536000"
}
```

Replace the example domain before use. Preserve the original `Host` header and redirect HTTP to HTTPS. Keep the application port and VPN proxy private. A reverse proxy in another container needs a private shared network and a deployment-specific override, such as `compose.local.yaml`; do not publish your host's topology in the repository.

### Everyday Docker commands

```sh
docker compose ps
docker compose logs --tail=100 minimail
docker compose stop minimail
docker compose start minimail
```

The Docker image runs as an unprivileged user, with a read-only application filesystem, no application capabilities and a built-in HTTP health check. The named `mysql-data` volume contains all application tables in MySQL/InnoDB. MySQL is reachable only through the internal Docker database network and has no host port mapping. `minimail-data` is retained for local key files and legacy SQLite imports; deleting it does not migrate its contents. The application health check also queries MySQL, so a database outage makes the application unhealthy. The `Dockerfile` uses a separate frontend build stage and installs only production dependencies into the runtime image. No third-party geolocation download is required during image builds.

## Optional generic VPN

Only the selected mailbox's IMAP and SMTP traffic use the tunnel. VPN profiles and credentials are provisioned by the administrator on the Docker host; they cannot be uploaded through the web interface.

1. Create a private directory outside version control. The ignored `local/` directory is suitable:

   ```sh
   mkdir -p local/vpn
   cp vpn/targets.example.json local/vpn-targets.json
   ```

2. Place your own OpenVPN client profile at `local/vpn/profile.ovpn`, together with any files it references. Use paths relative to `/vpn` inside the container. If the private key needs a passphrase, put it in the optional `local/vpn/key.pass` file. An `auth-user-pass` file can also be referenced by the profile. Restrict access to these files. Do not put shell hooks or custom privilege changes into the profile; the container owns tunnel startup and routing.

3. Replace the documentation values in `local/vpn-targets.json` with your mail servers:

   ```json
   [{ "host": "mail.private.example", "ip": "192.0.2.10", "ports": [993, 587] }]
   ```

   The hostname is what you enter in MiniMail. The IP is the fixed IPv4 destination reachable through the VPN. The example address is reserved for documentation and must be replaced. Add one entry per permitted mail host, and only the ports you need. Direct TLS commonly uses 993/465; STARTTLS commonly uses 143/587. IPv6 VPN destinations are not implemented.

4. Add these settings to your private `.env`:

   ```dotenv
   VPN_CONFIG_DIR=./local/vpn
   VPN_TARGETS_FILE=./local/vpn-targets.json
   MAIL_VPN_PROFILE_ID=private
   MAIL_VPN_PROFILE_LABEL=Private mail VPN
   ```

5. Build and start with the VPN override:

   ```sh
   docker compose -f compose.yaml -f compose.vpn.yaml up -d --build
   ```

   Alternatively, use `sh scripts/compose.sh --vpn up -d --build`. On Windows, the wrapper accepts `-Vpn` and `-DockerArgs @('up','-d','--build')`; the actual VPN Docker host must still provide the Linux tunnel prerequisites.

6. As an administrator, choose the configured **VPN connection** when adding or editing a mailbox.

The proxy allows only explicitly configured hostname/port pairs and connects to the pinned IP without resolving that hostname again. The unprivileged proxy's outbound packets, including established connections, are restricted to `tun0`. If the tunnel fails, VPN mailboxes fail instead of silently connecting directly. TLS verification still authenticates the mail server. The proxy has no published host port. Profiles, certificates, keys, destination lists and local Compose overrides are excluded from Git and Docker build contexts.

Keep the profile ID stable for existing mailboxes. Changing or removing it leaves those mailboxes unavailable until their settings are updated; there is no automatic direct fallback. Use the same Compose overrides for later upgrades and recreation of services.

## Optional offline relay geolocation

MiniMail extracts public relay addresses from `Received` headers. It does not send those addresses or email content to a geolocation API. Without a local database it still lists relays, but cannot place them on the map.

To enable locations, obtain a compatible City MMDB database, for example DB-IP City Lite, following its license and attribution terms. Put it outside Git and configure:

```dotenv
GEOIP_DB_FILE=./local/geoip.mmdb
```

Then start with `docker compose -f compose.yaml -f compose.geoip.yaml up -d --build`, or `sh scripts/compose.sh --geoip up -d --build`. For VPN and geolocation together, include both overrides or use both wrapper switches. The map includes DB-IP attribution; keep the appropriate attribution if using a different provider.

Relay headers can be forged, IP geolocation is approximate, and the lines describe visible mail relays rather than packet-level network routing.

## Development without Docker

Start a MySQL 8.4 server with a database and a dedicated user authorized for that database. Export its connection settings in the terminal that runs Node:

```sh
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_DATABASE=minimail
export MYSQL_USER=minimail
# Set MYSQL_PASSWORD privately in your shell/service environment.
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Development mode permits local HTTP sign-in. In another interactive terminal, create the first administrator:

```sh
npm run admin:create -- admin
```

Tables are created automatically in the configured MySQL database. In development only, the application creates `data/secret.key` when no encryption key is supplied. This file is ignored by Git. With no browser open, connected inboxes are still checked at each mailbox's configured interval; use `0` to disable automatic checks.

For S/MIME on Windows, install OpenSSL and set `OPENSSL_BIN` to its executable if it is not on `PATH`. For a local GeoIP database set `MAIL_TRACE_GEOIP_DB` to the MMDB path. Optional server VPN configuration is read from `MAIL_VPN_PROFILE_ID`, `MAIL_VPN_PROFILE_LABEL` and `MAIL_VPN_PROXY_URL`; the administrator must provide a restricted proxy, not a public general-purpose proxy.

Build and test with a **separate disposable MySQL server**. The integration tests create and drop randomly named test databases, so use a test administrator with permission to create databases. Never point these test settings at a production server. The default test password is a synthetic fixture; GitHub Actions provisions its own MySQL service.

```sh
export MYSQL_TEST_HOST=127.0.0.1
export MYSQL_TEST_USER=root
# Set MYSQL_TEST_PASSWORD privately; default: minimail-test-only.
# Set max_allowed_packet=128M on the test server (as in database/minimail.cnf).
```

Build and test:

```sh
npm test
npm run build
npm audit
```

For production without Docker, build the frontend, set `NODE_ENV=production`, provide `APP_ENCRYPTION_KEY` and the `MYSQL_*` connection settings in the process environment and run `npm start`. The default bind address is loopback; `HOST` and `PORT` can be set explicitly. For a remote MySQL server, set `MYSQL_SSL_CA` to its trusted CA certificate file to enable verified TLS. The built-in Docker network does not require external database access. Node does not automatically read `.env` for `npm start`; use your service manager's environment configuration or Node's `--env-file` option. Use HTTPS for production sign-in.

## Mail, drafts and protected messages

MiniMail talks to IMAP/SMTP over validated TLS, either direct TLS or required STARTTLS. Separate SMTP credentials are supported; empty SMTP credentials use the IMAP credentials. Sending uses the mailbox selected in the From field and appends that mailbox's signature.

- Up to eight attachments totaling 8 MiB per outgoing message. Messages over 25 MiB are not loaded in the web reader.
- External images and active HTML content are removed from displayed mail.
- A successful SMTP submission is distinct from successfully storing a Sent copy. If saving the copy fails, MiniMail reports the problem without asking you to send the message again. Some providers save Sent messages themselves.
- **Save draft** stores an encrypted draft in MiniMail, including attachments and reply references. It is explicit, not automatic, and is separate from the provider's IMAP Drafts folder. Use **Saved drafts** to resume or delete it. Draft storage is limited to 50 drafts and 64 MiB of encrypted draft payload per user.
- Closing an edited message offers Save and close, Keep editing or Discard changes. Leaving/reloading the page warns about unsaved changes. Discarding edits to an existing draft keeps its last saved version.

Under **Mailbox → Keys**, import an OpenPGP private key or S/MIME PKCS#12/PEM identity matching the sender address. Recipient public keys/certificates can be imported into contacts. Unverified collected public keys are not trusted for encryption until confirmed. S/MIME certificates validated against a trusted certificate chain can be marked verified automatically. Verify fingerprints with the recipient through another trusted channel.

Select **Enforce** if a message must be encrypted. **Automatic** encrypts only when all required recipient material is available and can otherwise send without encryption; the composer displays that state. Encrypted Sent copies also include the sender as a recipient. Expired personal S/MIME certificates can be used to read old messages but cannot be selected for new protected mail.

OpenPGP signature trust uses the confirmed contact key. S/MIME verifies the signature, sender identity and certificate dates, using a trusted chain or a manually confirmed contact certificate. Certificate revocation is not checked. Hardware tokens, provider OAuth, Maildir/mbox import and calendar features are not implemented.

## Optional self-hosted AI

An administrator can configure an OpenAI-compatible base URL, model and optional API key under **Settings → AI features**. MiniMail sends requests to `<base URL>/chat/completions`; there is no default external provider or commercial fallback. Only HTTP loopback/private IP endpoints or HTTPS endpoints are accepted. Configuring an AI endpoint is a trusted administrator operation. Changing its URL clears the previous endpoint's stored API key.

Writing and summarizing each require an explicit click. Rewriting can start with an empty message and instructions or bullet points. It includes the selected sender, To/Cc recipients and available names; Bcc, saved signatures, automatically attached reply quotes and attachments are not sent. Generated text is shown as an editable proposal and must be applied with **Apply**. **Undo AI change** restores the previous draft. Treat output as a draft and review it before sending.

Separate output token limits can be configured for writing and summarizing. A blank limit lets the AI server choose its limit. Requests have input limits, a timeout and per-user rate limits.

## Updates, backups and private configuration

Back up MySQL **and the original encryption key**. For a consistent application snapshot, stop MiniMail while taking a transactional database dump:

```sh
umask 077
mkdir -p backups
docker compose stop minimail
docker compose exec -T database sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF -u "$MYSQL_USER" "$MYSQL_DATABASE"' > backups/minimail.sql
cp .env backups/environment
docker compose start minimail
```

Check that the dump command succeeded. If any backup step fails, restart MiniMail with `docker compose start minimail`. Keep `.env`, optional local files and VPN profiles in private backups, preferably separate from the SQL dump. Do not use `docker compose down -v`: it deletes named data volumes. Emails stay on the IMAP servers; MySQL holds users, password hashes, sessions, mailbox credentials, contacts, drafts, key material, settings and local indexes. Encrypted fields are not recoverable without the original `APP_ENCRYPTION_KEY`.

To restore into a new, empty installation, restore the matching private `.env` first, build the images, and start only MySQL. Import the dump before starting MiniMail:

```sh
docker compose build
docker compose up -d --wait database
docker compose exec -T database sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -u "$MYSQL_USER" "$MYSQL_DATABASE"' < backups/minimail.sql
docker compose up -d minimail
```

The MySQL initialization passwords apply only to a new volume. Changing `.env` later does **not** change an existing database user's password; perform a deliberate MySQL password change and update the matching application configuration together.

For normal updates after the MySQL migration:

```sh
git pull --ff-only
docker compose build
docker compose up -d
```

Include your VPN/geolocation/local overrides in all deployment commands. Back up before database changes. Use the one-time migration below when updating from a SQLite release.

### One-time SQLite → MySQL migration

Keep the old image/source and a private backup before updating. Stop the old application before taking the final SQLite snapshot so no writes occur during migration. Keep `APP_ENCRYPTION_KEY` unchanged. Do not create a fresh administrator: users and 2FA are imported.

1. Stop MiniMail using the old deployment configuration; back up its complete `minimail-data` volume (including SQLite WAL files if present), `.env`, VPN files and local overrides.
2. Update the source. Add distinct random `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD` values to the existing `.env`; retain every existing key and private setting.
3. Build the new images and start only MySQL:

   ```sh
   docker compose build
   docker compose up -d --wait database
   ```

4. With the application still stopped, import the old file mounted in `minimail-data`:

   ```sh
   docker compose run --rm --no-deps -T minimail npm run db:migrate -- /app/data/minimail.sqlite
   docker compose run --rm --no-deps -T minimail npm run db:migrate -- /app/data/minimail.sqlite --verify-only
   ```

5. Both commands must report `verified: true` for every table. Then start MiniMail with the same private overrides and check sign-in, mailboxes, contacts, drafts and settings:

   ```sh
   docker compose up -d minimail
   ```

The importer creates a private temporary copy in the data volume (including any WAL), reads SQLite in read-only mode, checks its integrity, preserves IDs and encrypted bytes, and compares SHA-256 content digests and row counts inside a single MySQL transaction. It refuses a nonempty target or unknown tables/columns and rolls back on failure. Large mail indexes are streamed instead of loaded all at once. Allow enough free space for the temporary SQLite copy; `SQLITE_MIGRATION_TMPDIR` can select another private writable directory. Temporary copies are removed after import. Older schemas receive missing defaults; keys from obsolete fixed AI endpoints are cleared. Existing self-hosted AI settings are preserved. SQLite is used only by this import tool, never by the running mail application.

Keep the old SQLite backup until verification is complete. A rollback restores the old image/source and its matching SQLite snapshot. Changes made after switching to MySQL are not in that old snapshot; do not roll back blindly after accepting new writes.

Keep deployment-specific networks, proxy settings and bind paths in ignored files such as `compose.local.yaml` and `.env`. Never commit profiles, credentials or backups. The repository contains generic examples only.

## Security and operating assumptions

Passwords use scrypt; credentials, TOTP secrets, private keys and drafts use AES-256-GCM. Production cookies are HttpOnly, Secure and SameSite=Strict, with the `__Host-` prefix. State-changing API requests check origin metadata and require a custom header or browser same-origin metadata. API responses are not cached. Authentication precedes large protected request-body parsing, compressed request bodies are rejected, password checks have bounded concurrency, and both login and TOTP enrollment have attempt limits.

Give web accounts only to people you trust: authenticated users can choose IMAP/SMTP destinations. Restrict container egress at the network/firewall level when internal services must be unreachable. DNS hostname checks alone do not provide that restriction. VPN profiles and AI endpoints are administrator-controlled server configuration.

See [the security review](docs/SECURITY-REVIEW.md) for the reviewed scope, corrected findings and remaining limitations. The review and test suite are not a guarantee that the software has no vulnerabilities. Keep dependencies, the reverse proxy and the host updated.

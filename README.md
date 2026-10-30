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
- Optional unread-only view with correct search/pagination, plus stronger unread styling for messages, mailboxes and folders. Read emails remain visible by default.
- Personal calendars with local storage, iCalendar/Webcal subscriptions and CalDAV synchronization, including Nextcloud; day/week/month/multiweek/agenda views, tasks, recurring events, reminders, per-calendar colors, import/export and email invitations.
- Optional server-side OpenVPN routing for selected mailboxes. Other mailboxes connect directly.

## Requirements

**Recommended:** Docker Engine with Docker Compose v2, or Docker Desktop using Linux containers. The shell installer also uses OpenSSL to generate an encryption key. The PowerShell installer uses the operating system's cryptographic random generator.

For development without Docker, use **Node.js 24 or newer**, npm and **MySQL 8.4**. S/MIME operations also require an OpenSSL executable. OAuth-only mail providers are not supported; many providers require an app password for IMAP/SMTP.

The optional VPN container requires a Linux Docker host with `/dev/net/tun`, `NET_ADMIN` and iptables support. It is separate from the unprivileged MiniMail application.

## Install a published release

Download the package matching your **Docker host** from [GitHub Releases](https://github.com/n1k0m0/minimail/releases). Packages contain a standalone updater, signed configuration templates and prebuilt app/MySQL images. No Node.js, Python, Go or Git installation is required on the target host. Docker must run Linux containers. Linux and Windows are covered by updater tests; ARM64/macOS binaries are cross-built and should be validated on the intended host before enabling unattended operation.

Extract the package into its final directory. On Linux/macOS run:

```sh
sh install.sh
```

On Windows run:

```powershell
.\install.ps1
```

The installer verifies the package signature and file hashes, generates three independent secrets on a new installation, starts MySQL and asks for the initial administrator password in an interactive terminal. Configure HTTPS before signing in; `Caddyfile.example` supports an existing host proxy. For a new proxy, add `MINIMAIL_DOMAIN=mail.example.com` to the private `.env` and include the supplied `compose.https.yaml` when deploying. DNS and ports 80/443 must reach that host. Optional VPN and geolocation templates are included too.

Register optional files with the installed updater before starting the corresponding services, for example `.minimail/bin/minimail configure --compose compose.yaml --compose compose.https.yaml`, followed by `.minimail/bin/minimail compose -- up -d`. Windows uses `.\.minimail\bin\minimail.exe`. Include existing private overrides in the same ordered list. This changes only updater-owned metadata; it does not rewrite the files. The next application update requires the registered configuration to match the running services.

An existing `.env` is never replaced. An initialized installation is never reset by rerunning the installer. To bring an existing source installation under updater management, use the **adoption** procedure below instead.

The current candidate release is `v0.1.0-rc.3`; candidate releases require an explicit version selection or the preview channel. The stable channel does not install previews.

## Build and install from source

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

### Show or hide read emails

Read messages are visible by default. Use **Settings → Appearance → Hide read emails**, or the **Unread only** toggle above the message list, to hide them. The choice is saved separately for each MiniMail user in the current browser and applies to all of that user's mailboxes. Turn the toggle off to show read mail again.

The filter is applied before pagination and combines with search. In conversation view, only unread members are shown while the complete thread relationships are retained. Opening a message marks it read as usual: it leaves the filtered list, but stays open in the reader. Unread folders and mailboxes use the same darker, bolder text as unread messages; parent folders also remain emphasized while a subfolder has unread mail.

## Settings and permissions

The settings window has separate pages for **Mailboxes**, **Address book**, **Appearance**, **Security**, **AI features** and, for administrators, **Updates** and **User management**. Each page states whether its settings are personal, stored in this browser, or shared by the installation. Switching pages keeps unfinished forms in memory while the window stays open.

| Area                                                      | Access                                                                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mailboxes, sender identities, signatures and mailbox keys | Each user manages only their own mailboxes, including administrators.                                                                                           |
| Contacts, collected recipients and saved drafts           | Scoped to the signed-in user. Contacts and recipient collection follow that user across devices.                                                                |
| Theme, language and conversation view                     | Stored in the current browser. The read-email filter is additionally separated by user.                                                                         |
| Shared AI connection, model, key status and output limits | Administrators can view and change these. Other users see availability only and can use the configured AI features. The saved API key itself is never returned. |
| Users, password resets and 2FA resets                     | Administrators only. These controls do not directly open another user's mailbox.                                                                                |
| Version and update status                                | Administrators only. The web interface checks releases; the separate host updater installs them.                                                               |
| VPN profile selection                                     | Administrators only; server profiles and credentials are provisioned outside the web interface.                                                                 |

The mail APIs enforce ownership on the server; hiding controls is not the access boundary. Administrators can reset another user's credentials and 2FA, and operators with database access and the application encryption key can technically recover encrypted stored credentials, keys and drafts. MiniMail does not protect these stored values from its own server operator.

## Calendars and Nextcloud

Open the **Calendar** icon in the left rail. A personal calendar is created for each user. Use **Add calendar** to create another local calendar, subscribe to an iCalendar/Webcal URL, or connect a CalDAV collection. Each calendar has its own color, visibility and read-only setting. Removing an online connection removes MiniMail's cache; it does not delete that collection on the provider. Local calendars and their events are deleted when removed, so export them first if you need a copy.

Choose **Set up connection later** to save the name, address, username, color and read-only setting before entering credentials. These prepared connections remain paused, including background synchronization. Use **Add credentials** beside the calendar to complete setup. Entering an app password clears the pending flag; saving validates the connection and starts synchronization. Failed validation leaves the prepared connection intact.

### Connect Nextcloud

1. In Nextcloud Calendar, copy the calendar's **private CalDAV address**. Use a collection address such as `https://cloud.example.org/remote.php/dav/calendars/USERNAME/personal/`, rather than a public ICS subscription if you want to edit events.
2. In MiniMail, select **Add calendar → CalDAV**. Enter that URL, your Nextcloud username and an app password. Alternatively, enter `https://cloud.example.org/remote.php/dav/` and use **Find calendars on the server** to select a collection. Include Nextcloud's subdirectory if applicable.
3. Choose a name and color. Clear **Subscribe read-only** to allow editing if your Nextcloud account has write access. Click **Connect**.
4. After changing a test event, synchronize in Nextcloud or another client to verify both directions. MiniMail refreshes connected calendars every five minutes and provides a manual synchronization button.

Create/revoke app passwords under **Nextcloud → Personal settings → Security**; use a dedicated app password rather than your main login password. See the official [Nextcloud CalDAV setup](https://docs.nextcloud.com/server/latest/user_manual/en/groupware/sync_thunderbird.html) and [app-password instructions](https://docs.nextcloud.com/server/latest/user_manual/en/files/access_webdav.html).

### Events, tasks and invitations

- Views: day, week, month, four weeks, agenda and tasks; date navigation, search within the displayed range, ISO week numbers, weekends, display timezone and print view.
- Events: create/edit/delete, all-day or timed events, IANA timezones, location, description, conference URL, categories, public/private/confidential classification, free/busy classification, attendees, custom RRULEs, reminders, dragging/resizing and copying/moving between writable calendars. Open a recurring occurrence to edit/delete that occurrence or the whole series. Imported recurrence exceptions, RDATE/EXDATE, timezone definitions and unknown provider properties are preserved in the ICS resource.
- Tasks: VTODO import/export and CalDAV sync, optional start/due dates, priority, progress, open/in-progress/completed/cancelled status and filters. Dated tasks also appear in the calendar.
- Email invitations: new inbox mail is checked with the mailbox's configured check interval. The initial scan covers the previous 30 days and continues in bounded batches. Opening a message in another folder also checks its calendar parts. Matching `REQUEST` invitations become tentative local events; newer updates/cancellations use the UID, organizer and sequence/timestamp to avoid duplicate or stale changes. The sender must match the organizer, and the mailbox must be an attendee. This comparison is not cryptographic proof of identity.
- Under **Invitations from email**, choose a local destination and enable/disable automatic tentative import. Auto-import never sends replies or writes invitations into remote calendars. Use **Open in calendar and reply** to explicitly accept, tentatively accept or decline from one of your attendee mailboxes. Organizers can explicitly send invitations/updates or cancellations. The application uses the selected mailbox's existing SMTP configuration and saves the sent copy as usual. CalDAV writes use client-controlled scheduling to avoid a second automatic scheduling message from a compliant server.
- ICS import skips existing UIDs by default. Export any calendar as `.ics`. Public subscriptions are normally read-only. Writable ICS subscriptions require HTTP PUT and ETags; MiniMail updates the full file conditionally. CalDAV edits/deletes use conditional ETags. Conflicts are shown to the user and require refreshing/reopening the event.
- Display reminders appear inside MiniMail while it is open, with dismissal/snoozing. Browser notifications require permission and appear while the page remains open. Reminder polling considers events up to 28 days ahead. Email/audio alarm actions and remote attachments are never executed automatically.

This is an independent calendar implementation, not an embedded Thunderbird or a claim of complete Thunderbird/add-on parity. Offline editing, provider-specific OAuth/Exchange/Google APIs, server-side push reminders while the browser is closed, delegation/resource booking and remote attendee free/busy scheduling are not implemented. The supported Nextcloud connection uses standard CalDAV with an app password. Test a new provider with a disposable event before relying on it for appointments.

### Calendar storage and network access

Calendars, events, preferences and reminder state are user-scoped in MySQL; administrator status does not bypass ownership checks. Event ICS bodies and connection credentials/URLs are encrypted using `APP_ENCRYPTION_KEY`. Calendar names/colors, versions and sync metadata are not encrypted. Back up MySQL together with that key; the new tables are created automatically on startup and require no separate database service.

Limits: 30 calendars, 10,000 items and 32 MiB of encrypted calendar bodies per user; 5 MiB per remote calendar/import, 256 KiB per item, and 100 items per online import request. Pathological recurrence expansion runs in bounded workers with CPU/memory limits. Failed or partial remote responses retain the previous cache.

Only HTTPS on ports 443/8443 is supported. DNS answers are validated and pinned per request, credentials stay on the configured origin, and CalDAV item paths must remain inside the collection. Private/loopback/link-local destinations are blocked by default. For an intentionally internal calendar, the server administrator can set an exact, comma-separated `CALENDAR_ALLOWED_HOSTS` list in `.env`, then recreate the app container. Use no wildcards and grant only the intended calendar hosts. Custom CA certificates, if required, must be installed by the administrator; TLS verification remains enabled.

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

OpenPGP signature trust uses the confirmed contact key. S/MIME verifies the signature, sender identity and certificate dates, using a trusted chain or a manually confirmed contact certificate. Certificate revocation is not checked. Hardware tokens, provider OAuth and Maildir/mbox import are not implemented.

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

For source installations that have not adopted the standalone updater, update after taking the backups above:

```sh
git pull --ff-only
docker compose build
docker compose up -d
```

Include your VPN/geolocation/local overrides in all deployment commands. Managed installations use `minimail apply` and `minimail compose` instead; plain source Compose commands can select a different image. Back up before database changes. Use the one-time migration below when updating from a SQLite release.

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

Passwords use asynchronous scrypt with bounded concurrency; credentials, TOTP secrets, private keys and drafts use AES-256-GCM. Production cookies are HttpOnly, Secure and SameSite=Strict, with the `__Host-` prefix. State-changing API requests check origin metadata and require a custom header or browser same-origin metadata. API responses are not cached. Authentication precedes large protected request-body parsing, compressed request bodies are rejected, and both login and TOTP enrollment have attempt limits. TOTP codes are single-use; after using a code to sign in or activate 2FA, wait for a fresh code before another login. Accepted time steps are stored in MySQL and survive restarts.

Direct IMAP/SMTP connections reject non-public IP addresses by default. DNS answers are validated and the selected address is pinned while TLS authenticates the original hostname. For an internal mail server, add its exact hostname to `MAIL_ALLOWED_HOSTS` in the private `.env`, for example `MAIL_ALLOWED_HOSTS=imap.internal.example,smtp.internal.example`, then recreate the app container. Outside Compose, export the same environment variable. VPN connections use the administrator's restricted proxy and its pinned destination/port list. Changing a mailbox's host, port, TLS mode, username or VPN route requires entering the affected password again; blank password fields only preserve credentials for an unchanged authentication target.

Give web accounts only to people you trust and restrict container egress at the network/firewall level for defense in depth. Administrator allowlists deliberately grant access to private hosts. VPN profiles and AI endpoints are administrator-controlled server configuration; the AI endpoint may intentionally be local. External MySQL deployments should set `MYSQL_SSL_CA` and use a private network. The app server can decrypt saved credentials and keys, so its host and encryption key are part of the trust boundary.

See [AUDIT.md](AUDIT.md) for the source review, regression coverage, resource limits and performance changes.

The test suite is not a guarantee that the software has no vulnerabilities. Keep dependencies, the reverse proxy and the host updated.

## Managed updates and safe recovery

The standalone `minimail` executable runs on the host. The web application receives only a read-only update-status directory; it has no Docker socket or host-control API. Administrators see **Settings → System and updates**. Ordinary web users cannot access this page or its API.

For an existing Docker installation, run the executable from the downloaded release package:

```sh
./minimail adopt --root /path/to/your/minimail
```

Adoption verifies the running Compose project, private configuration, encryption/database environment, persistent mounts and supported schema. It records the existing files and volumes without moving or recreating them. Automatic legacy adoption supports the audited schema baseline from commit `1678969`; other historical layouts require an explicit migration first. Existing private Compose overrides remain part of every managed operation. Prefer the updater's `compose` subcommand for subsequent container commands so its image override stays active.

On Linux/macOS the installed executable is `.minimail/bin/minimail`; Windows uses `.minimail/bin/minimail.exe`. Run commands from the installation directory, or append `--root /absolute/path`:

```sh
.minimail/bin/minimail check
.minimail/bin/minimail apply --version 0.1.0-rc.3
.minimail/bin/minimail status
.minimail/bin/minimail rollback
.minimail/bin/minimail recover
.minimail/bin/minimail compose -- ps
```

`check` verifies signed release metadata. `apply` accepts a newer published version and updates only the app service. Its compatibility gate rejects schema changes that the previous application could not read. It never changes the database/VPN image, recreates a data volume, resets an administrator, or regenerates an existing encryption key/password. Those components need their own tested maintenance procedure. Updater binaries also remain separately managed; a release requiring a newer updater stops before changing services.

When a newer host updater is required, download and extract the new release package separately. Run its `minimail install --bundle /path/to/extracted/package --root /path/to/existing/minimail` (or `install.ps1 -Root C:\path\to\existing\minimail`). An already initialized installation verifies the signed bundle and replaces only its updater binary; it does not recreate services, rewrite `.env` or initialize data. Then use the installed updater's `apply` command. Release 0.1.0-rc.3 requires updater 0.1.1 to include the protected-file backup fix.

The update sequence is:

1. Lock the installation, verify the signed manifest and pinned image digest/version, compare the saved state with the running containers, and reject unapplied private Compose changes.
2. Prepare frozen runtime specifications and private configuration copies. Downloading/preparation leaves the old app serving requests.
3. Persist a recovery journal, stop the app writer, dump MySQL and snapshot the existing app-data volume.
4. Restore the SQL dump into an isolated temporary MySQL container using the same database image. Compare every table's row count and extended checksum. A failed dump or restore prevents migration/cutover.
5. Run versioned migrations, start the candidate app with the original environment/mounts, validate its health, version, schema and persistent storage identities, then atomically commit updater state.

Every stage preserves the original `.env`, private Compose files and `local/` configuration. Frozen Compose files escape literal `$` characters so existing passwords cannot be accidentally re-interpolated. MySQL DDL uses a durable migration ledger and advisory lock; only known idempotent interrupted migrations resume. Migration history checksums and unsupported future schemas fail closed.

Backups live under `.minimail/backups/` with private permissions. They include SQL, app-data, configuration, checksums and frozen runtime specifications; they contain confidential information and must stay out of Git. They are not automatically pruned. Low disk space blocks an update. The restore-check container temporarily needs up to 1.5 GiB RAM; allow additional disk space for its disposable data volume. Application downtime includes backup verification and health checks.

On a failed/interrupted compatible update, `recover` restarts the previous program image and preserves **current SQL data**. `rollback` also makes and verifies a fresh backup before changing the image. Neither command imports an old SQL dump: mail, settings or calendar changes made after an update are retained. Incompatible schemas require documented manual maintenance; automatic SQL restoration is deliberately excluded. Keep an independent off-host backup as protection against host/disk loss.

### Update policies

Default mode is **notify**. Available modes are `off`, `notify`, `manual` and `auto`. Explicit manual `apply` remains available; the scheduled `cycle` only installs when `auto` is selected. Automatic installation accepts stable patch updates within the same major/minor version, marked safe by the signed release manifest, during the chosen maintenance window. Previews, minor/major jumps, incompatible schemas and updater-version changes are not installed unattended.

```sh
# Choose policy explicitly. This is optional; notify is the default.
.minimail/bin/minimail configure --mode auto --channel stable --timezone Europe/Berlin --window 03:00-04:00

# Or return to notifications only.
.minimail/bin/minimail configure --mode notify
```

For hourly checks and interrupted-update recovery on Linux/systemd:

```sh
sudo .minimail/bin/minimail service-install
```

On Windows, run `install-update-task.ps1 -Root C:\path\to\minimail` from the release package. The task runs as the interactive Docker Desktop user; Docker must be available. Other schedulers can invoke `minimail cycle --root /path/to/minimail`. Scheduling a check does not enable automatic installation. Update checks contact GitHub/GHCR using public metadata; they do not upload messages, credentials, private configuration or backups.

### Release process and testing

Release tags must match `package.json`. The tag workflow runs the Node/MySQL tests, Windows/Linux updater tests and the real Docker lifecycle test, then publishes AMD64/ARM64 images and signed platform archives. The signing key is stored as a GitHub Actions secret and never in Git or a container build. Public installers/updates verify the embedded Ed25519 trust root. OCI digests, signed manifests and immutable GitHub releases bind exact artifacts to the selected version. A candidate release remains a preview until explicitly promoted by publishing a stable version.

The Docker lifecycle test uses synthetic encrypted credentials, 2FA state, drafts, binary app-data and a password containing `$`/spaces. It verifies fresh/interrupted installation, upgrade, actual dump restoration, rollback, post-update writes and byte-identical private configuration. Fault-injection tests cover every durable update stage and concurrent updater exclusion. This tests the supported upgrade path; it is not a guarantee against arbitrary future application bugs or hardware failures.

To run the updater checks from source, install Go 1.27 or newer and run `go test ./...` inside `updater/`. On a disposable Linux Docker host, `sh scripts/test-update.sh` runs the container lifecycle test. It creates uniquely named test projects and removes only their test containers/volumes/networks.

## License

MiniMail is licensed under [Apache License 2.0](LICENSE). See [NOTICE](NOTICE). Third-party components retain their own licenses; application dependencies keep their license files inside the container, and updater packages include the Go license.

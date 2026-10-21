# MiniMail

MiniMail is a self-hosted webmail client with IMAP, SMTP, multiple mailboxes, search, a reading pane, attachments, and message composition. The interface supports light and dark themes and can be switched between German and English. Web access requires a username, password, and TOTP two-factor authentication.

## Run locally

Requires Node.js 24 or newer.

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. On first launch, MiniMail creates `data/minimail.sqlite` and `data/secret.key`. These local files are excluded from Git. `npm run build` produces the frontend assets; `npm start` serves the frontend and API together on port 3000. Production requires `APP_ENCRYPTION_KEY`.

Create the first administrator from an interactive terminal before signing in:

```bash
npm run admin:create -- admin
```

The script accepts the password without echoing it. Reload the page afterward. There is no public registration. On first sign-in, the administrator sets up TOTP. Administrators can then create other users in **Settings → User management**. Each new user receives a one-time temporary password and must change it and set up their own 2FA on first sign-in. Users can access only their own mailboxes.

## Deploy on a server

1. Create `.env` from `.env.example`. `APP_ENCRYPTION_KEY` must be exactly 64 random hexadecimal characters, for example from `openssl rand -hex 32`.
2. Build the image and create the administrator interactively: `docker compose build` and `docker compose run --rm -it minimail node server/create-admin.js admin`.
3. Start the service with `docker compose up -d`. The container is exposed only on the server's `127.0.0.1:3000`.
4. Configure an HTTPS reverse proxy for your domain that forwards to `http://127.0.0.1:3000` and preserves the original `Host` header. Redirect HTTP to HTTPS and enable HSTS where possible.
5. Open the domain, sign in as administrator, set up TOTP in an authenticator app, and connect a mailbox.

**Backups:** Back up the `minimail-data` Docker volume and store `APP_ENCRYPTION_KEY` separately. Without the key, saved mailbox passwords and TOTP secrets cannot be decrypted. Email messages remain on their respective mail servers.

## Mailboxes

MiniMail connects to IMAP and SMTP over TLS: direct TLS on ports 993/465, or required STARTTLS on ports 143/587. When running Node directly, a local mail server is reachable through `localhost`. From Docker, use `host.docker.internal` for a mail server on the host if it accepts connections from the container. **MiniMail does not read Maildir or mbox files directly.**

Many providers with their own two-factor authentication require an app password for IMAP/SMTP. MiniMail's TOTP code protects the web sign-in and does not replace the provider's app password. OAuth sign-in is not implemented.

If SMTP uses a different username or password from IMAP, enter those values separately in the mailbox dialog. Empty SMTP credential fields use the IMAP credentials.

Set a sender name and a plain-text signature for each mailbox in its settings. The compose window can send from any connected mailbox whose credentials are available; choosing another sender uses that mailbox's SMTP connection and shows its signature immediately. The signature is appended to the outgoing message and saved copy. Mailboxes without credentials appear as unavailable senders until their password is added.

### private VPN VPN mailbox

An administrator can make a server-side OpenVPN profile available to one mailbox. The **VPN connection** setting in the mailbox dialog then selects the tunnel for both IMAP and SMTP. Other mailboxes keep their direct connection. The VPN profile and its client key stay on the server; MiniMail never accepts arbitrary OpenVPN files through the web interface.

For the Private mail VPN profile, place `profile.ovpn`, its `certs/` directory, and `key.pass` in `./local/vpn` on the Docker host. Keep the private key and passphrase readable only by root. The passphrase file contains one line. Start with `docker compose -f compose.yaml -f compose.local.yaml -f compose.vpn.yaml up -d --build`. On a different host, omit `compose.local.yaml` and adapt the VPN profile and target restrictions in `vpn/proxy.mjs` and `vpn/start.sh` before starting.

The VPN container has the tunnel device and `NET_ADMIN`; the MiniMail container does not. Its HTTP CONNECT proxy only accepts `mail.private.example` on IMAP/TLS port 993 and SMTP/STARTTLS port 587 and pins the destination IP. The proxy process can send new outbound traffic only over `tun0`. The Compose override exposes no VPN or proxy port publicly. TLS still authenticates the mail server inside the tunnel. If the tunnel or VPN profile is unavailable, mailbox access fails rather than falling back to a direct connection.

Set a primary mailbox under **Settings → Connected mailboxes**. MiniMail opens its inbox automatically after sign-in; you can switch mailboxes at any time.

By default, the server checks each connected inbox every five minutes, even when no browser is open. Set an interval of 1–1440 minutes for each mailbox under **Settings → Edit mailbox → Automatic check**, or enter `0` to disable it. Open browsers update message and unread counts automatically.

Choose German or English in **Settings → Appearance → Language**. The choice is stored in your browser.

Enable **Conversation view** in **Settings → Appearance**, or switch it directly above the message list. Replies in the same folder are grouped using message identifiers and references; opening a conversation displays its newest message. Expand the group or use the conversation links in the reader to open older messages. The choice is stored in your browser. Messages in different folders remain separate conversations.

## Features and limitations

- Read mailboxes and folders; search subject, sender, recipients, and message text on the mail server.
- Read messages and download attachments; mark messages read, unread, or starred; archive and delete messages.
- Send messages with up to eight attachments totaling 8 MB. MiniMail saves a copy in Sent when the server allows IMAP APPEND.
- Keep multiple web users and their mailboxes separate. Only administrators can create users or reset another user's temporary password or 2FA.
- Messages larger than 25 MB are not loaded in the web viewer. External images in HTML mail are removed for privacy.

Keep public installations, the reverse proxy, and the host operating system updated. MiniMail does not yet provide OAuth provider integration, Maildir/mbox import, or full calendar and address-book features.

The stack is React/Vite, Express, ImapFlow, Nodemailer, and SQLite (`node:sqlite`). User passwords are hashed with scrypt. Mailbox credentials and TOTP secrets are encrypted with AES-256-GCM. Production session cookies are HttpOnly, Secure, SameSite=Strict, and use the `__Host-` prefix. State-changing API requests require a custom request header and check Origin/Fetch Metadata; API responses are not cached. The Docker container runs as a non-root user with a read-only filesystem and no Linux capabilities.

**Trust boundary:** Authenticated users can freely choose IMAP and SMTP destinations. Give accounts only to trusted people. If users should not reach services on the server's internal network, restrict the container's outbound traffic to approved mail servers. Hostname checks alone are insufficient because DNS answers can change before a connection is established.

Existing single-user installations are migrated automatically: the original user becomes an administrator, and their mailboxes and credentials remain assigned to them.

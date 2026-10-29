// Stable order for import and backup verification.
export const tableNames = [
  "users",
  "sessions",
  "accounts",
  "contacts",
  "discovered_keys",
  "key_scan_folders",
  "ai_settings",
  "mail_index_folders",
  "mail_index_messages",
  "drafts",
];

const definitions = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(40) NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    totp_secret TEXT, pending_totp_secret TEXT, created_at BIGINT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user', must_change_password INT NOT NULL DEFAULT 0,
    collect_recipients INT NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash VARCHAR(64) PRIMARY KEY, user_id BIGINT NOT NULL, expires_at BIGINT NOT NULL,
    INDEX sessions_user (user_id), INDEX sessions_expiry (expires_at),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL,
    name TEXT NOT NULL, email VARCHAR(254) NOT NULL COLLATE utf8mb4_0900_as_ci,
    imap_host TEXT NOT NULL, imap_port INT NOT NULL, imap_secure INT NOT NULL,
    smtp_host TEXT NOT NULL, smtp_port INT NOT NULL, smtp_secure INT NOT NULL,
    username TEXT NOT NULL, password_enc MEDIUMTEXT NOT NULL,
    smtp_username TEXT, smtp_password_enc MEDIUMTEXT, created_at BIGINT NOT NULL,
    check_interval_minutes INT NOT NULL DEFAULT 5, last_checked_at BIGINT,
    inbox_unseen BIGINT, inbox_uid_next BIGINT, check_failed INT NOT NULL DEFAULT 0,
    is_primary INT NOT NULL DEFAULT 0, vpn_profile VARCHAR(64) NOT NULL DEFAULT '',
    sender_name TEXT NOT NULL DEFAULT (''), signature MEDIUMTEXT NOT NULL DEFAULT (''),
    pgp_private_enc MEDIUMTEXT, pgp_passphrase_enc TEXT, smime_cert MEDIUMTEXT,
    smime_key_enc MEDIUMTEXT, crypto_mode VARCHAR(20) NOT NULL DEFAULT 'none',
    crypto_sign_default INT NOT NULL DEFAULT 0, crypto_encrypt_default INT NOT NULL DEFAULT 0,
    primary_user_id BIGINT GENERATED ALWAYS AS (CASE WHEN is_primary=1 THEN user_id ELSE NULL END) STORED,
    UNIQUE KEY accounts_one_primary (primary_user_id), INDEX accounts_user (user_id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS contacts (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL,
    name VARCHAR(200) NOT NULL DEFAULT '', email VARCHAR(254) NOT NULL COLLATE utf8mb4_0900_as_ci,
    source VARCHAR(64) NOT NULL DEFAULT 'manual', created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL, pgp_public MEDIUMTEXT, smime_cert MEDIUMTEXT,
    pgp_verified INT NOT NULL DEFAULT 1, smime_verified INT NOT NULL DEFAULT 1,
    pgp_source VARCHAR(64) NOT NULL DEFAULT 'manual', smime_source VARCHAR(64) NOT NULL DEFAULT 'manual',
    UNIQUE KEY contacts_user_email (user_id,email), INDEX contacts_user_name (user_id,name),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS discovered_keys (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL,
    email VARCHAR(254) NOT NULL COLLATE utf8mb4_0900_as_ci,
    kind VARCHAR(8) NOT NULL, fingerprint VARCHAR(128) NOT NULL,
    material MEDIUMTEXT NOT NULL, source VARCHAR(64) NOT NULL,
    first_seen_at BIGINT NOT NULL, last_seen_at BIGINT NOT NULL, seen_count BIGINT NOT NULL DEFAULT 1,
    UNIQUE KEY discovered_keys_identity (user_id,email,kind,fingerprint),
    INDEX discovered_keys_user_email (user_id,email), CHECK(kind IN ('pgp','smime'))
  )`,
  `CREATE TABLE IF NOT EXISTS key_scan_folders (
    account_id BIGINT NOT NULL, folder VARCHAR(700) NOT NULL,
    uid_validity VARCHAR(64) NOT NULL, last_uid BIGINT NOT NULL DEFAULT 0,
    inline_uids MEDIUMTEXT NOT NULL DEFAULT ('[]'), updated_at BIGINT NOT NULL,
    PRIMARY KEY(account_id,folder)
  )`,
  `CREATE TABLE IF NOT EXISTS ai_settings (
    id INT PRIMARY KEY, api_key_enc TEXT, model VARCHAR(128) NOT NULL DEFAULT '',
    base_url VARCHAR(500) NOT NULL DEFAULT '', rewrite_max_tokens BIGINT DEFAULT 8192,
    summary_max_tokens BIGINT DEFAULT 4096, CHECK(id=1)
  )`,
  `CREATE TABLE IF NOT EXISTS mail_index_folders (
    account_id BIGINT NOT NULL, folder VARCHAR(700) NOT NULL,
    uid_validity VARCHAR(64) NOT NULL, uid_next BIGINT NOT NULL, exists_count BIGINT NOT NULL,
    highest_modseq VARCHAR(64), reconciled_at BIGINT NOT NULL, PRIMARY KEY(account_id,folder)
  )`,
  `CREATE TABLE IF NOT EXISTS mail_index_messages (
    account_id BIGINT NOT NULL, folder VARCHAR(700) NOT NULL, uid BIGINT NOT NULL,
    data_enc MEDIUMTEXT NOT NULL, PRIMARY KEY(account_id,folder,uid)
  )`,
  `CREATE TABLE IF NOT EXISTS drafts (
    user_id BIGINT NOT NULL, id VARCHAR(64) NOT NULL, data_enc LONGTEXT NOT NULL,
    metadata_enc TEXT, updated_at BIGINT NOT NULL, PRIMARY KEY(user_id,id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
];

export async function initializeSchema(database) {
  for (const sql of definitions)
    await database.exec(
      `${sql} ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`,
    );
}

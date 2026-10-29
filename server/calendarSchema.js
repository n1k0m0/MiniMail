export const calendarTableNames = [
  "calendars",
  "calendar_items",
  "calendar_preferences",
  "calendar_mail_scan",
  "calendar_alerts",
];
export const calendarDefinitions = [
  `CREATE TABLE IF NOT EXISTS calendars (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT NOT NULL,
    name VARCHAR(200) NOT NULL, color VARCHAR(7) NOT NULL DEFAULT '#5267df',
    kind VARCHAR(12) NOT NULL DEFAULT 'local', config_enc MEDIUMTEXT,
    read_only INT NOT NULL DEFAULT 0, visible INT NOT NULL DEFAULT 1,
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC', last_sync BIGINT,
    sync_error TEXT, remote_etag VARCHAR(512), created_at BIGINT NOT NULL,
    INDEX calendars_user (user_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS calendar_items (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, calendar_id BIGINT NOT NULL,
    uid_hash VARCHAR(64) NOT NULL, ical_enc MEDIUMTEXT NOT NULL,
    href TEXT, etag VARCHAR(512), source VARCHAR(20) NOT NULL DEFAULT 'manual',
    version BIGINT NOT NULL DEFAULT 1, updated_at BIGINT NOT NULL,
    UNIQUE KEY calendar_items_uid (calendar_id,uid_hash),
    FOREIGN KEY(calendar_id) REFERENCES calendars(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS calendar_preferences (
    user_id BIGINT NOT NULL PRIMARY KEY, default_calendar_id BIGINT,
    auto_import INT NOT NULL DEFAULT 1,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(default_calendar_id) REFERENCES calendars(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS calendar_mail_scan (
    account_id BIGINT NOT NULL PRIMARY KEY, uid_validity VARCHAR(64) NOT NULL,
    last_uid BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS calendar_alerts (
    user_id BIGINT NOT NULL, item_id BIGINT NOT NULL, occurrence_hash VARCHAR(64) NOT NULL,
    snooze_until BIGINT, dismissed INT NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id,item_id,occurrence_hash),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(item_id) REFERENCES calendar_items(id) ON DELETE CASCADE
  )`,
];

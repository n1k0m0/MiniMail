// Keep the original schema-1 definitions/checksum immutable. These additions
// are nullable and ignored safely by the compatibility reader.
export const mailRuleColumns = ["mail_rules_enc", "mail_rule_state_enc"];
export const mailRuleMigrationSQL = mailRuleColumns.map(
  (name) => `ALTER TABLE accounts ADD COLUMN ${name} MEDIUMTEXT NULL`,
);
export async function addMailRuleColumns(db) {
  for (let i = 0; i < mailRuleColumns.length; i++) {
    const existing = await db
      .prepare(
        "SELECT DATA_TYPE AS type,IS_NULLABLE AS nullable FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='accounts' AND COLUMN_NAME=?",
      )
      .get(mailRuleColumns[i]);
    if (existing) {
      if (existing.type !== "mediumtext" || existing.nullable !== "YES")
        throw new Error(
          "Mailbox filter column has an incompatible definition.",
        );
    } else await db.exec(mailRuleMigrationSQL[i]);
  }
}

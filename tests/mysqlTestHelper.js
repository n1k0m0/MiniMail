import mysql from "mysql2/promise";
import crypto from "node:crypto";
import { createDatabase, databaseOptions } from "../server/database.js";
import { initializeSchema } from "../server/schema.js";

export async function testDatabase(t) {
  const env = {
    MYSQL_HOST: process.env.MYSQL_TEST_HOST || "127.0.0.1",
    MYSQL_PORT: process.env.MYSQL_TEST_PORT || "3306",
    MYSQL_USER: process.env.MYSQL_TEST_USER || "root",
    MYSQL_PASSWORD: process.env.MYSQL_TEST_PASSWORD || "minimail-test-only",
    MYSQL_DATABASE: `minimail_test_${crypto.randomBytes(12).toString("hex")}`,
  };
  const options = databaseOptions(env);
  const { database: name, ...adminOptions } = options;
  const admin = await mysql.createConnection(adminOptions);
  await admin.query(
    `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`,
  );
  const db = createDatabase(options);
  const closePool = db.close;
  let closed = false;
  db.env = env;
  db.close = async () => {
    if (closed) return;
    closed = true;
    try {
      await closePool();
    } finally {
      try {
        await admin.query(`DROP DATABASE \`${name}\``);
      } finally {
        await admin.end();
      }
    }
  };
  t.after(() => db.close());
  await initializeSchema(db);
  return db;
}

export const insertTestUser = (db, id = 1) =>
  db
    .prepare(
      "INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)",
    )
    .run(id, `test-user-${id}`, "test-hash", Date.now());

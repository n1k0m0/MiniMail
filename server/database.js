import mysql from "mysql2/promise";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";

export function databaseOptions(env = process.env) {
  const port = Number(env.MYSQL_PORT || 3306);
  const database = env.MYSQL_DATABASE || "minimail";
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("MYSQL_PORT must be a valid TCP port.");
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(database))
    throw new Error(
      "MYSQL_DATABASE must contain only letters, numbers and underscores.",
    );
  if (!env.MYSQL_PASSWORD)
    throw new Error("Set MYSQL_PASSWORD before starting MiniMail.");
  return {
    host: env.MYSQL_HOST || "127.0.0.1",
    port,
    database,
    user: env.MYSQL_USER || "minimail",
    password: env.MYSQL_PASSWORD,
    // The handshake uses a one-byte collation ID; table collations remain 0900_bin.
    charset: "utf8mb4_bin",
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true,
    connectionLimit: 10,
    queueLimit: 100,
    connectTimeout: 10000,
    enableKeepAlive: true,
    multipleStatements: false,
    ...(env.MYSQL_SSL_CA
      ? {
          ssl: {
            ca: fs.readFileSync(env.MYSQL_SSL_CA),
            rejectUnauthorized: true,
          },
        }
      : {}),
  };
}

export function createDatabase(options = databaseOptions()) {
  const pool = mysql.createPool(options);
  const scope = new AsyncLocalStorage();
  const query = async (sql, values = []) => {
    const [result] = await (scope.getStore() || pool).execute(sql, values);
    return result;
  };
  return {
    // Values are always bound separately from SQL.
    prepare(sql) {
      return {
        all: (...values) => query(sql, values),
        get: async (...values) => (await query(sql, values))[0],
        run: async (...values) => {
          const result = await query(sql, values);
          return { changes: result.affectedRows, insertId: result.insertId };
        },
      };
    },
    exec: (sql) => query(sql),
    async withConnection(callback) {
      if (scope.getStore()) return callback();
      const connection = await pool.getConnection();
      try {
        return await scope.run(connection, callback);
      } finally {
        connection.release();
      }
    },
    async transaction(callback) {
      if (scope.getStore()) return callback();
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await scope.run(connection, callback);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    close: () => pool.end(),
  };
}

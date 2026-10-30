import mysql from "mysql2/promise";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";

export class MaintenanceError extends Error {
  constructor() {
    super(
      "Die Daten werden gerade wiederhergestellt. Bitte kurz warten und neu anmelden.",
    );
  }
}

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
  const activity = new AsyncLocalStorage();
  let generation = 0,
    maintenance = false,
    pending = 0;
  const check = () => {
    const current = activity.getStore();
    if (
      (maintenance && !current?.exclusive) ||
      (current && current.generation !== generation)
    )
      throw new MaintenanceError();
  };
  const query = async (sql, values = []) => {
    check();
    pending++;
    try {
      const [result] = await (scope.getStore() || pool).execute(sql, values);
      return result;
    } finally {
      pending--;
    }
  };
  return {
    activity(callback, fresh = false) {
      if (!fresh && activity.getStore()) return callback();
      if (maintenance) throw new MaintenanceError();
      return activity.run({ generation }, callback);
    },
    async maintenance(callback) {
      if (maintenance) throw new MaintenanceError();
      maintenance = true;
      generation++;
      try {
        const deadline = Date.now() + 30000;
        while (pending) {
          if (Date.now() > deadline) throw new MaintenanceError();
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return await activity.run({ generation, exclusive: true }, callback);
      } finally {
        maintenance = false;
      }
    },
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
    async *iterate(sql) {
      check();
      const connection = scope.getStore();
      if (!connection)
        throw new Error("Streaming queries require a pinned transaction.");
      pending++;
      const command = connection.connection.query(sql);
      // A destroyed stream must not leave a later socket error unhandled.
      command.on("error", () => {});
      const stream = command.stream({ highWaterMark: 1 });
      try {
        for await (const row of stream) {
          check();
          yield row;
        }
      } finally {
        // Cancel an interrupted large SELECT rather than buffering/draining it.
        if (!stream.readableEnded) connection.destroy();
        stream.destroy();
        pending--;
      }
    },
    async withConnection(callback) {
      if (scope.getStore()) return callback();
      check();
      pending++;
      let connection;
      try {
        connection = await pool.getConnection();
        return await scope.run(connection, callback);
      } finally {
        connection?.release();
        pending--;
      }
    },
    async transaction(callback, { snapshot = false } = {}) {
      if (scope.getStore()) return callback();
      check();
      pending++;
      let connection;
      try {
        connection = await pool.getConnection();
        if (snapshot)
          await connection.query(
            "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
          );
        await connection.beginTransaction();
        const result = await scope.run(connection, callback);
        check();
        await connection.commit();
        return result;
      } catch (error) {
        try {
          await connection?.rollback();
        } catch {}
        throw error;
      } finally {
        connection?.release();
        pending--;
      }
    },
    close: () => pool.end(),
  };
}

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { requestSecurity } from "../server/requestSecurity.js";

test("CSRF and cache protection cover every API path spelling accepted by Express", async (t) => {
  const app = express();
  let writes = 0;
  app.use(requestSecurity);
  app.get("/api/example", (_req, res) => res.json({ ok: true }));
  app.post("/api/example", (_req, res) => {
    writes++;
    res.json({ ok: true });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const expectedOrigin = base.replace(
    /^http:/,
    process.env.NODE_ENV === "production" ? "https:" : "http:",
  );
  for (const prefix of ["api", "API", "Api", "aPi"]) {
    const url = `${base}/${prefix}/example`;
    const read = await fetch(url);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get("cache-control"), "no-store");
    await read.arrayBuffer();
    for (const headers of [
      {},
      { "X-MiniMail-Request": "1", "Sec-Fetch-Site": "cross-site" },
      {
        "Sec-Fetch-Site": "same-site",
        Origin: "https://untrusted.example.test",
      },
      { "X-MiniMail-Request": "1", Origin: "https://untrusted.example.test" },
    ]) {
      const response = await fetch(url, { method: "POST", headers });
      assert.equal(
        response.status,
        403,
        `${prefix} must not bypass origin checks`,
      );
      assert.equal(response.headers.get("cache-control"), "no-store");
      await response.arrayBuffer();
    }
    assert.equal(writes, 0);
    for (const headers of [
      { "X-MiniMail-Request": "1" },
      { "Sec-Fetch-Site": "same-origin", Origin: expectedOrigin },
    ]) {
      const response = await fetch(url, { method: "POST", headers });
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    assert.equal(writes, 2);
    writes = 0;
  }
});

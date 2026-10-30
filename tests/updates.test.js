import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  verifyRelease,
  compareVersions,
  checkUpdates,
  systemInfo,
  matchingReleaseAsset,
} from "../server/updates.js";

test("web update checks accept GitHub repository capitalization without changing trusted asset identity", () => {
  const expected =
    "https://github.com/n1k0m0/minimail/releases/download/v0.1.0-rc.17/release.json";
  assert.equal(
    matchingReleaseAsset(
      "https://github.com/N1K0M0/MiniMail/releases/download/v0.1.0-rc.17/release.json",
      expected,
    ),
    true,
  );
  for (const value of [
    expected.replace("https:", "http:"),
    expected.replace("github.com", "github.com.example"),
    expected.replace("n1k0m0", "someone"),
    expected.replace("minimail", "different"),
    expected.replace("rc.17", "rc.18"),
    expected.replace("release.json", "Release.json"),
    expected.replace("release.json", "%72elease.json"),
    expected + "?",
    expected + "#fragment",
    "https://user@github.com/n1k0m0/minimail/releases/download/v0.1.0-rc.17/release.json",
  ])
    assert.equal(matchingReleaseAsset(value, expected), false, value);
});

test("update metadata needs a trusted signature and valid version/image identity", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = Buffer.from(
    JSON.stringify({
      format: 1,
      version: "0.1.1",
      revision: "a".repeat(40),
      image: `ghcr.io/n1k0m0/minimail@sha256:${"b".repeat(64)}`,
    }),
  );
  const signature = crypto.sign(null, raw, privateKey).toString("base64");
  assert.equal(verifyRelease(raw, signature, publicKey).version, "0.1.1");
  assert.throws(
    () =>
      verifyRelease(
        Buffer.from(raw.toString().replace("0.1.1", "0.1.2")),
        signature,
        publicKey,
      ),
    /Signatur/,
  );
  assert.throws(() => verifyRelease(raw, signature), /Signatur/);
  assert.equal(compareVersions("0.1.0", "0.1.0-rc.2"), 1);
  assert.equal(compareVersions("0.1.0-rc.2", "0.1.0-rc.10"), -1);
  assert.equal(compareVersions("0.1.1", "0.2.0"), -1);
});
test("administrator update status only exposes validated public fields", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "minimail-update-status-"),
  );
  const previous = process.env.MINIMAIL_UPDATE_STATUS;
  t.after(async () => {
    if (previous === undefined) delete process.env.MINIMAIL_UPDATE_STATUS;
    else process.env.MINIMAIL_UPDATE_STATUS = previous;
    await fs.rm(directory, { recursive: true });
  });
  process.env.MINIMAIL_UPDATE_STATUS = path.join(directory, "updates.json");
  await fs.writeFile(
    process.env.MINIMAIL_UPDATE_STATUS,
    JSON.stringify({
      mode: "notify",
      channel: "stable",
      available: "0.1.1",
      secret: "must-not-escape",
      releaseUrl: "javascript:alert(1)",
    }),
  );
  const info = systemInfo();
  assert.equal(info.managed, true);
  assert.equal(info.update.secret, undefined);
  assert.equal(
    info.update.releaseUrl,
    "https://github.com/n1k0m0/minimail/releases/tag/v0.1.1",
  );
});
test("missing stable releases are handled without trying to install or downloading unsigned files", async () => {
  let calls = 0;
  const result = await checkUpdates(async (url) => {
    calls++;
    assert.ok(
      String(url).startsWith(
        "https://api.github.com/repos/n1k0m0/minimail/releases",
      ),
    );
    return Response.json([
      { tag_name: "v0.1.0-rc.1", draft: false, prerelease: true, assets: [] },
    ]);
  });
  assert.equal(result.available, false);
  assert.equal(result.latest, null);
  assert.equal(calls, 1);
});

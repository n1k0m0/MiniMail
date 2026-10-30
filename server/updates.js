import crypto from "node:crypto";
import fs from "node:fs";
import { buildInfo } from "./buildInfo.js";
import { limitedJson } from "./networkLimits.js";

const publicKey = fs.readFileSync(
  new URL("../updater/public-key.pem", import.meta.url),
);
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.([1-9]\d*))?$/;
const repository = "n1k0m0/minimail";
const releaseBase = `https://github.com/${repository}/releases/`;
export function compareVersions(left, right) {
  const a = versionPattern.exec(left),
    b = versionPattern.exec(right);
  if (!a || !b) return 0;
  for (const i of [1, 2, 3])
    if (Number(a[i]) !== Number(b[i]))
      return Number(a[i]) > Number(b[i]) ? 1 : -1;
  const rank = { alpha: 0, beta: 1, rc: 2, undefined: 3 };
  if (rank[a[4]] !== rank[b[4]]) return rank[a[4]] > rank[b[4]] ? 1 : -1;
  return Math.sign(Number(a[5] || 0) - Number(b[5] || 0));
}
export function verifyRelease(raw, signature, key = publicKey) {
  if (
    raw.length > 65536 ||
    !/^[A-Za-z0-9+/]{86}==$/.test(signature.trim()) ||
    !crypto.verify(null, raw, key, Buffer.from(signature.trim(), "base64"))
  )
    throw new Error("Die Release-Signatur ist ungültig.");
  const release = JSON.parse(raw);
  if (
    release.format !== 1 ||
    !versionPattern.test(release.version) ||
    !/^[a-f0-9]{40}$/.test(release.revision) ||
    !/^ghcr\.io\/n1k0m0\/minimail@sha256:[a-f0-9]{64}$/.test(release.image)
  )
    throw new Error("Die Release-Datei ist ungültig.");
  return release;
}
function safeStatus() {
  try {
    const filename =
      process.env.MINIMAIL_UPDATE_STATUS || "/app/update-status/updates.json";
    if (fs.statSync(filename).size > 16384) return null;
    const data = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (
      !["off", "notify", "manual", "auto"].includes(data.mode) ||
      !["stable", "preview"].includes(data.channel)
    )
      return null;
    return {
      mode: data.mode,
      channel: data.channel,
      checkedAt: data.checkedAt || "",
      updatedAt: data.updatedAt || "",
      result: data.result || "",
      available: versionPattern.test(data.available || "")
        ? data.available
        : null,
      releaseUrl: versionPattern.test(data.available || "")
        ? `${releaseBase}tag/v${data.available}`
        : null,
    };
  } catch {
    return null;
  }
}
export function systemInfo() {
  return {
    ...buildInfo,
    update: safeStatus(),
    managed: !!safeStatus(),
    license: "Apache-2.0",
  };
}

async function download(address, maxBytes, signal, fetcher) {
  for (let hop = 0; hop < 5; hop++) {
    const url = new URL(address);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      ![
        "github.com",
        "api.github.com",
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
      ].includes(url.hostname)
    )
      throw new Error("Ungültige Release-Adresse.");
    const response = await fetcher(url, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": "MiniMail-Update-Check",
        Accept: "application/vnd.github+json",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      address = new URL(response.headers.get("location"), url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("GitHub konnte nicht erreicht werden.");
    }
    const reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes)
          throw new Error("Die Release-Antwort ist zu groß.");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  }
  throw new Error("Zu viele Release-Weiterleitungen.");
}
let cached, pending;
export async function checkUpdates(fetcher = fetch) {
  if (cached && Date.now() - cached.at < 300000) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    const info = systemInfo(),
      channel = info.update?.channel || "stable";
    const signal = AbortSignal.timeout(30000);
    const response = await fetcher(
      `https://api.github.com/repos/${repository}/releases?per_page=100`,
      {
        redirect: "error",
        signal,
        headers: {
          "User-Agent": "MiniMail-Update-Check",
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("GitHub konnte nicht erreicht werden.");
    }
    const list = await limitedJson(response);
    if (!Array.isArray(list)) throw new Error("Ungültige GitHub-Antwort.");
    const releases = list
      .filter(
        (r) =>
          !r.draft &&
          versionPattern.test(String(r.tag_name).replace(/^v/, "")) &&
          (channel === "preview" ||
            (!r.prerelease && !r.tag_name.includes("-"))),
      )
      .sort((a, b) =>
        compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)),
      );
    if (!releases.length) return { ...info, latest: null, available: false };
    const candidate = releases[0],
      base = `${releaseBase}download/${candidate.tag_name}/`;
    for (const name of ["release.json", "release.json.sig"])
      if (
        !candidate.assets?.some(
          (asset) =>
            asset.name === name && asset.browser_download_url === base + name,
        )
      )
        throw new Error(
          "Dieser Release enthält keine geprüften Update-Dateien.",
        );
    const raw = await download(base + "release.json", 65536, signal, fetcher);
    const signature = await download(
      base + "release.json.sig",
      256,
      signal,
      fetcher,
    );
    const release = verifyRelease(raw, signature.toString("utf8"));
    if (`v${release.version}` !== candidate.tag_name)
      throw new Error("Release-Version und Signatur passen nicht zusammen.");
    return {
      ...info,
      latest: release.version,
      available: compareVersions(release.version, info.version) > 0,
      releaseUrl: `${releaseBase}tag/${candidate.tag_name}`,
    };
  })();
  try {
    const value = await pending;
    cached = { at: Date.now(), value };
    return value;
  } finally {
    pending = null;
  }
}

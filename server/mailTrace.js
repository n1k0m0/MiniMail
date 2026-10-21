import fs from "node:fs";
import path from "node:path";
import ipaddr from "ipaddr.js";
import maxmind from "maxmind";

const MAX_HEADER_BYTES = 256 * 1024;
const MAX_RECEIVED_HEADERS = 100;
const MAX_RECEIVED_LENGTH = 8192;
const MAX_HOPS = 200;
const databasePath =
  process.env.MAIL_TRACE_GEOIP_DB || path.resolve("geoip/dbip-city-lite.mmdb");
let readerPromise;

export async function geoipReader() {
  if (!fs.existsSync(databasePath)) return null;
  readerPromise ||= maxmind.open(databasePath).catch((error) => {
    readerPromise = null;
    throw error;
  });
  return readerPromise;
}

function publicAddress(value) {
  const candidate = value.replace(/^IPv6:/i, "").replace(/%.+$/, "");
  if (!ipaddr.isValid(candidate)) return null;
  const parsed = ipaddr.process(candidate);
  return parsed.range() === "unicast" ? parsed.toString() : null;
}

function headerIps(value) {
  const matches = [];
  const bracketRanges = [];
  const patterns = [
    /\[([^\]]{2,80})\]/g,
    /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g,
    /[0-9a-f:]{3,}/gi,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const raw = match[1] || match[0];
      if (pattern === patterns[2] && !raw.includes("::")) continue;
      if (
        pattern !== patterns[0] &&
        bracketRanges.some(
          ([start, end]) => match.index >= start && match.index < end,
        )
      )
        continue;
      const ip = publicAddress(raw);
      if (ip) {
        matches.push({ index: match.index, ip });
        if (pattern === patterns[0])
          bracketRanges.push([match.index, match.index + match[0].length]);
      }
    }
  }
  matches.sort((a, b) => a.index - b.index);
  return matches
    .filter(
      (item, index) =>
        !matches.slice(0, index).some((other) => other.ip === item.ip),
    )
    .map((item) => item.ip)
    .slice(0, 20);
}

function receivedHeaders(source) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const head = bytes.subarray(0, MAX_HEADER_BYTES);
  const crlf = head.indexOf("\r\n\r\n");
  const lf = head.indexOf("\n\n");
  const end = [crlf, lf].filter((value) => value >= 0).sort((a, b) => a - b)[0];
  if (end === undefined) return [];
  const lines = head
    .subarray(0, end)
    .toString("utf8")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const received = [];
  let current = null;
  for (const line of lines) {
    if (/^[ \t]/.test(line) && current) {
      if (
        current.name === "received" &&
        current.value.length < MAX_RECEIVED_LENGTH
      )
        current.value += ` ${line.trim()}`.slice(
          0,
          MAX_RECEIVED_LENGTH - current.value.length,
        );
      continue;
    }
    const header = line.match(/^([^:\s]+):\s*(.*)$/);
    current = header
      ? {
          name: header[1].toLowerCase(),
          value: header[2].slice(0, MAX_RECEIVED_LENGTH),
        }
      : null;
    if (current?.name === "received" && received.length < MAX_RECEIVED_HEADERS)
      received.push(current);
  }
  return received.reverse();
}

export function traceFromSource(source, lookup = () => null, language = "de") {
  const headers = receivedHeaders(source);
  const hops = [];
  for (const header of headers) {
    for (const ip of headerIps(header.value)) {
      if (hops.at(-1)?.ip === ip) continue;
      let location = null;
      try {
        location = lookup(ip);
      } catch {
        // The trace remains useful when a database entry cannot be read.
      }
      const names = (value) =>
        value?.names?.[language] || value?.names?.en || "";
      const latitude =
        location?.location?.latitude == null
          ? null
          : Number(location.location.latitude);
      const longitude =
        location?.location?.longitude == null
          ? null
          : Number(location.location.longitude);
      hops.push({
        order: hops.length + 1,
        ip,
        city: names(location?.city),
        country: names(location?.country),
        countryCode: location?.country?.iso_code || "",
        latitude:
          latitude !== null && Math.abs(latitude) <= 90 ? latitude : null,
        longitude:
          longitude !== null && Math.abs(longitude) <= 180 ? longitude : null,
      });
      if (hops.length >= MAX_HOPS) break;
    }
    if (hops.length >= MAX_HOPS) break;
  }
  return { receivedHeaders: headers.length, hops };
}

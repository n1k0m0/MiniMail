import fs from "node:fs";
import net from "node:net";
import { domainToASCII } from "node:url";

export function validateTargets(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32)
    throw new Error("Configure 1–32 VPN mail targets.");
  const hosts = new Set();
  return value.map((entry) => {
    if (typeof entry?.host !== "string" || /[\s/\\:@?#]/.test(entry.host))
      throw new Error("Configure a hostname, not a URL or socket address.");
    const host =
      typeof entry?.host === "string"
        ? domainToASCII(entry.host).toLowerCase()
        : "";
    if (
      !host ||
      host.length > 253 ||
      host
        .split(".")
        .some(
          (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
        ) ||
      hosts.has(host)
    )
      throw new Error("VPN target hostnames must be valid and unique.");
    if (
      !net.isIPv4(entry.ip) ||
      /^(0|127|22[4-9]|23\d|24\d|25[0-5])\./.test(entry.ip)
    )
      throw new Error(
        "VPN targets require a pinned non-loopback IPv4 address.",
      );
    if (
      !Array.isArray(entry.ports) ||
      !entry.ports.length ||
      entry.ports.length > 16 ||
      entry.ports.some(
        (port) => !Number.isInteger(port) || port < 1 || port > 65535,
      )
    )
      throw new Error("Configure valid VPN target ports.");
    hosts.add(host);
    return { host, ip: entry.ip, ports: [...new Set(entry.ports)] };
  });
}
export function loadTargets(
  file = process.env.VPN_TARGETS_FILE || "/config/targets.json",
) {
  return validateTargets(JSON.parse(fs.readFileSync(file, "utf8")));
}

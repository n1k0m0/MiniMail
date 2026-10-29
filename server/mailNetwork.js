import dns from "node:dns/promises";
import net from "node:net";
import { domainToASCII } from "node:url";
import ipaddr from "ipaddr.js";
import { vpnProxy } from "./vpn.js";
import { untilAborted } from "./networkLimits.js";
import { MailOperationError } from "./mailActions.js";

export async function mailDestination(account, protocol, lookup = dns.lookup) {
  const input = account[`${protocol}_host`];
  if (
    typeof input !== "string" ||
    !input.trim() ||
    /[\s/\\@?#]/.test(input.trim())
  )
    throw new MailOperationError("Ungültiger Mailserver-Hostname.");
  const original = input.trim().replace(/^\[|\]$/g, "");
  const hostname = net.isIP(original)
    ? original
    : domainToASCII(original).toLowerCase();
  if (
    !hostname ||
    hostname.length > 253 ||
    (!net.isIP(hostname) && !/^[a-z0-9.-]+$/i.test(hostname))
  )
    throw new MailOperationError("Ungültiger Mailserver-Hostname.");
  const servername = net.isIP(hostname) ? undefined : hostname;
  // The administrator's VPN proxy already pins destinations and allowed ports.
  const proxy = vpnProxy(account);
  if (proxy) return { host: hostname, servername, proxy };
  let addresses;
  try {
    addresses = await untilAborted(
      lookup(hostname, { all: true, verbatim: true }),
      AbortSignal.timeout(15000),
    );
  } catch {
    throw new MailOperationError(
      "Der Mailserver konnte im DNS nicht rechtzeitig gefunden werden.",
    );
  }
  const explicitlyAllowed = (process.env.MAIL_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .includes(hostname.toLowerCase());
  if (
    !addresses.length ||
    addresses.some(({ address }) => {
      try {
        return (
          !explicitlyAllowed && ipaddr.process(address).range() !== "unicast"
        );
      } catch {
        return true;
      }
    })
  )
    throw new MailOperationError(
      "Interne Mailserver müssen vom Serveradministrator über MAIL_ALLOWED_HOSTS freigegeben werden.",
    );
  // Connect to this validated address; TLS must still authenticate the original
  // hostname. A second DNS lookup could otherwise rebind to an internal server.
  // Prefer IPv4 when both are available: the default Docker network has no
  // IPv6 route. IPv6-only hosts remain supported on IPv6-capable deployments.
  const pinned = addresses.find((entry) => entry.family === 4) || addresses[0];
  return { host: pinned.address, servername };
}

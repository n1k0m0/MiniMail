import https from "node:https";
import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { XMLParser } from "fast-xml-parser";
import { CalendarError } from "./calendarIcs.js";

export function calendarUrl(input) {
  let url;
  try {
    url = new URL(String(input).replace(/^webcals?:/i, "https:"));
  } catch {
    throw new CalendarError("Die Kalenderadresse ist ungültig.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.href.length > 2000
  )
    throw new CalendarError(
      "Kalender benötigen eine HTTPS-Adresse ohne eingebettete Zugangsdaten.",
    );
  if (url.port && !["443", "8443"].includes(url.port))
    throw new CalendarError(
      "Für Kalender sind die HTTPS-Ports 443 und 8443 erlaubt.",
    );
  return url;
}
export function allowedAddress(address) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export async function remoteRequest(
  config,
  method = "GET",
  body = null,
  extra = {},
  target = config.url,
  redirects = 0,
) {
  const url = calendarUrl(target),
    origin = calendarUrl(config.url);
  if (url.origin !== origin.origin)
    throw new CalendarError(
      "Der Kalender verweist auf einen anderen Server. Bitte dessen Adresse direkt eintragen.",
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const explicitlyAllowed = (process.env.CALENDAR_ALLOWED_HOSTS || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
    .includes(hostname.toLowerCase());
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new CalendarError(
      "Der Kalenderserver konnte im DNS nicht gefunden werden.",
      502,
    );
  }
  if (
    !addresses.length ||
    (!explicitlyAllowed &&
      addresses.some((entry) => !allowedAddress(entry.address)))
  )
    throw new CalendarError(
      "Interne Kalenderadressen müssen vom Serveradministrator ausdrücklich freigegeben werden.",
      403,
    );
  const pinned = addresses[0];
  const headers = {
    Accept: "text/calendar, application/xml, text/xml",
    "Accept-Encoding": "identity",
    "User-Agent": "MiniMail-Calendar/1",
    ...extra,
  };
  if (config.username || config.password)
    headers.Authorization = `Basic ${Buffer.from(`${config.username || ""}:${config.password || ""}`).toString("base64")}`;
  if (body !== null) {
    headers["Content-Length"] = Buffer.byteLength(body);
    headers["Content-Type"] ||=
      method === "PUT"
        ? "text/calendar; charset=utf-8"
        : "application/xml; charset=utf-8";
  }
  let response;
  try {
    response = await new Promise((resolve, reject) => {
      const request = https.request(
        url,
        {
          method,
          headers,
          agent: false,
          lookup: (_host, options, callback) =>
            options.all
              ? callback(null, [pinned])
              : callback(null, pinned.address, pinned.family),
          timeout: 20000,
        },
        (res) => {
          const chunks = [];
          let bytes = 0;
          res.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > 5 * 1024 * 1024)
              res.destroy(
                new CalendarError(
                  "Die Kalenderantwort ist größer als 5 MB.",
                  413,
                ),
              );
            else chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      request.on("timeout", () => request.destroy(new Error("timeout")));
      request.on("error", reject);
      request.end(body);
    });
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError(
      "Die TLS-Verbindung zum Kalender ist fehlgeschlagen oder hat zu lange gedauert.",
      502,
    );
  }
  if (
    [301, 302, 307, 308].includes(response.status) &&
    response.headers.location &&
    method === "GET"
  ) {
    if (redirects >= 3)
      throw new CalendarError("Der Kalender leitet zu oft weiter.", 502);
    return remoteRequest(
      config,
      method,
      body,
      extra,
      new URL(response.headers.location, url).href,
      redirects + 1,
    );
  }
  if ([401, 403].includes(response.status))
    throw new CalendarError(
      "Der Kalenderserver hat den Zugriff abgelehnt. Bitte Benutzername, App-Passwort und Berechtigungen prüfen.",
      502,
    );
  if ([409, 412].includes(response.status))
    throw new CalendarError(
      "Der Termin wurde inzwischen auf dem Kalenderserver geändert. Bitte synchronisieren und erneut öffnen.",
      409,
    );
  if (response.status >= 400)
    throw new CalendarError(
      `Der Kalenderserver antwortet mit HTTP ${response.status}.`,
      502,
    );
  return response;
}
const xmlEscape = (input) =>
  String(input).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char],
  );
const array = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];
function multistatus(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new CalendarError(
      "Die Kalenderantwort enthält unzulässige XML-Deklarationen.",
      502,
    );
  let parsed;
  try {
    parsed = new XMLParser({
      removeNSPrefix: true,
      ignoreAttributes: false,
      parseTagValue: false,
      trimValues: false,
      processEntities: true,
    }).parse(text);
  } catch {
    throw new CalendarError(
      "Der Kalenderserver hat keine gültige XML-Antwort geliefert.",
      502,
    );
  }
  if (!parsed.multistatus)
    throw new CalendarError("Der Server liefert keine CalDAV-Antwort.", 502);
  return array(parsed.multistatus.response).map((entry) => {
    let properties = {};
    for (const result of array(entry.propstat))
      if (/\s200\s/.test(result.status || ""))
        properties = { ...properties, ...result.prop };
    return {
      href: entry.href,
      properties,
      status: entry.status,
      failed: array(entry.propstat).some(
        (part) => !/\s(?:200|404)\s/.test(part.status || ""),
      ),
    };
  });
}
export function calendarHref(base, href, collection = false) {
  const root = calendarUrl(base),
    result = calendarUrl(new URL(href, root).href);
  if (
    result.origin !== root.origin ||
    /%2f|%5c|\\/i.test(result.pathname) ||
    (collection &&
      !result.pathname.startsWith(
        root.pathname.endsWith("/") ? root.pathname : `${root.pathname}/`,
      ))
  )
    throw new CalendarError(
      "Der Kalenderserver liefert einen unzulässigen Terminpfad.",
      502,
    );
  return result.href;
}
const properties = `<d:displayname/><d:resourcetype/><d:current-user-privilege-set/><c:supported-calendar-component-set/><a:calendar-color/>`;
function propfindBody(props) {
  return `<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop>${props}</d:prop></d:propfind>`;
}
export async function discoverCalendars(config, request = remoteRequest) {
  const first = multistatus(
    (
      await request(
        config,
        "PROPFIND",
        propfindBody(
          `${properties}<d:current-user-principal/><c:calendar-home-set/>`,
        ),
        { Depth: "0" },
      )
    ).body,
  );
  const direct = first.filter(
    (entry) => entry.properties.resourcetype?.calendar !== undefined,
  );
  if (direct.length) return discovered(config.url, direct);
  let home = first.find((entry) => entry.properties["calendar-home-set"])
    ?.properties["calendar-home-set"]?.href;
  if (!home) {
    const principal = first.find(
      (entry) => entry.properties["current-user-principal"],
    )?.properties["current-user-principal"]?.href;
    if (principal) {
      const principalUrl = calendarHref(config.url, principal);
      const result = multistatus(
        (
          await request(
            config,
            "PROPFIND",
            propfindBody("<c:calendar-home-set/>"),
            { Depth: "0" },
            principalUrl,
          )
        ).body,
      );
      home = result.find((entry) => entry.properties["calendar-home-set"])
        ?.properties["calendar-home-set"]?.href;
    }
  }
  const homeUrl = home ? calendarHref(config.url, array(home)[0]) : config.url;
  return discovered(
    config.url,
    multistatus(
      (
        await request(
          config,
          "PROPFIND",
          propfindBody(properties),
          { Depth: "1" },
          homeUrl,
        )
      ).body,
    ),
  );
}
function discovered(base, entries) {
  return entries
    .filter(
      (entry) =>
        entry.href && entry.properties.resourcetype?.calendar !== undefined,
    )
    .map((entry) => {
      const props = entry.properties,
        privileges = props["current-user-privilege-set"];
      return {
        url: calendarHref(base, entry.href),
        name: props.displayname || "Kalender",
        color: String(props["calendar-color"] || "#5267df").slice(0, 7),
        readOnly: privileges
          ? !/"(?:write|all|write-content)"/.test(JSON.stringify(privileges))
          : false,
      };
    });
}
export async function fetchRemoteCalendar(
  config,
  type,
  request = remoteRequest,
) {
  if (type === "ics") {
    const result = await request(config);
    if (result.status !== 200)
      throw new CalendarError(
        "Der Kalender konnte nicht vollständig geladen werden.",
        502,
      );
    return {
      etag: result.headers.etag || "",
      items: [
        { ics: result.body, href: config.url, etag: result.headers.etag || "" },
      ],
    };
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"/></c:filter></c:calendar-query>`;
  const result = await request(config, "REPORT", body, { Depth: "1" });
  if (result.status !== 207)
    throw new CalendarError(
      "Der Server unterstützt die CalDAV-Kalenderabfrage nicht.",
      502,
    );
  const entries = multistatus(result.body);
  if (
    entries.some(
      (entry) =>
        entry.failed || (entry.status && !/\s(?:200|404)\s/.test(entry.status)),
    )
  )
    throw new CalendarError(
      "Der Kalender konnte nicht vollständig synchronisiert werden.",
      502,
    );
  const items = entries
    .filter((entry) => entry.properties["calendar-data"] !== undefined)
    .map((entry) => {
      const ics = entry.properties["calendar-data"];
      if (typeof ics !== "string" || !entry.properties.getetag)
        throw new CalendarError(
          "Der Server liefert einen Termin ohne Inhalt oder Versionskennung.",
          502,
        );
      return {
        ics,
        etag: entry.properties.getetag,
        href: calendarHref(config.url, entry.href, true),
      };
    });
  return { items, etag: "" };
}
export async function putRemoteItem(
  config,
  { ics, href, etag, uid },
  request = remoteRequest,
) {
  const target = href
    ? calendarHref(config.url, href, true)
    : new URL(
        `${encodeURIComponent(uid)}.ics`,
        config.url.endsWith("/") ? config.url : `${config.url}/`,
      ).href;
  const response = await request(
    config,
    "PUT",
    ics,
    etag
      ? { "If-Match": etag, "Schedule-Reply": "F" }
      : { "If-None-Match": "*", "Schedule-Reply": "F" },
    target,
  );
  let version = response.headers.etag;
  if (!version)
    version = (await request(config, "GET", null, {}, target)).headers.etag;
  if (!version)
    throw new CalendarError(
      "Der Server hat keine neue Versionskennung geliefert. Bitte synchronisieren.",
      502,
    );
  return { href: target, etag: version };
}
export async function deleteRemoteItem(config, item, request = remoteRequest) {
  if (!item.etag)
    throw new CalendarError(
      "Die Versionskennung fehlt. Bitte zuerst synchronisieren.",
      409,
    );
  await request(
    config,
    "DELETE",
    null,
    { "If-Match": item.etag, "Schedule-Reply": "F" },
    calendarHref(config.url, item.href, true),
  );
}
export { multistatus, xmlEscape };

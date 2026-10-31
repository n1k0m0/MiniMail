import React, { useEffect, useState } from "react";
import { geoEqualEarth, geoGraticule10, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import world from "world-atlas/countries-110m.json";
import { LoaderCircle, X } from "lucide-react";
import { getLanguage, t } from "./i18n.js";
import { useModalFocus } from "./useModalFocus.js";

const projection = geoEqualEarth().fitExtent(
  [
    [20, 20],
    [940, 480],
  ],
  { type: "Sphere" },
);
const mapPath = geoPath(projection);
const countries = feature(world, world.objects.countries).features;
const graticule = mapPath(geoGraticule10());

function locationName(hop) {
  return (
    [hop.city, hop.country].filter(Boolean).join(", ") || t("Ort unbekannt")
  );
}

export default function MailTrace({ accountId, folder, uid, onClose }) {
  const dialog = useModalFocus(onClose);
  const [trace, setTrace] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/accounts/${accountId}/messages/${uid}/trace?folder=${encodeURIComponent(folder)}&lang=${getLanguage()}`,
      { credentials: "same-origin", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(t("Mail-Weg konnte nicht geladen werden."));
        return response.json();
      })
      .then(setTrace)
      .catch((cause) => {
        if (cause.name !== "AbortError") setError(cause.message);
      });
    return () => controller.abort();
  }, [accountId, folder, uid]);

  const located =
    trace?.hops.filter(
      (hop) => hop.latitude !== null && hop.longitude !== null,
    ) || [];
  const segments = located.slice(1).map((hop, index) => ({
    from: located[index],
    to: hop,
  }));

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal trace-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trace-title"
        ref={dialog}
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">MINIMAIL</div>
            <h2 id="trace-title">{t("Mail-Weg auf Karte")}</h2>
            <p>{t("Stationen aus den Received-Headern")}</p>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("Schließen")}
          >
            <X size={20} />
          </button>
        </div>
        <div className="trace-content">
          {error ? (
            <p className="trace-empty">{error}</p>
          ) : !trace ? (
            <div className="trace-loading">
              <LoaderCircle size={24} className="spin" />
              {t("Mail-Weg wird ermittelt …")}
            </div>
          ) : (
            <>
              <div className="trace-map">
                <svg
                  viewBox="0 0 960 500"
                  role="img"
                  aria-label={t("Karte der Mailserver")}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <defs>
                    <marker
                      id="trace-arrow"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="5"
                      markerHeight="5"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1 L 9 5 L 0 9 z" className="trace-arrow" />
                    </marker>
                  </defs>
                  <rect width="960" height="500" className="trace-ocean" />
                  <path d={graticule} className="trace-grid" />
                  {countries.map((country) => (
                    <path
                      key={country.id}
                      d={mapPath(country)}
                      className="trace-land"
                    />
                  ))}
                  {segments.map(({ from, to }, index) => (
                    <path
                      key={`${from.order}-${to.order}-${index}`}
                      d={mapPath({
                        type: "LineString",
                        coordinates: [
                          [from.longitude, from.latitude],
                          [to.longitude, to.latitude],
                        ],
                      })}
                      className="trace-route"
                      markerEnd="url(#trace-arrow)"
                    />
                  ))}
                  {located.map((hop) => {
                    const point = projection([hop.longitude, hop.latitude]);
                    if (!point) return null;
                    return (
                      <g
                        key={hop.order}
                        transform={`translate(${point[0]} ${point[1]})`}
                        className="trace-marker"
                      >
                        <circle r="13" className="trace-marker-halo" />
                        <circle r="9" className="trace-marker-dot" />
                        <text textAnchor="middle" dominantBaseline="central">
                          {hop.order}
                        </text>
                        <title>{`${hop.order}. ${hop.ip} · ${locationName(hop)}`}</title>
                      </g>
                    );
                  })}
                </svg>
              </div>
              {trace.hops.length ? (
                <ol className="trace-hops">
                  {trace.hops.map((hop) => (
                    <li key={hop.order}>
                      <span className="trace-hop-number">{hop.order}</span>
                      <div>
                        <strong>{locationName(hop)}</strong>
                        <code>{hop.ip}</code>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="trace-empty">
                  {t(
                    "Keine öffentlichen Server-IPs in den Mail-Headern gefunden.",
                  )}
                </p>
              )}
              {!trace.geoAvailable && (
                <p className="trace-empty">
                  {t(
                    "GeoIP-Datenbank nicht verfügbar; IPs werden ohne Karte angezeigt.",
                  )}
                </p>
              )}
              <div className="trace-footnote">
                <span>
                  {t(
                    "Standorte sind Schätzungen. Received-Header können gefälscht sein; Linien zeigen Mailstationen, nicht den tatsächlichen Netzwerkweg.",
                  )}
                </span>
                <a
                  href="https://db-ip.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  IP Geolocation by DB-IP
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

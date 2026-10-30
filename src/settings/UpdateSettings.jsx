import { useEffect, useState } from "react";
import { RefreshCw, ExternalLink } from "lucide-react";
import { api } from "../mailUi.js";
import { t } from "../i18n.js";
import SettingsRow from "./SettingsRow.jsx";

export default function UpdateSettings({ setError }) {
  const [info, setInfo] = useState(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api("/admin/system")
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function check() {
    setBusy(true);
    try {
      setInfo(await api("/admin/system/check-updates", { method: "POST" }));
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  const modes = {
    off: "Aus",
    notify: "Benachrichtigen",
    manual: "Manuell",
    auto: "Automatische Patch-Updates",
  };
  const available = info?.latest || info?.update?.available;
  const link = info?.releaseUrl || info?.update?.releaseUrl;
  return (
    <>
      <SettingsRow title="Installierte Version">
        <span className="settings-value">{info?.version || "…"}</span>
      </SettingsRow>
      <SettingsRow title="Datenbankschema">
        <span className="settings-value">{info?.schema ?? "…"}</span>
      </SettingsRow>
      <SettingsRow title="Update-Modus">
        <span className="settings-value">
          {t(modes[info?.update?.mode] || "Noch nicht eingerichtet")}
        </span>
      </SettingsRow>
      <SettingsRow title="Release-Kanal">
        <span className="settings-value">
          {info?.update?.channel === "preview" ? "Preview" : "Stable"}
        </span>
      </SettingsRow>
      <SettingsRow title="Lizenz">
        <span className="settings-value">Apache 2.0</span>
      </SettingsRow>
      <div className="settings-section-toolbar">
        <button className="primary-button" onClick={check} disabled={busy}>
          <RefreshCw size={15} className={busy ? "spin" : ""} />
          {t("Auf Updates prüfen")}
        </button>
        {link && available && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="secondary-button"
          >
            <ExternalLink size={15} />
            {t("Release ansehen")} {available}
          </a>
        )}
      </div>
      {info?.latest === null && (
        <p>{t("Für diesen Kanal ist noch kein Release veröffentlicht.")}</p>
      )}
      {info?.latest && !info.available && (
        <p>{t("Die installierte Version ist aktuell.")}</p>
      )}
      <p>
        {t(
          "Installation und Update-Modus werden mit dem MiniMail-Updater auf dem Server verwaltet.",
        )}
      </p>
    </>
  );
}

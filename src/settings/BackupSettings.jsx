import { useEffect, useState } from "react";
import { Download, Upload, DatabaseBackup } from "lucide-react";
import { api } from "../mailUi.js";
import { t } from "../i18n.js";

export default function BackupSettings({ setError }) {
  const [adminPassword, setAdminPassword] = useState(""),
    [code, setCode] = useState("");
  const [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState("");
  const [file, setFile] = useState(null),
    [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(""),
    [saved, setSaved] = useState([]);
  useEffect(() => {
    api("/admin/backups")
      .then(setSaved)
      .catch((error) => setError(error.message));
  }, []);
  async function responsePayload(response) {
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      throw new Error(t(value.error || `HTTP ${response.status}`));
    }
    return response;
  }
  async function run(action) {
    if (password.length < 12)
      return setError(
        t("Das Backup-Passwort muss mindestens 12 Zeichen lang sein."),
      );
    if (action === "export" && password !== repeat)
      return setError(t("Die Backup-Passwörter stimmen nicht überein."));
    if (
      action === "import" &&
      (!file || confirmation !== "ALLE DATEN ERSETZEN")
    )
      return;
    setBusy(action);
    try {
      const credentials = { adminPassword, code, backupPassword: password };
      if (action === "export") {
        const response = await responsePayload(
          await fetch("/api/admin/backups/export", {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
              "X-MiniMail-Request": "1",
            },
            body: JSON.stringify(credentials),
          }),
        );
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `minimail-${new Date().toISOString().slice(0, 10)}.minimail-backup.pgp`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const { ticket } = await api("/admin/backups/authorize-import", {
          method: "POST",
          body: { ...credentials, confirmation },
        });
        const response = await responsePayload(
          await fetch("/api/admin/backups/import", {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/octet-stream",
              "X-MiniMail-Request": "1",
              "X-MiniMail-Backup-Ticket": ticket,
            },
            body: file,
          }),
        );
        await response.json();
        window.location.reload();
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy("");
      setAdminPassword("");
      setCode("");
      setPassword("");
      setRepeat("");
    }
  }
  return (
    <div className="backup-settings">
      <p>
        {t(
          "Enthält alle Benutzer, Postfächer und Zugangsdaten, 2FA, Schlüssel, Kontakte, Entwürfe samt Anhängen, KI-Einstellungen sowie Kalender, Termine und Aufgaben.",
        )}
      </p>
      <p className="muted">
        {t(
          "E-Mails und Anhänge auf externen Mailservern, Serverdateien und lokale Browser-Einstellungen sind nicht enthalten. Für Serverdateien gibt es zusätzlich den Installations-Backup-Befehl.",
        )}
      </p>
      <div className="backup-fields">
        <label>
          {t("Dein Admin-Passwort")}
          <input
            type="password"
            autoComplete="current-password"
            value={adminPassword}
            onChange={(event) => setAdminPassword(event.target.value)}
            disabled={!!busy}
          />
        </label>
        <label>
          {t("Aktueller 2FA-Code")}
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            disabled={!!busy}
          />
        </label>
        <label>
          {t("Backup-Passwort (mindestens 12 Zeichen)")}
          <input
            type="password"
            autoComplete="new-password"
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={!!busy}
          />
        </label>
        <label>
          {t("Backup-Passwort wiederholen (Export)")}
          <input
            type="password"
            autoComplete="new-password"
            maxLength={1024}
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            disabled={!!busy}
          />
        </label>
      </div>
      <p className="muted">
        {t(
          "Bewahre das Backup-Passwort getrennt von der Datei auf. Ohne dieses Passwort ist keine Wiederherstellung möglich. Für jede Aktion wird ein neuer 2FA-Code benötigt.",
        )}
      </p>
      <button
        type="button"
        className="primary-button"
        disabled={!!busy || !adminPassword || code.length !== 6}
        onClick={() => run("export")}
      >
        <Download size={16} />
        {t(
          busy === "export"
            ? "Sicherung wird erstellt …"
            : "Verschlüsseltes Backup herunterladen",
        )}
      </button>
      <hr />
      <h4>{t("Alle Anwendungsdaten wiederherstellen")}</h4>
      <p>
        {t(
          "Der Import ersetzt die Daten aller Benutzer. Vorher wird automatisch ein Sicherheitsbackup mit dem eingegebenen Backup-Passwort auf dem Server gespeichert. Bei einem Fehler bleibt die bestehende Datenbank erhalten. Danach müssen sich alle neu anmelden; es gelten die Zugangsdaten aus dem Backup.",
        )}
      </p>
      <label>
        {t("Sicherungsdatei (maximal 512 MiB)")}
        <input
          type="file"
          accept=".pgp"
          disabled={!!busy}
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
      </label>
      <label>
        {t("Zur Bestätigung ALLE DATEN ERSETZEN eingeben")}
        <input
          value={confirmation}
          disabled={!!busy}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
        />
      </label>
      <button
        type="button"
        className="danger-button"
        disabled={
          !!busy ||
          !file ||
          file.size > 512 * 1024 * 1024 ||
          confirmation !== "ALLE DATEN ERSETZEN" ||
          !adminPassword ||
          code.length !== 6
        }
        onClick={() => run("import")}
      >
        <Upload size={16} />
        {t(
          busy === "import"
            ? "Wiederherstellung läuft …"
            : "Alle Daten wiederherstellen",
        )}
      </button>
      {saved.length > 0 && (
        <>
          <h4>
            <DatabaseBackup size={16} />{" "}
            {t("Sicherheitsbackups vor früheren Importen")}
          </h4>
          <ul>
            {saved.map((item) => (
              <li key={item.id}>
                <a href={`/api/admin/backups/${item.id}`} download>
                  {new Date(item.createdAt).toLocaleString()} ·{" "}
                  {(item.bytes / 1024 / 1024).toFixed(1)} MiB
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

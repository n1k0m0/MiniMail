import { useEffect, useState } from "react";
import { Download, DatabaseBackup, LoaderCircle } from "lucide-react";
import { api } from "../mailUi.js";
import { t } from "../i18n.js";

export default function InstallationBackupSettings({ setError }) {
  const [status, setStatus] = useState(null),
    [waiting, setWaiting] = useState(false),
    [reconnecting, setReconnecting] = useState(false);
  const [adminPassword, setAdminPassword] = useState(""),
    [code, setCode] = useState("");
  const [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState(""),
    [confirmPause, setConfirmPause] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true,
      pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api("/admin/installation-backups");
        if (!active) return;
        setStatus(result);
        setReconnecting(false);
        setWaiting(false);
      } catch {
        if (active) setReconnecting(true);
      } finally {
        pending = false;
      }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function create() {
    if (password !== repeat)
      return setError(t("Die Backup-Passwörter stimmen nicht überein."));
    setBusy(true);
    setWaiting(true);
    try {
      const id = crypto.randomUUID().replaceAll("-", "");
      await api("/admin/installation-backups", {
        method: "POST",
        body: {
          id,
          adminPassword,
          code,
          backupPassword: password,
          confirmPause,
        },
      });
    } catch (error) {
      // Stopping the app can interrupt the response; the host owns the job.
      // Polling recovers the status without submitting another password/job.
      setError(error.message);
      setWaiting(false);
    } finally {
      setAdminPassword("");
      setCode("");
      setPassword("");
      setRepeat("");
      setBusy(false);
    }
  }
  const running = status?.jobs?.some((job) => job.state === "running");
  return (
    <section className="installation-backup-settings">
      <hr />
      <h4>
        <DatabaseBackup size={18} /> {t("Vollständiges Serverbackup")}
      </h4>
      <p>
        {t(
          "Sichert zusätzlich die Serverkonfiguration, .env, lokale Dateien, VPN-Konfiguration und die verwendeten Docker-Images. Externe E-Mails bleiben auf den Mailservern.",
        )}
      </p>
      {!status?.configured ? (
        <p role="status">
          {t(
            reconnecting
              ? "Der Serverbackup-Dienst ist gerade nicht erreichbar. Der Status wird automatisch erneut geprüft."
              : "Einmalig auf dem Linux-Server aktivieren:",
          )}{" "}
          {!reconnecting && (
            <code>
              sudo .minimail/bin/minimail backup-service-install --root
              /pfad/zu/minimail
            </code>
          )}
        </p>
      ) : (
        <>
          <div className="backup-fields">
            <label>
              {t("Dein Admin-Passwort")}
              <input
                type="password"
                autoComplete="current-password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                disabled={busy || running}
              />
            </label>
            <label>
              {t("Aktueller 2FA-Code")}
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                disabled={busy || running}
              />
            </label>
            <label>
              {t("Backup-Passwort (mindestens 12 Zeichen)")}
              <input
                type="password"
                autoComplete="new-password"
                maxLength={1024}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy || running}
              />
            </label>
            <label>
              {t("Backup-Passwort wiederholen (Export)")}
              <input
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                disabled={busy || running}
              />
            </label>
          </div>
          <label>
            <input
              type="checkbox"
              checked={confirmPause}
              onChange={(e) => setConfirmPause(e.target.checked)}
              disabled={busy || running}
            />
            {t(
              "Kurze Unterbrechung von MiniMail für ein konsistentes Serverbackup erlauben.",
            )}
          </label>
          <p className="muted">
            {t(
              "Die passwortverschlüsselte Datei steht 24 Stunden in dieser Admin-Sitzung zum Download bereit. Bewahre das Passwort getrennt auf. Die vollständige Wiederherstellung erfolgt über den Serverbefehl backup-import in eine leere Installation.",
            )}
          </p>
          <button
            type="button"
            className="primary-button"
            disabled={
              busy ||
              running ||
              !adminPassword ||
              code.length !== 6 ||
              password.length < 12 ||
              password !== repeat ||
              !confirmPause ||
              status.jobs?.length >= 3
            }
            onClick={create}
          >
            <DatabaseBackup size={16} />
            {t("Serverbackup erstellen")}
          </button>
        </>
      )}
      {(running || waiting || reconnecting) && (
        <p role="status">
          <LoaderCircle className="spin" size={16} />
          {t(
            running
              ? "Serversicherung läuft. MiniMail ist während der Datenprüfung kurz nicht erreichbar; die Sicherung läuft unabhängig weiter."
              : reconnecting
                ? "Verbindung wird wiederhergestellt …"
                : "Status der Serversicherung wird geprüft …",
          )}
        </p>
      )}
      <ul>
        {[...(status?.jobs || [])]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((job) => (
            <li key={job.id}>
              {new Date(job.createdAt).toLocaleString()} ·{" "}
              {t(
                job.state === "ready"
                  ? "Bereit"
                  : job.state === "running"
                    ? "Wird erstellt …"
                    : "Fehlgeschlagen",
              )}
              {job.state === "ready" && (
                <>
                  {" "}
                  · {(job.bytes / 1024 / 1024).toFixed(1)} MiB ·{" "}
                  <a
                    href={`/api/admin/installation-backups/${job.id}/download`}
                    download
                  >
                    <Download size={14} />
                    {t("Serverbackup herunterladen")}
                  </a>
                </>
              )}
              {job.state === "failed" && (
                <p>
                  {t(
                    "Die Serversicherung wurde abgebrochen. Es wird keine unvollständige Datei angeboten. Bitte Serverprotokoll und freien Speicherplatz prüfen.",
                  )}
                </p>
              )}
            </li>
          ))}
      </ul>
    </section>
  );
}

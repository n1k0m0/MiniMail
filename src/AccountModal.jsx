import { useState, useEffect } from "react";
import {
  Check,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  Mail,
  PenLine,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { api } from "./mailUi.js";
import { t } from "./i18n.js";

export default function AccountModal({ account, onClose, onSaved, setError }) {
  const [form, setForm] = useState(
    account ? { ...account, password: "", smtp_password: "" } : blankAccount,
  );
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);
  const [vpnProfiles, setVpnProfiles] = useState([]);
  useEffect(() => {
    let active = true;
    api("/vpn-profiles")
      .then((profiles) => {
        if (active) setVpnProfiles(profiles);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);
  function field(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setTested(false);
  }
  async function test() {
    setBusy(true);
    try {
      await api("/accounts/test", {
        method: "POST",
        body: { ...form, id: account?.id },
      });
      setTested(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api(
        account ? `/accounts/${account.id}` : "/accounts",
        { method: account ? "PUT" : "POST", body: form },
      );
      onSaved(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal account-modal">
        <div className="modal-header">
          <div>
            <div className="eyebrow">{t("POSTFACH-EINSTELLUNGEN")}</div>
            <h2>
              {account ? t("Postfach bearbeiten") : t("Postfach verbinden")}
            </h2>
            <p>
              {t("Deine Zugangsdaten bleiben verschlüsselt auf deinem Server.")}
            </p>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={save}>
          <div className="modal-scroll">
            <div className="form-grid">
              <label>
                {t("\n                Anzeigename\n                ")}
                <input
                  required
                  value={form.name}
                  onChange={(e) => field("name", e.target.value)}
                  placeholder={t("Mein Postfach")}
                />
              </label>
              <label>
                {t("\n                E-Mail-Adresse\n                ")}
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => field("email", e.target.value)}
                  placeholder={t("name@beispiel.de")}
                />
              </label>
            </div>
            <div className="form-section">
              <div className="form-section-title">
                <PenLine size={18} />
                {t("Absender und Signatur")}
              </div>
              <label>
                {t("Absendername")}
                <input
                  value={form.sender_name || ""}
                  onChange={(event) => field("sender_name", event.target.value)}
                  placeholder={form.name || t("Mein Postfach")}
                  maxLength={256}
                />
              </label>
              <label className="signature-field">
                {t("Automatische Signatur")}
                <textarea
                  value={form.signature || ""}
                  onChange={(event) => field("signature", event.target.value)}
                  placeholder={t("Keine Signatur")}
                  maxLength={10000}
                  rows={6}
                />
              </label>
              <p className="field-hint">
                {t(
                  "Die Signatur wird beim Schreiben automatisch an die Nachricht angehängt.",
                )}
              </p>
            </div>
            <div className="form-section">
              <div className="form-section-title">
                <Inbox size={18} />
                {t(" Eingangsserver ")}
                <span>{t("IMAP")}</span>
              </div>
              <div className="form-grid host-grid">
                <label>
                  {t("\n                  Server\n                  ")}
                  <input
                    required
                    value={form.imap_host}
                    onChange={(e) => field("imap_host", e.target.value)}
                    placeholder={t("imap.beispiel.de")}
                  />
                </label>
                <label>
                  {t("\n                  Port\n                  ")}
                  <input
                    required
                    type="number"
                    min="1"
                    max="65535"
                    value={form.imap_port}
                    onChange={(e) => field("imap_port", Number(e.target.value))}
                  />
                </label>
              </div>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={form.imap_secure}
                  onChange={(e) => {
                    setForm((current) => ({
                      ...current,
                      imap_secure: e.target.checked,
                      imap_port: e.target.checked ? 993 : 143,
                    }));
                    setTested(false);
                  }}
                />{" "}
                {t("\n                Direktes TLS")}{" "}
                <small>
                  (
                  {form.imap_secure
                    ? `Port ${form.imap_port}: TLS ab Verbindungsbeginn`
                    : `Port ${form.imap_port}: STARTTLS verpflichtend`}
                  )
                </small>
              </label>
            </div>
            <div className="form-section">
              <div className="form-section-title">
                <Send size={18} />
                {t(" Ausgangsserver ")}
                <span>{t("SMTP")}</span>
              </div>
              <div className="form-grid host-grid">
                <label>
                  {t("\n                  Server\n                  ")}
                  <input
                    required
                    value={form.smtp_host}
                    onChange={(e) => field("smtp_host", e.target.value)}
                    placeholder={t("smtp.beispiel.de")}
                  />
                </label>
                <label>
                  {t("\n                  Port\n                  ")}
                  <input
                    required
                    type="number"
                    min="1"
                    max="65535"
                    value={form.smtp_port}
                    onChange={(e) => field("smtp_port", Number(e.target.value))}
                  />
                </label>
              </div>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={form.smtp_secure}
                  onChange={(e) => {
                    field("smtp_secure", e.target.checked);
                    field("smtp_port", e.target.checked ? 465 : 587);
                  }}
                />{" "}
                {t("\n                Direktes TLS")}{" "}
                <small>
                  (
                  {form.smtp_secure
                    ? `Port ${form.smtp_port}: TLS ab Verbindungsbeginn`
                    : `Port ${form.smtp_port}: STARTTLS verpflichtend`}
                  )
                </small>
              </label>
              <div className="form-grid">
                <label>
                  {t("\n                  SMTP-Benutzername ")}
                  <small>{t("(optional)")}</small>
                  <input
                    value={form.smtp_username || ""}
                    onChange={(e) => field("smtp_username", e.target.value)}
                    placeholder={t("Wie bei IMAP")}
                  />
                </label>
                <label>
                  {t("\n                  SMTP-Passwort ")}
                  <small>{t("(optional)")}</small>
                  <input
                    type="password"
                    value={form.smtp_password || ""}
                    onChange={(e) => field("smtp_password", e.target.value)}
                    placeholder={
                      account ? t("Unverändert lassen") : t("Wie bei IMAP")
                    }
                  />
                </label>
              </div>
            </div>
            {(vpnProfiles.length > 0 || form.vpn_profile) && (
              <div className="form-section">
                <div className="form-section-title">
                  <ShieldCheck size={18} />
                  {t("VPN-Verbindung")}
                </div>
                <label className="interval-field">
                  {t("Verbindung für dieses Postfach")}
                  <select
                    value={form.vpn_profile || ""}
                    onChange={(event) =>
                      field("vpn_profile", event.target.value)
                    }
                  >
                    <option value="">{t("Direkt (ohne VPN)")}</option>
                    {vpnProfiles.map((profile) => (
                      <option value={profile.id} key={profile.id}>
                        {profile.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="field-hint">
                  {t(
                    "IMAP und SMTP dieses Postfachs verwenden die ausgewählte Server-VPN-Verbindung.",
                  )}
                </p>
              </div>
            )}
            <div className="form-section credentials">
              <div className="form-section-title">
                <LockKeyhole size={18} />
                {t(" Anmeldung\n              ")}
              </div>
              <div className="form-grid">
                <label>
                  {t("\n                  Benutzername\n                  ")}
                  <input
                    required
                    value={form.username}
                    onChange={(e) => field("username", e.target.value)}
                    placeholder={t("name@beispiel.de")}
                  />
                </label>
                <label>
                  {t(
                    "\n                  Passwort / App-Passwort\n                  ",
                  )}
                  <input
                    required={!account || account.needsCredentials}
                    type="password"
                    value={form.password}
                    onChange={(e) => field("password", e.target.value)}
                    placeholder={
                      account ? t("Unverändert lassen") : t("Postfach-Passwort")
                    }
                  />
                </label>
              </div>
              <p>
                {t(
                  "\n                Bei Providern mit 2FA benötigst du meistens ein App-Passwort für\n                IMAP/SMTP.\n              ",
                )}
              </p>
            </div>
            <div className="form-section">
              <div className="form-section-title">
                <RefreshCw size={18} />
                {t(" Automatischer Abruf\n              ")}
              </div>
              <label className="interval-field">
                {t(
                  "\n                Alle wie viele Minuten prüfen?\n                ",
                )}
                <input
                  type="number"
                  min="0"
                  max="1440"
                  step="1"
                  required
                  value={form.check_interval_minutes ?? 5}
                  onChange={(e) =>
                    field("check_interval_minutes", Number(e.target.value))
                  }
                />
              </label>
              <p className="field-hint">
                {t(
                  "\n                Standard: 5 Minuten. Mit 0 ist der automatische Abruf für dieses\n                Postfach aus.\n              ",
                )}
              </p>
            </div>
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="secondary-button"
              onClick={test}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : tested ? (
                <Check size={16} />
              ) : (
                <RefreshCw size={16} />
              )}{" "}
              {tested ? t("Verbindung erfolgreich") : t("Verbindung testen")}
            </button>
            <div>
              <button type="button" className="text-button" onClick={onClose}>
                {t("\n                Abbrechen\n              ")}
              </button>
              <button className="primary-button" disabled={busy}>
                {account ? t("Speichern") : t("Postfach hinzufügen")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

const blankAccount = {
  name: "",
  email: "",
  imap_host: "",
  imap_port: 993,
  imap_secure: true,
  smtp_host: "",
  smtp_port: 465,
  smtp_secure: true,
  smtp_username: "",
  smtp_password: "",
  username: "",
  password: "",
  sender_name: "",
  signature: "",
  vpn_profile: "",
  check_interval_minutes: 5,
};

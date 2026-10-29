import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldOff,
} from "lucide-react";
import { choose, t } from "./i18n.js";

export default function UserManagement({
  request,
  currentUsername,
  setError,
  showHeading = true,
}) {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState("");
  const [temporary, setTemporary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  async function reload() {
    setLoading(true);
    try {
      setUsers(await request("/admin/users"));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    reload();
  }, []);
  async function create(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await request("/admin/users", {
        method: "POST",
        body: { username },
      });
      setTemporary({
        username: result.user.username,
        password: result.temporaryPassword,
      });
      setUsername("");
      setCopied(false);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function resetPassword(user) {
    if (
      !window.confirm(
        choose(
          `Passwort für „${user.username}“ zurücksetzen? Die Person wird sofort abgemeldet.`,
          `Reset the password for “${user.username}”? This will sign them out immediately.`,
        ),
      )
    )
      return;
    setBusy(true);
    try {
      const result = await request(`/admin/users/${user.id}/reset-password`, {
        method: "POST",
      });
      setTemporary({
        username: user.username,
        password: result.temporaryPassword,
      });
      setCopied(false);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function resetTwoFactor(user) {
    if (
      !window.confirm(
        choose(
          `2FA für „${user.username}“ zurücksetzen? Die Person wird sofort abgemeldet und muss 2FA erneut einrichten.`,
          `Reset 2FA for “${user.username}”? This will sign them out immediately and require them to set up 2FA again.`,
        ),
      )
    )
      return;
    setBusy(true);
    try {
      await request(`/admin/users/${user.id}/reset-2fa`, { method: "POST" });
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(temporary.password);
      setCopied(true);
    } catch {
      setError(
        t("Kopieren nicht möglich. Bitte das Passwort manuell markieren."),
      );
    }
  }
  return (
    <section className="user-management">
      {showHeading && <h3>{t("Benutzerverwaltung")}</h3>}
      <p>
        {t(
          "\n        Nur Admins können Benutzerkonten anlegen. Jeder Benutzer verwaltet\n        eigene Postfächer.\n      ",
        )}
      </p>
      <form className="new-user-form" onSubmit={create}>
        <label>
          {t("\n          Neuer Benutzername\n          ")}
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            pattern="[a-zA-Z0-9_.-]{3,40}"
            title={t(
              "3–40 Zeichen: Buchstaben, Zahlen, Punkt, Unterstrich oder Bindestrich",
            )}
            required
          />
        </label>
        <button className="primary-button" disabled={busy}>
          <Plus size={16} />
          {t(" Anlegen\n        ")}
        </button>
      </form>
      {temporary && (
        <div className="temporary-password" role="status">
          <strong>
            {t("Einmaliges Startpasswort für ")}
            {temporary.username}
          </strong>
          <p>
            {t(
              "\n            Jetzt sicher an die Person weitergeben. Es wird danach nicht erneut\n            angezeigt. Beim ersten Login muss sie es ändern und 2FA einrichten.\n          ",
            )}
          </p>
          <div>
            <code>{temporary.password}</code>
            <button onClick={copyPassword} title={t("Passwort kopieren")}>
              {copied ? <Check size={17} /> : <Copy size={17} />}
            </button>
          </div>
        </div>
      )}
      <div className="user-list" aria-busy={loading}>
        {loading && (
          <p className="settings-loading">
            <LoaderCircle size={17} className="spin" />
            {t("Benutzer werden geladen …")}
          </p>
        )}
        {users.map((user) => (
          <div className="user-row" key={user.id}>
            <div className="account-badge">
              {user.username[0].toUpperCase()}
            </div>
            <div className="user-info">
              <strong>
                {user.username}
                {user.username === currentUsername ? t(" (du)") : ""}
              </strong>
              <span>
                {user.role === "admin" ? "Admin" : t("Benutzer")} ·{" "}
                {user.mustChangePassword
                  ? t("Passwortwechsel ausstehend")
                  : user.twoFactorEnabled
                    ? t("2FA aktiv")
                    : t("2FA noch nicht eingerichtet")}
              </span>
            </div>
            {user.username !== currentUsername && (
              <div className="user-actions">
                <button
                  disabled={busy}
                  onClick={() => resetPassword(user)}
                  title={t("Passwort zurücksetzen")}
                >
                  <KeyRound size={16} />
                </button>
                <button
                  disabled={busy || !user.twoFactorEnabled}
                  onClick={() => resetTwoFactor(user)}
                  title={t("2FA zurücksetzen")}
                >
                  <ShieldOff size={16} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldOff,
} from "lucide-react";

export default function UserManagement({ request, currentUsername, setError }) {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState("");
  const [temporary, setTemporary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function reload() {
    try {
      setUsers(await request("/admin/users"));
    } catch (err) {
      setError(err.message);
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
        `Passwort für „${user.username}“ zurücksetzen? Die Person wird sofort abgemeldet.`,
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
        `2FA für „${user.username}“ zurücksetzen? Die Person wird sofort abgemeldet und muss 2FA erneut einrichten.`,
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
      setError("Kopieren nicht möglich. Bitte das Passwort manuell markieren.");
    }
  }
  return (
    <section className="user-management">
      <h3>Benutzerverwaltung</h3>
      <p>
        Nur Admins können Benutzerkonten anlegen. Jeder Benutzer verwaltet
        eigene Postfächer.
      </p>
      <form className="new-user-form" onSubmit={create}>
        <label>
          Neuer Benutzername
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            pattern="[a-zA-Z0-9_.-]{3,40}"
            title="3–40 Zeichen: Buchstaben, Zahlen, Punkt, Unterstrich oder Bindestrich"
            required
          />
        </label>
        <button className="primary-button" disabled={busy}>
          <Plus size={16} /> Anlegen
        </button>
      </form>
      {temporary && (
        <div className="temporary-password" role="status">
          <strong>Einmaliges Startpasswort für {temporary.username}</strong>
          <p>
            Jetzt sicher an die Person weitergeben. Es wird danach nicht erneut
            angezeigt. Beim ersten Login muss sie es ändern und 2FA einrichten.
          </p>
          <div>
            <code>{temporary.password}</code>
            <button onClick={copyPassword} title="Passwort kopieren">
              {copied ? <Check size={17} /> : <Copy size={17} />}
            </button>
          </div>
        </div>
      )}
      <div className="user-list">
        {users.map((user) => (
          <div className="user-row" key={user.id}>
            <div className="account-badge">
              {user.username[0].toUpperCase()}
            </div>
            <div className="user-info">
              <strong>
                {user.username}
                {user.username === currentUsername ? " (du)" : ""}
              </strong>
              <span>
                {user.role === "admin" ? "Admin" : "Benutzer"} ·{" "}
                {user.mustChangePassword
                  ? "Passwortwechsel ausstehend"
                  : user.twoFactorEnabled
                    ? "2FA aktiv"
                    : "2FA noch nicht eingerichtet"}
              </span>
            </div>
            {user.username !== currentUsername && (
              <div className="user-actions">
                <button
                  disabled={busy}
                  onClick={() => resetPassword(user)}
                  title="Passwort zurücksetzen"
                >
                  <KeyRound size={16} />
                </button>
                <button
                  disabled={busy || !user.twoFactorEnabled}
                  onClick={() => resetTwoFactor(user)}
                  title="2FA zurücksetzen"
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

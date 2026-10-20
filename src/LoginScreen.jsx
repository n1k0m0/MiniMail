import { useEffect, useState } from "react";
import {
  ArrowRight,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { t } from "./i18n.js";

export default function LoginScreen({
  auth,
  onDone,
  request,
  theme,
  setTheme,
  language,
  onLanguageChange,
  error,
  setError,
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);
  const changePassword = !!auth.user?.mustChangePassword;
  const setUpTwoFactor =
    !!auth.user && !changePassword && !auth.user.twoFactorEnabled;

  useEffect(() => {
    if (!setUpTwoFactor || qr) return;
    request("/auth/2fa/start", { method: "POST" })
      .then(setQr)
      .catch((err) => setError(err.message));
  }, [setUpTwoFactor, qr, request, setError]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (changePassword) {
        if (newPassword !== confirmation)
          throw new Error(t("Die neuen Passwörter stimmen nicht überein."));
        await request("/auth/change-password", {
          method: "POST",
          body: { currentPassword: password, newPassword },
        });
      } else if (setUpTwoFactor) {
        await request("/auth/2fa/verify", { method: "POST", body: { code } });
      } else {
        await request("/auth/login", {
          method: "POST",
          body: { username, password, code },
        });
      }
      await onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <header className="login-header">
        <div className="login-brand">
          <span className="login-mark">
            <Mail size={19} />
          </span>
          {t("\n          MiniMail\n        ")}
        </div>
        <select
          className="language-select login-language"
          aria-label="Language / Sprache"
          value={language}
          onChange={(event) => onLanguageChange(event.target.value)}
        >
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
        <button
          className="auth-theme"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          title={t("Design wechseln")}
        >
          {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </header>
      <main className="login-card">
        <div className="auth-symbol">
          {setUpTwoFactor ? (
            <ShieldCheck size={24} />
          ) : (
            <LockKeyhole size={24} />
          )}
        </div>
        <h1>
          {changePassword
            ? t("Passwort ändern")
            : setUpTwoFactor
              ? t("2FA einrichten")
              : t("Anmelden")}
        </h1>
        <p className="auth-description">
          {changePassword
            ? t("Lege für deinen neuen Zugang ein eigenes Passwort fest.")
            : setUpTwoFactor
              ? t(
                  "Scanne den QR-Code mit deiner Authenticator-App und bestätige den angezeigten Code.",
                )
              : t("Melde dich mit deinem Benutzerkonto an.")}
        </p>
        {auth.adminSetupRequired && (
          <div className="setup-hint">
            <strong>{t("Admin-Zugang noch nicht eingerichtet.")}</strong>
            <span>{t("Lege ihn auf dem Server im Terminal an:")}</span>
            <code>{t("npm run admin:create -- admin")}</code>
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {!auth.adminSetupRequired && (
          <form onSubmit={submit}>
            {setUpTwoFactor ? (
              <>
                <div className="qr-wrap">
                  {qr ? (
                    <img src={qr.qr} alt={t("QR-Code für Authenticator-App")} />
                  ) : (
                    <LoaderCircle className="spin" />
                  )}
                </div>
                <div className="secret-line">
                  {t("\n                  Schlüssel: ")}
                  <code>{qr?.secret || "…"}</code>
                </div>
                <label>
                  {t(
                    "\n                  Bestätigungscode\n                  ",
                  )}
                  <input
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={t("000000")}
                    required
                  />
                </label>
              </>
            ) : changePassword ? (
              <>
                <label>
                  {t(
                    "\n                  Aktuelles Passwort\n                  ",
                  )}
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
                <label>
                  {t("\n                  Neues Passwort\n                  ")}
                  <input
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    placeholder={t("Mindestens 12 Zeichen")}
                    required
                  />
                </label>
                <label>
                  {t(
                    "\n                  Neues Passwort wiederholen\n                  ",
                  )}
                  <input
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  {t("\n                  Benutzername\n                  ")}
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </label>
                <label>
                  {t("\n                  Passwort\n                  ")}
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
                <label>
                  {t("\n                  2FA-Code ")}
                  <small>{t("(falls bereits eingerichtet)")}</small>
                  <input
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={t("000000")}
                  />
                </label>
              </>
            )}
            <button className="primary-button auth-submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : changePassword ? (
                t("Passwort speichern")
              ) : setUpTwoFactor ? (
                t("2FA aktivieren")
              ) : (
                t("Anmelden")
              )}
              <ArrowRight size={17} />
            </button>
          </form>
        )}
        {auth.user && (
          <button
            className="login-logout"
            onClick={async () => {
              await request("/auth/logout", { method: "POST" });
              await onDone();
            }}
          >
            {t("\n            Anderen Benutzer anmelden\n          ")}
          </button>
        )}
      </main>
    </div>
  );
}

import { LogOut, ShieldCheck } from "lucide-react";
import { t } from "../i18n.js";
import SettingsRow from "./SettingsRow.jsx";

export default function SecuritySettings({ auth, onLogout }) {
  return (
    <>
      <SettingsRow title="Angemeldet als">
        <span className="settings-value">{auth.user.username}</span>
      </SettingsRow>
      <SettingsRow
        title="Zwei-Faktor-Anmeldung"
        description="Die Zwei-Faktor-Anmeldung ist für MiniMail verpflichtend."
      >
        <span className="settings-status">
          <ShieldCheck size={17} />
          {auth.user.twoFactorEnabled
            ? t("Aktiviert")
            : t("Noch nicht eingerichtet")}
        </span>
      </SettingsRow>
      <div className="settings-permissions">
        <h4>{t("Wer kann was sehen?")}</h4>
        <p>
          {t(
            "Benutzer sehen ihre eigenen Postfächer, Kontakte und Entwürfe. Administratoren verwalten zusätzlich Benutzer und gemeinsame KI-Einstellungen.",
          )}
        </p>
        <p>
          {t(
            "Administratoren können Passwörter und 2FA zurücksetzen sowie die gespeicherten Anwendungsdaten aller Benutzer sichern und wiederherstellen. Personen mit direktem Serverzugriff können technisch auf gespeicherte Daten zugreifen.",
          )}
        </p>
      </div>
      <button type="button" className="logout-button" onClick={onLogout}>
        <LogOut size={16} />
        {t("Abmelden")}
      </button>
    </>
  );
}

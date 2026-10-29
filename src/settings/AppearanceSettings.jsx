import { Monitor, Moon, Sun } from "lucide-react";
import { t } from "../i18n.js";
import SettingsRow from "./SettingsRow.jsx";

export default function AppearanceSettings({
  theme = "light",
  setTheme,
  language = "de",
  onLanguageChange,
  threaded = false,
  onThreadedChange,
  hideRead = false,
  onHideReadChange,
}) {
  return (
    <>
      <h4 className="settings-section-title">{t("Oberfläche")}</h4>
      <SettingsRow
        title="Farbschema"
        description="Wähle deinen bevorzugten Modus."
      >
        <button
          type="button"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        >
          {theme === "light" ? <Sun size={17} /> : <Moon size={17} />}
          {theme === "light" ? t("Hell") : t("Dunkel")}
        </button>
      </SettingsRow>
      <SettingsRow
        title="Sprache"
        description="Wähle die Sprache der Oberfläche."
      >
        <select
          className="language-select"
          aria-label={t("Sprache")}
          value={language}
          onChange={(event) => onLanguageChange(event.target.value)}
        >
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </SettingsRow>
      <h4 className="settings-section-title">{t("Nachrichten lesen")}</h4>
      <SettingsRow
        title="Konversationsansicht"
        description="Zusammengehörige E-Mails als aufklappbare Kette anzeigen."
      >
        <button
          type="button"
          aria-label={t("Konversationsansicht")}
          aria-pressed={threaded}
          onClick={() => onThreadedChange(!threaded)}
        >
          {threaded ? t("Ein") : t("Aus")}
        </button>
      </SettingsRow>
      <SettingsRow
        title="Gelesene E-Mails ausblenden"
        description="Nur ungelesene E-Mails anzeigen. Gilt für alle Postfächer in diesem Browser."
      >
        <button
          type="button"
          aria-label={t("Gelesene E-Mails ausblenden")}
          aria-pressed={hideRead}
          onClick={() => onHideReadChange(!hideRead)}
        >
          {hideRead ? t("Ein") : t("Aus")}
        </button>
      </SettingsRow>
      <div className="settings-note">
        <Monitor size={17} />
        <p>
          {t(
            "Design, Sprache und Konversationsansicht werden in diesem Browser gespeichert. Der Filter für gelesene E-Mails wird zusätzlich je Benutzer gespeichert.",
          )}
        </p>
      </div>
    </>
  );
}

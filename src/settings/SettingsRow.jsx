import { t } from "../i18n.js";
export default function SettingsRow({ title, description, children }) {
  return (
    <div className="settings-row">
      <div>
        <strong>{t(title)}</strong>
        {description && <span>{t(description)}</span>}
      </div>
      {children}
    </div>
  );
}

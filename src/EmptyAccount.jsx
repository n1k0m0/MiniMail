import { Mail, Plus } from "lucide-react";
import { t } from "./i18n.js";

export default function EmptyAccount({ onAdd }) {
  return (
    <div className="empty-account">
      <div className="empty-account-art">
        <div className="large-envelope">
          <Mail size={64} strokeWidth={1.25} />
        </div>
        <div className="art-orb a" />
        <div className="art-orb b" />
      </div>
      <h1>{t("Noch kein Postfach verbunden")}</h1>
      <p>
        {t("Füge die IMAP- und SMTP-Zugangsdaten deines Mailservers hinzu.")}
      </p>
      <button className="primary-button" onClick={onAdd}>
        <Plus size={19} />
        {t(" Postfach hinzufügen\n      ")}
      </button>
    </div>
  );
}

import { useState } from "react";
import { Contact, LockKeyhole } from "lucide-react";
import { t } from "../i18n.js";
import SettingsRow from "./SettingsRow.jsx";

export default function ContactSettings({
  auth,
  onOpenContacts,
  onCollectRecipientsChange,
  setError,
}) {
  const [collectBusy, setCollectBusy] = useState(false);
  async function toggleCollection() {
    if (collectBusy) return;
    setCollectBusy(true);
    try {
      await onCollectRecipientsChange(!auth.user.collectRecipients);
    } catch (err) {
      setError(err.message);
    } finally {
      setCollectBusy(false);
    }
  }
  return (
    <>
      <SettingsRow
        title="Kontakte verwalten"
        description="Adressen suchen, hinzufügen und bearbeiten."
      >
        <button type="button" onClick={onOpenContacts}>
          <Contact size={16} />
          {t("Adressbuch öffnen")}
        </button>
      </SettingsRow>
      <SettingsRow
        title="Gesendete Empfänger automatisch merken"
        description="Neue Adressen nach erfolgreichem Senden im Adressbuch speichern."
      >
        <button
          type="button"
          aria-label={t("Gesendete Empfänger automatisch merken")}
          aria-pressed={!!auth.user.collectRecipients}
          disabled={collectBusy}
          onClick={toggleCollection}
        >
          {auth.user.collectRecipients ? t("Ein") : t("Aus")}
        </button>
      </SettingsRow>
      <div className="settings-note">
        <LockKeyhole size={17} />
        <p>
          {t(
            "Dein Adressbuch und diese Einstellung gehören zu deinem Benutzerkonto und gelten auch auf anderen Geräten.",
          )}
        </p>
      </div>
    </>
  );
}

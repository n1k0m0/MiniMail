import { useEffect, useState } from "react";
import { FileText, LoaderCircle, Trash2, X } from "lucide-react";
import { api } from "./mailUi.js";
import { t, dateLocale } from "./i18n.js";

export default function DraftsModal({ onOpen, onClose, setError }) {
  const [drafts, setDrafts] = useState([]);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    api("/drafts", { signal: controller.signal })
      .then(setDrafts)
      .catch((error) => {
        if (error.name !== "AbortError") setError(error.message);
      })
      .finally(() => setBusy(false));
    return () => controller.abort();
  }, [setError]);
  async function open(id) {
    setBusy(true);
    try {
      onOpen(await api(`/drafts/${id}`));
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id) {
    if (!window.confirm(t("Entwurf endgültig löschen?"))) return;
    setBusy(true);
    try {
      await api(`/drafts/${id}`, { method: "DELETE" });
      setDrafts((current) => current.filter((draft) => draft.id !== id));
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drafts-title"
      >
        <div className="modal-header">
          <h2 id="drafts-title">{t("Gespeicherte Entwürfe")}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("Schließen")}
          >
            <X size={20} />
          </button>
        </div>
        <div className="settings-body">
          {busy && (
            <LoaderCircle
              className="spin"
              aria-label={t("Lade Nachrichten …")}
            />
          )}
          {!busy && !drafts.length && (
            <p>{t("Keine gespeicherten Entwürfe.")}</p>
          )}
          {drafts.map((draft) => (
            <div className="settings-row" key={draft.id}>
              <div>
                <strong>{draft.subject || t("(Kein Betreff)")}</strong>
                <span>{draft.to}</span>
                <span>
                  {new Date(draft.updatedAt).toLocaleString(dateLocale())}
                </span>
              </div>
              <button disabled={busy} onClick={() => open(draft.id)}>
                <FileText size={16} /> {t("Öffnen")}
              </button>
              <button
                className="danger-icon"
                disabled={busy}
                onClick={() => remove(draft.id)}
                aria-label={t("Löschen")}
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

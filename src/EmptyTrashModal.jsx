import { useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { t } from "./i18n.js";
import { useModalFocus } from "./useModalFocus.js";

export default function EmptyTrashModal({ path, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const dialog = useModalFocus(() => {
    if (!busy) onClose();
  });
  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
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
        className="modal confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="empty-trash-title"
        ref={dialog}
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">{t("PAPIERKORB")}</div>
            <h2 id="empty-trash-title">{t("Papierkorb leeren?")}</h2>
          </div>
        </div>
        <p className="confirm-copy">
          {t("\n          Alle Nachrichten in ")}
          <strong>{path}</strong>
          {t(
            " werden dauerhaft gelöscht.\n          Das lässt sich nicht rückgängig machen.\n        ",
          )}
        </p>
        <div className="modal-footer">
          <div>
            <button
              className="text-button"
              onClick={onClose}
              disabled={busy}
              autoFocus
            >
              {t("\n              Abbrechen\n            ")}
            </button>
            <button className="danger-button" onClick={confirm} disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Trash2 size={16} />
              )}
              {t("\n              Dauerhaft löschen\n            ")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

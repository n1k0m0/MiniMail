import { useState } from "react";
import { LoaderCircle, Sparkles, X } from "lucide-react";
import { api } from "./mailUi.js";
import { t, getLanguage } from "./i18n.js";
import { useModalFocus } from "./useModalFocus.js";

export default function AiSummaryModal({ accountId, folder, uid, onClose }) {
  const dialog = useModalFocus(onClose);
  const [summary, setSummary] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function summarize() {
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/accounts/${accountId}/messages/${uid}/summary`,
        {
          method: "POST",
          body: { folder, language: getLanguage() },
        },
      );
      setSummary(result.text);
      setTruncated(result.truncated);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="modal ai-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-summary-title"
        ref={dialog}
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">MINIMAIL AI</div>
            <h2 id="ai-summary-title">{t("KI-Zusammenfassung")}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("Schließen")}
          >
            <X size={20} />
          </button>
        </div>
        <div className="ai-modal-content">
          <p className="ai-disclosure">
            {t(
              "Beim Zusammenfassen wird der lesbare Nachrichtentext an deinen KI-Server gesendet. Anhänge werden nicht übertragen.",
            )}
          </p>
          {error && (
            <p className="ai-error" role="alert">
              {error}
            </p>
          )}
          {summary && (
            <div className="ai-result" aria-live="polite">
              {summary}
            </div>
          )}
          {truncated && (
            <p className="ai-disclosure">
              {t(
                "Die Nachricht war sehr lang; nur der Anfang wurde zusammengefasst.",
              )}
            </p>
          )}
        </div>
        <div className="modal-footer ai-modal-footer">
          <button type="button" onClick={onClose}>
            {t("Schließen")}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={summarize}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Sparkles size={16} />
            )}
            {summary ? t("Erneut zusammenfassen") : t("Zusammenfassen")}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { LoaderCircle, Sparkles, X } from "lucide-react";
import { api } from "./mailUi.js";
import { t, getLanguage } from "./i18n.js";
import { useModalFocus } from "./useModalFocus.js";

function splitEditableDraft(value) {
  const marker =
    /\n\n(?:Am [^\n]+ schrieb [^\n]*:|On [^\n]+ wrote:|---------- (?:Weitergeleitete Nachricht|Forwarded message) ----------)/.exec(
      value,
    );
  return marker
    ? {
        editable: value.slice(0, marker.index),
        quoted: value.slice(marker.index),
      }
    : { editable: value, quoted: "" };
}

export default function AiRewriteModal({
  body,
  senderAccountId,
  to,
  cc,
  subject,
  recipientNameHints,
  onApply,
  onClose,
}) {
  const dialog = useModalFocus(onClose, "textarea");
  const { editable, quoted } = splitEditableDraft(body);
  const [instructions, setInstructions] = useState("");
  const [proposal, setProposal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function generate() {
    setBusy(true);
    setError("");
    setProposal("");
    try {
      const result = await api("/ai/rewrite", {
        method: "POST",
        body: {
          text: editable,
          instructions,
          language: getLanguage(),
          senderAccountId,
          to,
          cc,
          subject,
          recipientNameHints,
        },
      });
      setProposal(result.text);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop ai-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="modal ai-modal ai-rewrite-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-rewrite-title"
        ref={dialog}
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">MINIMAIL AI</div>
            <h2 id="ai-rewrite-title">{t("Text mit KI überarbeiten")}</h2>
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
              "Beim Erstellen werden Entwurf, Anweisungen, Betreff sowie Absender und Empfänger mit verfügbaren Namen an deinen KI-Server gesendet. Das Bcc-Feld, die gespeicherte Signatur und automatisch angehängte Zitate werden nicht übertragen. Die KI ergänzt Anrede, Absätze und Grußformel; deine Signatur wird später separat angehängt.",
            )}
          </p>
          {editable.trim() && (
            <details className="ai-original">
              <summary>{t("Ausgangstext anzeigen")}</summary>
              <pre>{editable}</pre>
            </details>
          )}
          <label>
            {t("Zusätzliche Anweisungen oder Stichpunkte")}
            <textarea
              value={instructions}
              onChange={(event) => {
                setInstructions(event.target.value);
                setProposal("");
              }}
              maxLength={3000}
              placeholder={t(
                "Zum Beispiel: freundlich antworten, Termin am Freitag vorschlagen …",
              )}
            />
          </label>
          {!editable.trim() && (
            <p className="ai-disclosure">
              {t(
                "Du kannst den Mailtext leer lassen und die Nachricht nur aus Stichpunkten erstellen lassen.",
              )}
            </p>
          )}
          {quoted && (
            <p className="ai-disclosure">
              {t(
                "Der zitierte Mailverlauf wird beim Übernehmen wieder angehängt.",
              )}
            </p>
          )}
          {error && (
            <p className="ai-error" role="alert">
              {error}
            </p>
          )}
          {proposal && (
            <label>
              {t("Vorschlag – vor dem Übernehmen bearbeitbar")}
              <textarea
                className="ai-proposal"
                value={proposal}
                onChange={(event) => setProposal(event.target.value)}
              />
            </label>
          )}
        </div>
        <div className="modal-footer ai-modal-footer">
          <button type="button" onClick={onClose}>
            {t("Abbrechen")}
          </button>
          <button
            type="button"
            disabled={busy || (!editable.trim() && !instructions.trim())}
            onClick={generate}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Sparkles size={16} />
            )}
            {proposal ? t("Neu erstellen") : t("Vorschlag erstellen")}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!proposal.trim() || busy}
            onClick={() => onApply(proposal.trim() + quoted)}
          >
            {t("Übernehmen")}
          </button>
        </div>
      </div>
    </div>
  );
}

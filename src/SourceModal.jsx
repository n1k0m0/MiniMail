import { useState, useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { api } from "./mailUi.js";
import { t } from "./i18n.js";
import { highlightMailSource } from "./mailSourceHighlight.js";
import { useModalFocus } from "./useModalFocus.js";

export default function SourceModal({
  accountId,
  folder,
  uid,
  onClose,
  setError,
}) {
  const dialog = useModalFocus(onClose);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const highlightedSource = useMemo(
    () => highlightMailSource(source),
    [source],
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/accounts/${accountId}/messages/${uid}/source?folder=${encodeURIComponent(folder)}`,
      {
        credentials: "same-origin",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(t("Quelltext konnte nicht geladen werden."));
        return response.text();
      })
      .then(setSource)
      .catch((error) => {
        if (error.name !== "AbortError") setError(error.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [accountId, folder, uid, setError]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal source-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-modal-title"
        ref={dialog}
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">MINIMAIL</div>
            <h2 id="source-modal-title">{t("Nachrichtenquelltext")}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={t("Schließen")}
          >
            <X size={20} />
          </button>
        </div>
        <pre className="source-content">
          {loading
            ? t("Lade Nachrichten …")
            : highlightedSource.map(({ text, type }, index) =>
                type === "plain" ? (
                  text
                ) : (
                  <span className={`source-${type}`} key={index}>
                    {text}
                  </span>
                ),
              )}
        </pre>
      </div>
    </div>
  );
}

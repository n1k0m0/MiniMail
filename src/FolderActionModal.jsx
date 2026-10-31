import { useEffect, useState } from "react";
import { LoaderCircle, FolderPlus, Trash2 } from "lucide-react";
import { api } from "./mailUi.js";
import { t } from "./i18n.js";
import { useModalFocus } from "./useModalFocus.js";

export default function FolderActionModal({
  accountId,
  path,
  deleting,
  onClose,
  onDone,
}) {
  const [name, setName] = useState(""),
    [preview, setPreview] = useState(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0),
    [loading, setLoading] = useState(deleting);
  const dialog = useModalFocus(() => {
    if (!busy) onClose();
  }, "input:not(:disabled)");
  const base = `/accounts/${accountId}/folders`;
  useEffect(() => {
    if (!deleting) return;
    let active = true;
    setLoading(true);
    setPreview(null);
    api(`${base}/delete-preview?path=${encodeURIComponent(path)}`)
      .then((value) => {
        if (active) {
          setPreview(value);
          setError("");
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, path, deleting, reload]);
  async function submit(event) {
    event.preventDefault();
    if (busy || loading || (deleting && !preview)) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(deleting ? `${base}/trash` : base, {
        method: "POST",
        body: deleting
          ? { path, ticket: preview.ticket }
          : { parent: path, name },
      });
      onDone(result);
    } catch (err) {
      setError(err.message);
      if (deleting) setPreview(null);
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
      <form
        className="modal confirm-modal folder-action-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-action-title"
        ref={dialog}
        onSubmit={submit}
      >
        <div className="modal-header">
          <h2 id="folder-action-title">
            {t(deleting ? "Ordner löschen?" : "Neuer Ordner")}
          </h2>
        </div>
        <div className="folder-action-body">
          {deleting ? (
            <>
              <p>
                {t(
                  "Dieser Ordner wird mit allen Unterordnern und Nachrichten in den Papierkorb verschoben:",
                )}{" "}
                <strong>{path}</strong>
              </p>
              {loading && (
                <p role="status">{t("Ordner und Filter werden geprüft …")}</p>
              )}
              {preview && (
                <>
                  <p>
                    {preview.subfolderCount} {t("Unterordner")},{" "}
                    {preview.messageCount} {t("Nachrichten")}
                  </p>
                  {preview.filters.length > 0 && (
                    <div className="folder-filter-warning">
                      <strong>
                        {t("Diese Filter werden ebenfalls gelöscht:")}
                      </strong>
                      <ul>
                        {preview.filters.map((filter) => (
                          <li key={filter.id}>{filter.name}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
              {!preview && !loading && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReload((value) => value + 1)}
                >
                  {t("Vorschau aktualisieren")}
                </button>
              )}
            </>
          ) : (
            <>
              <p>
                {t("Übergeordneter Ordner")}:{" "}
                <strong>{path || t("Postfach")}</strong>
              </p>
              <label>
                {t("Ordnername")}
                <input
                  required
                  autoFocus
                  maxLength={160}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy}
                />
              </label>
            </>
          )}
          {error && (
            <p className="filter-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <div>
            <button
              type="button"
              className="text-button"
              autoFocus={deleting}
              disabled={busy}
              onClick={onClose}
            >
              {t("Abbrechen")}
            </button>
            <button
              type="submit"
              className={deleting ? "danger-button" : "primary-button"}
              disabled={busy || loading || (deleting ? !preview : !name.trim())}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : deleting ? (
                <Trash2 size={16} />
              ) : (
                <FolderPlus size={16} />
              )}
              {t(deleting ? "In den Papierkorb verschieben" : "Ordner anlegen")}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

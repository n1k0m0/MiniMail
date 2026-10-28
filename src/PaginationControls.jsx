import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZE } from "./mailUi.js";
import { t } from "./i18n.js";

export default function PaginationControls({
  page,
  total,
  loading,
  onChange,
  compact = false,
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [entry, setEntry] = useState(String(page + 1));
  useEffect(() => setEntry(String(page + 1)), [page]);
  function jump() {
    const target = Number(entry);
    if (Number.isInteger(target) && target >= 1 && target <= pages)
      onChange(target - 1);
    else setEntry(String(page + 1));
  }
  return (
    <div
      className={`page-controls ${compact ? "page-controls-compact" : ""}`}
      aria-label={t("Nachrichtenseiten")}
    >
      {!compact && (
        <button
          type="button"
          title={t("Erste Seite")}
          aria-label={t("Erste Seite")}
          disabled={loading || page === 0}
          onClick={() => onChange(0)}
        >
          «
        </button>
      )}
      <button
        type="button"
        title={t("Neuere Nachrichten")}
        aria-label={t("Neuere Nachrichten")}
        disabled={loading || page === 0}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft size={17} />
      </button>
      {compact ? (
        <span>
          {page + 1} / {pages}
        </span>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            jump();
          }}
        >
          <label htmlFor="mail-page">{t("Seite")}</label>
          <input
            id="mail-page"
            type="number"
            min="1"
            max={pages}
            value={entry}
            onChange={(event) => setEntry(event.target.value)}
            onBlur={jump}
            aria-label={t("Seitennummer")}
          />
          <span>
            {t("von ")}
            {pages}
          </span>
        </form>
      )}
      <button
        type="button"
        title={t("Ältere Nachrichten")}
        aria-label={t("Ältere Nachrichten")}
        disabled={loading || page >= pages - 1}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight size={17} />
      </button>
      {!compact && (
        <button
          type="button"
          title={t("Letzte Seite")}
          aria-label={t("Letzte Seite")}
          disabled={loading || page >= pages - 1}
          onClick={() => onChange(pages - 1)}
        >
          »
        </button>
      )}
    </div>
  );
}

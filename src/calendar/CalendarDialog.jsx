import { X } from "lucide-react";
import { t } from "../i18n.js";
import { useModalFocus } from "../useModalFocus.js";

export default function CalendarDialog({
  title,
  onClose,
  children,
  wide = false,
}) {
  const ref = useModalFocus(
    onClose,
    "input:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
  );
  return (
    <div className="modal-backdrop calendar-backdrop">
      <div
        ref={ref}
        className={`modal calendar-dialog${wide ? " calendar-dialog-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-dialog-title"
      >
        <div className="modal-header">
          <h2 id="calendar-dialog-title">{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={t("Schließen")}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

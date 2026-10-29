import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { t } from "../i18n.js";

export default function CalendarDialog({
  title,
  onClose,
  children,
  wide = false,
}) {
  const ref = useRef(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector("input,button")?.focus();
    const keydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...ref.current.querySelectorAll(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex='0']",
        ),
      ].filter((el) => el.getClientRects().length);
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === controls.at(-1)
      ) {
        event.preventDefault();
        controls[0]?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus?.();
    };
  }, []);
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

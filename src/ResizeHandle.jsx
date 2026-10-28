import { useRef } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { t } from "./i18n.js";

export default function ResizeHandle({
  label,
  value,
  min,
  max,
  defaultWidth,
  onResize,
  onCommit,
}) {
  const drag = useRef(null);
  function finish(event) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    onCommit(drag.current.width);
    document.body.style.userSelect = drag.current.userSelect;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  }
  return (
    <div
      className="resize-handle"
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      title={t("Breite ziehen · Doppelklick setzt zurück")}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          startWidth: value,
          width: value,
          userSelect: document.body.style.userSelect,
        };
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        const width = Math.min(
          max,
          Math.max(
            min,
            drag.current.startWidth + event.clientX - drag.current.x,
          ),
        );
        drag.current.width = width;
        onResize(width);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={() => {
        onResize(defaultWidth);
        onCommit(defaultWidth);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const step = event.shiftKey ? 30 : 10;
        const next = Math.min(
          max,
          Math.max(min, value + (event.key === "ArrowRight" ? step : -step)),
        );
        onResize(next);
        onCommit(next);
      }}
    />
  );
}

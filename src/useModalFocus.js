import { useEffect, useRef } from "react";

const openDialogs = [];
const focusable =
  'button:not(:disabled):not([tabindex="-1"]),input:not(:disabled):not([tabindex="-1"]),select:not(:disabled):not([tabindex="-1"]),textarea:not(:disabled):not([tabindex="-1"]),a[href]:not([tabindex="-1"]),[tabindex="0"]';

export function handleModalKeydown(event, dialog, onClose, activeElement) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;
  const controls = [...dialog.querySelectorAll(focusable)].filter(
    (element) => element.getClientRects().length,
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (!first) {
    event.preventDefault();
    dialog.focus();
  } else if (!dialog.contains(activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function useModalFocus(onClose, initialFocus) {
  const dialog = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    openDialogs.push(element);
    element.tabIndex = -1;
    (
      (initialFocus && element.querySelector(initialFocus)) ||
      [...element.querySelectorAll(focusable)].find(
        (control) => control.getClientRects().length,
      ) ||
      element
    ).focus();
    function keydown(event) {
      if (openDialogs.at(-1) !== element) return;
      handleModalKeydown(
        event,
        element,
        () => close.current(),
        document.activeElement,
      );
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      const wasTop = openDialogs.at(-1) === element;
      openDialogs.splice(openDialogs.indexOf(element), 1);
      if (wasTop && previous?.isConnected) previous.focus?.();
    };
  }, []);
  return dialog;
}

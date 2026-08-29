import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function modalTabTargetIndex(
  currentIndex: number,
  itemCount: number,
  shiftKey: boolean,
): number | null {
  if (itemCount <= 0) return null;
  if (currentIndex < 0 || currentIndex >= itemCount) {
    return shiftKey ? itemCount - 1 : 0;
  }
  if (shiftKey && currentIndex === 0) return itemCount - 1;
  if (!shiftKey && currentIndex === itemCount - 1) return 0;
  return null;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => {
      if (
        element.hidden ||
        element.tabIndex < 0 ||
        element.closest('[hidden], [aria-hidden="true"]')
      ) {
        return false;
      }
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    },
  );
}

function trapModalTab(event: KeyboardEvent, container: HTMLElement): boolean {
  const items = focusableElements(container);
  if (items.length === 0) {
    event.preventDefault();
    container.focus();
    return true;
  }
  const currentIndex = items.indexOf(document.activeElement as HTMLElement);
  const targetIndex = modalTabTargetIndex(
    currentIndex,
    items.length,
    event.shiftKey,
  );
  if (targetIndex === null) return false;
  event.preventDefault();
  items[targetIndex]?.focus();
  return true;
}

function isTopmostModal(dialog: HTMLElement): boolean {
  const modals = document.querySelectorAll<HTMLElement>('[aria-modal="true"]');
  return modals.length === 0 || modals.item(modals.length - 1) === dialog;
}

/**
 * Keeps keyboard focus inside the topmost modal and restores the prior control
 * after it closes. Callback refs avoid reinstalling listeners on every render.
 */
export function useModalFocus({
  dialogRef,
  getInitialFocus,
  onEscape,
  escapeDisabled = false,
}: {
  dialogRef: RefObject<HTMLElement | null>;
  getInitialFocus?: () => HTMLElement | null;
  onEscape?: () => void;
  escapeDisabled?: boolean;
}): void {
  const initialFocusRef = useRef(getInitialFocus);
  const escapeRef = useRef(onEscape);
  const escapeDisabledRef = useRef(escapeDisabled);
  initialFocusRef.current = getInitialFocus;
  escapeRef.current = onEscape;
  escapeDisabledRef.current = escapeDisabled;

  useEffect(() => {
    const returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || !isTopmostModal(dialog)) return;
      const items = focusableElements(dialog);
      const preferred = initialFocusRef.current?.();
      const initial =
        preferred && items.includes(preferred) ? preferred : items[0] ?? dialog;
      initial.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog || !isTopmostModal(dialog)) return;
      if (
        event.key === "Escape" &&
        escapeRef.current &&
        !escapeDisabledRef.current
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        escapeRef.current();
        return;
      }
      if (event.key === "Tab" && trapModalTab(event, dialog)) {
        event.stopImmediatePropagation();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown, true);
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [dialogRef]);
}

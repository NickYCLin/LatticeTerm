import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** Returns the next index for a vertical ARIA menu navigation key. */
export function menuNavigationIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
): number | null {
  if (itemCount <= 0 || currentIndex < 0 || currentIndex >= itemCount) {
    return null;
  }

  switch (key) {
    case "ArrowDown":
      return (currentIndex + 1) % itemCount;
    case "ArrowUp":
      return (currentIndex - 1 + itemCount) % itemCount;
    case "Home":
      return 0;
    case "End":
      return itemCount - 1;
    default:
      return null;
  }
}

/** Moves focus inside a menu or dismisses it with Escape. */
export function handleMenuNavigation(
  event: ReactKeyboardEvent<HTMLElement>,
  dismiss: () => void,
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    dismiss();
    return;
  }

  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      'button[role="menuitem"]:not(:disabled)',
    ),
  );
  const currentIndex = items.indexOf(
    document.activeElement as HTMLButtonElement,
  );
  const nextIndex = menuNavigationIndex(event.key, currentIndex, items.length);
  if (nextIndex === null) return;

  event.preventDefault();
  items[nextIndex]?.focus();
}

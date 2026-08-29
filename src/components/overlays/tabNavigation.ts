import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** Returns the next index for a horizontal ARIA tablist navigation key. */
export function tabNavigationIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
): number | null {
  if (itemCount <= 0 || currentIndex < 0 || currentIndex >= itemCount) {
    return null;
  }

  switch (key) {
    case "ArrowRight":
      return (currentIndex + 1) % itemCount;
    case "ArrowLeft":
      return (currentIndex - 1 + itemCount) % itemCount;
    case "Home":
      return 0;
    case "End":
      return itemCount - 1;
    default:
      return null;
  }
}

/** Maps tab navigation onto the enabled items in the original tablist. */
export function tabNavigationTargetIndex(
  key: string,
  currentIndex: number,
  disabled: readonly boolean[],
): number | null {
  const enabledIndices = disabled.flatMap((isDisabled, index) =>
    isDisabled ? [] : [index],
  );
  const enabledCurrentIndex = enabledIndices.indexOf(currentIndex);
  const nextEnabledIndex = tabNavigationIndex(
    key,
    enabledCurrentIndex,
    enabledIndices.length,
  );

  return nextEnabledIndex === null ? null : enabledIndices[nextEnabledIndex];
}

/** Activates and focuses the next tab according to ARIA keyboard behaviour. */
export function moveTabGroupFocus(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  currentIndex: number,
  selectAt: (index: number) => void,
): void {
  const tablist = event.currentTarget.closest<HTMLElement>('[role="tablist"]');
  const tabs = Array.from(
    tablist?.querySelectorAll<HTMLButtonElement>('button[role="tab"]') ?? [],
  );
  const nextIndex = tabNavigationTargetIndex(
    event.key,
    currentIndex,
    tabs.map(
      (tab) => tab.disabled || tab.getAttribute("aria-disabled") === "true",
    ),
  );
  if (nextIndex === null) return;

  event.preventDefault();
  selectAt(nextIndex);
  tabs[nextIndex]?.focus();
}

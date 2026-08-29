import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** Returns the next selected index for an ARIA radio group's navigation key. */
export function radioNavigationIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
): number | null {
  if (itemCount <= 0 || currentIndex < 0 || currentIndex >= itemCount) {
    return null;
  }

  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (currentIndex + 1) % itemCount;
    case "ArrowLeft":
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

/** Maps radio navigation onto the enabled items in the original group. */
export function radioNavigationTargetIndex(
  key: string,
  currentIndex: number,
  disabled: readonly boolean[],
): number | null {
  const enabledIndices = disabled.flatMap((isDisabled, index) =>
    isDisabled ? [] : [index],
  );
  const enabledCurrentIndex = enabledIndices.indexOf(currentIndex);
  const nextEnabledIndex = radioNavigationIndex(
    key,
    enabledCurrentIndex,
    enabledIndices.length,
  );

  return nextEnabledIndex === null ? null : enabledIndices[nextEnabledIndex];
}

/** Applies ARIA radio keyboard navigation and keeps focus with the selection. */
export function moveRadioGroupFocus(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  currentIndex: number,
  selectAt: (index: number) => void,
) {
  const group = event.currentTarget.closest<HTMLElement>(
    '[role="radiogroup"]',
  );
  const radios = Array.from(
    group?.querySelectorAll<HTMLButtonElement>('button[role="radio"]') ?? [],
  );
  const nextIndex = radioNavigationTargetIndex(
    event.key,
    currentIndex,
    radios.map(
      (radio) => radio.disabled || radio.getAttribute("aria-disabled") === "true",
    ),
  );
  if (nextIndex === null) return;

  event.preventDefault();
  selectAt(nextIndex);
  radios[nextIndex]?.focus();
}

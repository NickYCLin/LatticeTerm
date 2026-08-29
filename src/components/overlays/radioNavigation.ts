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

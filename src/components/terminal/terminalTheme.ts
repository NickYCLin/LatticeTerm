/**
 * The terminal content area always renders on a dark background, regardless of
 * the app's light/dark theme.
 *
 * CLI tools (gemini, claude, ssh sessions, TUIs) overwhelmingly assume a dark
 * terminal and paint light text, so a light background left them washed out to
 * the point of being unreadable. Pinning a dark, well-tuned ANSI palette here —
 * while the rest of the app still follows the chosen theme — makes their output
 * look the way they intend. The Terminal's minimumContrastRatio stays on as a
 * safety net for any colour a CLI still picks poorly against this background.
 *
 * Only the cursor tracks the app accent, so the terminal keeps a hint of the
 * active theme without risking a low-contrast surface.
 */
export function terminalTheme(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue("--accent").trim() || "#58a6ff";

  const background = "#181d26";
  const foreground = "#e6edf3";

  return {
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: "rgba(88, 166, 255, 0.30)",
    // A GitHub-dark-style palette: every colour is tuned to stay legible on the
    // dark background above, including a black that never collapses into it.
    black: "#484f58",
    red: "#ff7b72",
    green: "#3fb950",
    yellow: "#d29922",
    blue: "#58a6ff",
    magenta: "#bc8cff",
    cyan: "#39c5cf",
    white: "#b1bac4",
    brightBlack: "#6e7681",
    brightRed: "#ffa198",
    brightGreen: "#56d364",
    brightYellow: "#e3b341",
    brightBlue: "#79c0ff",
    brightMagenta: "#d2a8ff",
    brightCyan: "#56d4dd",
    brightWhite: "#f0f6fc",
  };
}

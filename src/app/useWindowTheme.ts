/**
 * Keeps the native window frame in step with the chosen theme.
 *
 * Without this the title bar stays in the operating system's own light or dark
 * mode, which reads as a seam across the top of the window. Outside a Tauri
 * window there is no frame to set, so the failure is expected and ignored.
 */

import { useEffect } from "react";

export function useWindowTheme(isDark: boolean): void {
  useEffect(() => {
    let cancelled = false;

    async function apply() {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (cancelled) return;
        await getCurrentWindow().setTheme(isDark ? "dark" : "light");
      } catch {
        // Browser preview, or a platform without a settable frame theme.
      }
    }

    void apply();
    return () => {
      cancelled = true;
    };
  }, [isDark]);
}

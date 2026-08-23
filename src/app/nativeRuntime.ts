/** True only inside a Tauri window with a reachable desktop IPC bridge. */
export function hasDesktopBackend(scope: unknown = globalThis): boolean {
  return (
    typeof scope === "object" &&
    scope !== null &&
    "__TAURI_INTERNALS__" in scope
  );
}

export const DESKTOP_BACKEND_UNAVAILABLE = "runtime:desktop-backend-unavailable";

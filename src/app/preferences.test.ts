import { describe, expect, it } from "vitest";
import { defaultPreferences, sanitizePreferences } from "./preferences";

describe("sanitizePreferences", () => {
  it("migrates older preferences to secure vault defaults", () => {
    const preferences = sanitizePreferences({ theme: "light" });

    expect(preferences.theme).toBe("light");
    expect(preferences.vaultAutoLock).toBe("15");
    expect(preferences.vaultLockOnBackground).toBe(true);
    expect(preferences.sensitiveClipboardClear).toBe("30");
  });

  it("preserves explicit auto-lock choices", () => {
    const preferences = sanitizePreferences({
      vaultAutoLock: "off",
      vaultLockOnBackground: false,
      sensitiveClipboardClear: "off",
    });

    expect(preferences.vaultAutoLock).toBe("off");
    expect(preferences.vaultLockOnBackground).toBe(false);
    expect(preferences.sensitiveClipboardClear).toBe("off");
  });

  it("rejects malformed security preferences", () => {
    const preferences = sanitizePreferences({
      vaultAutoLock: "999" as never,
      vaultLockOnBackground: "yes" as never,
      sensitiveClipboardClear: "999" as never,
    });

    expect(preferences.vaultAutoLock).toBe(defaultPreferences.vaultAutoLock);
    expect(preferences.vaultLockOnBackground).toBe(
      defaultPreferences.vaultLockOnBackground,
    );
    expect(preferences.sensitiveClipboardClear).toBe(
      defaultPreferences.sensitiveClipboardClear,
    );
    expect(preferences.agentCompletionSound).toBe(
      defaultPreferences.agentCompletionSound,
    );
  });
});

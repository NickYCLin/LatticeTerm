import { describe, expect, it } from "vitest";
import { hasDesktopBackend } from "./nativeRuntime";

describe("hasDesktopBackend", () => {
  it("accepts a Tauri IPC bridge", () => {
    expect(hasDesktopBackend({ __TAURI_INTERNALS__: {} })).toBe(true);
  });

  it("rejects browser and non-object scopes", () => {
    expect(hasDesktopBackend({})).toBe(false);
    expect(hasDesktopBackend(null)).toBe(false);
  });
});

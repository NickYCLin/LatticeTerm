import { describe, expect, it } from "vitest";
import type { ValidationErrors } from "../../domain/connection";
import { clearValidationError } from "./connectionValidation";

describe("connection drawer validation", () => {
  it("clears only the error for the field the user changed", () => {
    const current: ValidationErrors = {
      name: { key: "validation.nameRequired" },
      hostname: { key: "validation.hostRequired" },
    };

    const next = clearValidationError(current, "name");

    expect(next).not.toBe(current);
    expect(next.name).toBeUndefined();
    expect(next.hostname).toEqual(current.hostname);
    expect(current.name).toBeDefined();
  });

  it("keeps the same state object when that field has no error", () => {
    const current: ValidationErrors = {
      name: { key: "validation.nameRequired" },
    };

    expect(clearValidationError(current, "port")).toBe(current);
  });
});

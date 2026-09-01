import { describe, expect, it } from "vitest";
import {
  MAX_SHARED_AGENT_RULES_BYTES,
  normalizedSharedRulesByteLength,
  SHARED_AGENT_RULES_TEMPLATE_ZH_TW,
  utf8ByteLength,
} from "./sharedAgentRules";

describe("sharedAgentRules", () => {
  it("counts the UTF-8 bytes enforced by the native writer", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("繁中")).toBe(6);
    expect(normalizedSharedRulesByteLength("  繁中\r\n")).toBe(7);
  });

  it("keeps the recommended template within the Codex instruction budget", () => {
    expect(utf8ByteLength(SHARED_AGENT_RULES_TEMPLATE_ZH_TW)).toBeLessThan(
      MAX_SHARED_AGENT_RULES_BYTES,
    );
    expect(SHARED_AGENT_RULES_TEMPLATE_ZH_TW).toContain("Token");
  });
});

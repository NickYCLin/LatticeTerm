import { describe, expect, it } from "vitest";
import {
  decodeAgentPayload,
  encodeAgentPayload,
  splitAgentArguments,
} from "./useAgentSessions";

describe("agent session transport", () => {
  it("round-trips arbitrary PTY bytes", () => {
    const bytes = new Uint8Array([0, 10, 27, 128, 200, 255]);
    expect(decodeAgentPayload(encodeAgentPayload(bytes))).toEqual(bytes);
  });

  it("treats each non-empty line as one direct argument", () => {
    expect(splitAgentArguments("--model\ngpt-5\n\n--full-auto")).toEqual([
      "--model",
      "gpt-5",
      "--full-auto",
    ]);
  });
});

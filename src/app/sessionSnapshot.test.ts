import { describe, expect, it } from "vitest";
import { reconcileSessionSnapshot } from "./sessionSnapshot";

interface TestSession {
  sessionId: string;
  revision: number;
}

describe("reconcileSessionSnapshot", () => {
  it("restores backend sessions and keeps newer local state", () => {
    const result = reconcileSessionSnapshot<TestSession>(
      [
        { sessionId: "shared", revision: 2 },
        { sessionId: "connected-later", revision: 1 },
      ],
      [
        { sessionId: "snapshot-only", revision: 1 },
        { sessionId: "shared", revision: 1 },
      ],
    );

    expect(result).toEqual([
      { sessionId: "snapshot-only", revision: 1 },
      { sessionId: "shared", revision: 2 },
      { sessionId: "connected-later", revision: 1 },
    ]);
  });

  it("does not resurrect a session closed while the snapshot was loading", () => {
    const result = reconcileSessionSnapshot<TestSession>(
      [],
      [
        { sessionId: "still-open", revision: 1 },
        { sessionId: "closed", revision: 1 },
      ],
      new Set(["closed"]),
    );

    expect(result).toEqual([{ sessionId: "still-open", revision: 1 }]);
  });
});

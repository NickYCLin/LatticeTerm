import { describe, expect, it } from "vitest";
import {
  reconcileSessionSnapshot,
  reconcileSingletonSnapshot,
} from "./sessionSnapshot";

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

describe("reconcileSingletonSnapshot", () => {
  const identity = (session: TestSession) => session.sessionId;

  it("keeps a newer status event instead of an older backend snapshot", () => {
    expect(
      reconcileSingletonSnapshot(
        { sessionId: "host-current", revision: 2 },
        { sessionId: "host-current", revision: 1 },
        identity,
      ),
    ).toEqual({ sessionId: "host-current", revision: 2 });
  });

  it("does not restore a host closed while the snapshot was loading", () => {
    expect(
      reconcileSingletonSnapshot(
        null,
        { sessionId: "host-closed", revision: 1 },
        identity,
        new Set(["host-closed"]),
      ),
    ).toBeNull();
  });

  it("still restores an unrelated current backend host", () => {
    expect(
      reconcileSingletonSnapshot(
        null,
        { sessionId: "host-new", revision: 1 },
        identity,
        new Set(["host-old"]),
      ),
    ).toEqual({ sessionId: "host-new", revision: 1 });
  });
});

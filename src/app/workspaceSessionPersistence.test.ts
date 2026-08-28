import { describe, expect, it } from "vitest";
import {
  agentRestoreArguments,
  loadWorkspaceSessionSnapshot,
  saveWorkspaceSessionSnapshot,
  sanitizeWorkspaceSessionSnapshot,
  snapshotLiveWorkspaceSessions,
  WORKSPACE_SESSIONS_KEY,
  type StorageReaderWriter,
} from "./workspaceSessionPersistence";

function storage(): StorageReaderWriter & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

function agent(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "agent-live-1",
    groupId: "project-group-1",
    groupLabel: "LatticeTerm",
    definitionId: "codex",
    label: "OpenAI Codex",
    model: null,
    executable: "C:\\tools\\codex.cmd",
    launchArguments: [],
    workingDirectory: "D:\\project\\LatticeTerm",
    state: "working" as const,
    stateSource: "heuristic" as const,
    processId: 42,
    capturedSessionId: "native-chat-1",
    ...overrides,
  };
}

describe("workspace session persistence", () => {
  it("stores only restorable agent metadata and SSH profile IDs", () => {
    const snapshot = snapshotLiveWorkspaceSessions(
      [agent()],
      [
        {
          sessionId: "ssh-live-1",
          profileId: "profile-1",
          host: "private.example",
          port: 22,
          username: "operator",
        },
      ],
      "agent-live-1",
    );
    const encoded = JSON.stringify(snapshot);

    expect(snapshot.sessions).toEqual([
      expect.objectContaining({
        kind: "agent",
        groupLabel: "LatticeTerm",
        launchArguments: [],
        resumeSessionId: "native-chat-1",
      }),
      { kind: "ssh", profileId: "profile-1" },
    ]);
    for (const secretField of ["password", "passphrase", "token", "terminalOutput"]) {
      expect(encoded).not.toContain(secretField);
    }
    expect(encoded).not.toContain("private.example");
  });

  it("round trips a valid snapshot", () => {
    const target = storage();
    const snapshot = snapshotLiveWorkspaceSessions([agent()], [], "agent-live-1");

    saveWorkspaceSessionSnapshot(target, snapshot);

    expect(loadWorkspaceSessionSnapshot(target)).toEqual(snapshot);
    expect(target.values.has(WORKSPACE_SESSIONS_KEY)).toBe(true);
  });

  it("fails closed for malformed or oversized state", () => {
    expect(sanitizeWorkspaceSessionSnapshot({ version: 1, sessions: "bad" })).toBeNull();
    expect(
      sanitizeWorkspaceSessionSnapshot({
        version: 1,
        sessions: Array.from({ length: 65 }, () => ({
          kind: "ssh",
          profileId: "profile",
        })),
      }),
    ).toBeNull();
  });

  it("uses the verified latest-session flags only when no native id exists", () => {
    const codex = snapshotLiveWorkspaceSessions(
      [agent({ capturedSessionId: null })],
      [],
      null,
    ).sessions[0];
    const antigravity = snapshotLiveWorkspaceSessions(
      [
        agent({
          definitionId: "antigravity",
          capturedSessionId: null,
        }),
      ],
      [],
      null,
    ).sessions[0];

    expect(codex.kind === "agent" && agentRestoreArguments(codex)).toEqual([
      "resume",
      "--last",
    ]);
    expect(
      antigravity.kind === "agent" && agentRestoreArguments(antigravity),
    ).toEqual(["--continue"]);
  });

  it("preserves explicit CLI arguments when no native session id exists", () => {
    const saved = snapshotLiveWorkspaceSessions(
      [
        agent({
          capturedSessionId: null,
          launchArguments: ["--model", "gpt-5.6-sol"],
        }),
      ],
      [],
      null,
    ).sessions[0];

    expect(saved.kind === "agent" && agentRestoreArguments(saved)).toEqual([
      "--model",
      "gpt-5.6-sol",
    ]);
  });
});

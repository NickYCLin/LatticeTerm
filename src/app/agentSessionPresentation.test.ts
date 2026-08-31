import { describe, expect, it } from "vitest";
import type {
  AgentDefinition,
  AgentSessionSummary,
} from "./useAgentSessions";
import { presentAgentSessionGroup } from "./agentSessionPresentation";

const definitions: Pick<AgentDefinition, "id" | "label">[] = [
  { id: "codex", label: "OpenAI Codex" },
  { id: "claude", label: "Claude Code" },
];

function member(
  overrides: Partial<AgentSessionSummary> = {},
): AgentSessionSummary {
  return {
    sessionId: "agent-codex",
    groupId: "group-storyvoice",
    groupLabel: "OpenAI Codex",
    definitionId: "codex",
    label: "OpenAI Codex",
    model: null,
    executable: "codex",
    launchArguments: [],
    workingDirectory: "D:/project/StoryVoice",
    state: "idle",
    stateSource: "heuristic",
    processId: 100,
    tokenUsage: null,
    capturedSessionId: null,
    ...overrides,
  };
}

describe("agent session group presentation", () => {
  it("shows the actual CLI when a restored automatic label is stale", () => {
    const presentation = presentAgentSessionGroup(
      [
        member({
          sessionId: "agent-claude",
          definitionId: "claude",
          label: "Claude Code",
        }),
      ],
      definitions,
      "agent-claude",
    );

    expect(presentation).toEqual({
      groupLabel: "Claude Code",
      headerLabel: "Claude Code",
      headerMemberLabel: null,
      renameLabel: "Claude Code",
    });
  });

  it("summarizes every CLI in the sidebar and names the active CLI in the header", () => {
    const presentation = presentAgentSessionGroup(
      [
        member(),
        member({
          sessionId: "agent-claude",
          definitionId: "claude",
          label: "Claude Code",
        }),
      ],
      definitions,
      "agent-claude",
    );

    expect(presentation.groupLabel).toBe("OpenAI Codex + Claude Code");
    expect(presentation.headerLabel).toBe("Claude Code");
    expect(presentation.headerMemberLabel).toBeNull();
  });

  it("preserves a custom group name and identifies its active CLI", () => {
    const presentation = presentAgentSessionGroup(
      [
        member({ groupLabel: "StoryVoice" }),
        member({
          sessionId: "agent-claude",
          groupLabel: "StoryVoice",
          definitionId: "claude",
          label: "Claude Code",
        }),
      ],
      definitions,
      "agent-claude",
    );

    expect(presentation).toEqual({
      groupLabel: "StoryVoice",
      headerLabel: "StoryVoice",
      headerMemberLabel: "Claude Code",
      renameLabel: "StoryVoice",
    });
  });
});

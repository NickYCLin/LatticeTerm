import { describe, expect, it } from "vitest";
import { createThread, type ChatThread } from "./agentChat";
import {
  chatSidebarRows,
  chatThreadNodeId,
  reconcileChatLayout,
} from "./chatThreadLayout";
import {
  createSessionSidebarFolder,
  emptySessionSidebarLayout,
  moveSessionSidebarNode,
  toggleSessionSidebarFolder,
} from "./sessionSidebarLayout";

function thread(id: string): ChatThread {
  return createThread(
    { definitionId: "claude", workingDirectory: "/w", permission: "ask", model: "" },
    id,
    1,
  );
}

describe("chat thread folders", () => {
  const threads = [thread("a"), thread("b"), thread("c")];

  it("seats new threads at the top level and forgets deleted ones", () => {
    const layout = reconcileChatLayout(emptySessionSidebarLayout, threads);
    expect(Object.keys(layout.placements).sort()).toEqual([
      "thread:a",
      "thread:b",
      "thread:c",
    ]);
    const fewer = reconcileChatLayout(layout, threads.slice(0, 1));
    expect(Object.keys(fewer.placements)).toEqual(["thread:a"]);
  });

  it("lists folders with their threads, indented, and hides collapsed branches", () => {
    let layout = reconcileChatLayout(emptySessionSidebarLayout, threads);
    layout = createSessionSidebarFolder(layout, { id: "folder:work", name: "工作" }, null);
    layout = moveSessionSidebarNode(layout, chatThreadNodeId("b"), "folder:work");

    const rows = chatSidebarRows(layout, threads);
    expect(rows.map((row) => [row.kind, row.nodeId, row.depth])).toEqual([
      ["thread", "thread:a", 0],
      ["thread", "thread:c", 0],
      ["folder", "folder:work", 0],
      ["thread", "thread:b", 1],
    ]);

    const collapsed = toggleSessionSidebarFolder(layout, "folder:work");
    const hidden = chatSidebarRows(collapsed, threads);
    expect(hidden.map((row) => row.nodeId)).toEqual(["thread:a", "thread:c", "folder:work"]);
    expect(hidden[2]).toMatchObject({ kind: "folder", collapsed: true, empty: false });
  });

  it("keeps a thread's folder across reconciliation", () => {
    let layout = reconcileChatLayout(emptySessionSidebarLayout, threads);
    layout = createSessionSidebarFolder(layout, { id: "folder:work", name: "工作" }, null);
    layout = moveSessionSidebarNode(layout, chatThreadNodeId("a"), "folder:work");
    const again = reconcileChatLayout(layout, [...threads, thread("d")]);
    expect(again.placements["thread:a"].parentId).toBe("folder:work");
    expect(again.placements["thread:d"].parentId).toBeNull();
  });
});

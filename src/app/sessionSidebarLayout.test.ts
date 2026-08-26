import { describe, expect, it } from "vitest";
import {
  createSessionSidebarFolder,
  emptySessionSidebarLayout,
  moveSessionSidebarNode,
  reconcileSessionSidebarLayout,
  removeSessionSidebarFolder,
  sanitizeSessionSidebarLayout,
  sessionSidebarChildren,
} from "./sessionSidebarLayout";

const project = { id: "project:local:latticeterm", defaultParentId: null };
const session = {
  id: "session:agent:latticeterm",
  defaultParentId: project.id,
};

describe("session sidebar layout", () => {
  it("places new sessions below their discovered project", () => {
    const layout = reconcileSessionSidebarLayout(emptySessionSidebarLayout, [
      project,
      session,
    ]);

    expect(sessionSidebarChildren(layout, null)).toEqual([project.id]);
    expect(sessionSidebarChildren(layout, project.id)).toEqual([session.id]);
  });

  it("supports nested custom folders and moving live nodes", () => {
    let layout = reconcileSessionSidebarLayout(emptySessionSidebarLayout, [
      project,
      session,
    ]);
    layout = createSessionSidebarFolder(
      layout,
      { id: "folder:work", name: "工作" },
      null,
    );
    layout = createSessionSidebarFolder(
      layout,
      { id: "folder:active", name: "進行中" },
      "folder:work",
    );
    layout = moveSessionSidebarNode(layout, project.id, "folder:active");
    layout = moveSessionSidebarNode(layout, session.id, "folder:active");

    expect(sessionSidebarChildren(layout, null)).toEqual(["folder:work"]);
    expect(sessionSidebarChildren(layout, "folder:work")).toEqual([
      "folder:active",
    ]);
    expect(sessionSidebarChildren(layout, "folder:active")).toEqual([
      project.id,
      session.id,
    ]);
  });

  it("rejects cycles when a folder is moved into its descendant", () => {
    let layout = createSessionSidebarFolder(
      emptySessionSidebarLayout,
      { id: "folder:parent", name: "父層" },
      null,
    );
    layout = createSessionSidebarFolder(
      layout,
      { id: "folder:child", name: "子層" },
      "folder:parent",
    );

    const rejected = moveSessionSidebarNode(
      layout,
      "folder:parent",
      "folder:child",
    );

    expect(rejected).toEqual(layout);
  });

  it("moves a removed folder's children to its parent", () => {
    let layout = reconcileSessionSidebarLayout(emptySessionSidebarLayout, [project]);
    layout = createSessionSidebarFolder(
      layout,
      { id: "folder:work", name: "工作" },
      null,
    );
    layout = moveSessionSidebarNode(layout, project.id, "folder:work");

    layout = removeSessionSidebarFolder(layout, "folder:work");

    expect(sessionSidebarChildren(layout, null)).toEqual([project.id]);
  });

  it("fails closed for malformed or oversized persisted data", () => {
    expect(sanitizeSessionSidebarLayout({ version: 1 })).toBeNull();
    expect(
      sanitizeSessionSidebarLayout({
        version: 1,
        folders: [{ id: "bad", name: "Bad" }],
        placements: {},
        collapsedFolderIds: [],
      }),
    ).toBeNull();
  });
});

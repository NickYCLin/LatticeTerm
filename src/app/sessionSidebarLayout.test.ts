import { describe, expect, it } from "vitest";
import {
  createSessionSidebarFolder,
  emptySessionSidebarLayout,
  moveSessionSidebarNode,
  reconcileSessionSidebarLayout,
  removeSessionSidebarFolder,
  sanitizeSessionSidebarLayout,
  sessionSidebarChildren,
  sessionSidebarDropPlacement,
  sessionSidebarSessionNodeId,
  toggleSessionSidebarFolder,
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

  it("keeps an explicit top-level move instead of restoring the default parent", () => {
    let layout = reconcileSessionSidebarLayout(emptySessionSidebarLayout, [
      project,
      session,
    ]);
    layout = moveSessionSidebarNode(layout, session.id, null);

    layout = reconcileSessionSidebarLayout(layout, [project, session]);

    expect(sessionSidebarChildren(layout, null)).toEqual([
      project.id,
      session.id,
    ]);
    expect(sessionSidebarChildren(layout, project.id)).toEqual([]);
  });

  it("uses saved profile identity across remote-session reconnects", () => {
    expect(
      sessionSidebarSessionNodeId("ssh", "runtime-before", "profile:server"),
    ).toBe(
      sessionSidebarSessionNodeId("ssh", "runtime-after", "profile:server"),
    );
    expect(sessionSidebarSessionNodeId("ssh", "runtime-only", null)).toBe(
      "session:ssh:runtime-only",
    );
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

  it("drops project rows into the requested folder", () => {
    let layout = reconcileSessionSidebarLayout(emptySessionSidebarLayout, [
      project,
      session,
    ]);
    layout = createSessionSidebarFolder(
      layout,
      { id: "folder:work", name: "工作" },
      null,
    );

    const destination = sessionSidebarDropPlacement(
      layout,
      project.id,
      "folder:work",
      true,
      false,
    );
    expect(destination).toEqual({
      parentId: "folder:work",
      beforeNodeId: null,
    });

    layout = moveSessionSidebarNode(
      layout,
      project.id,
      destination!.parentId,
      destination!.beforeNodeId,
    );
    expect(sessionSidebarChildren(layout, "folder:work")).toEqual([
      project.id,
    ]);
  });

  it("reorders ordinary rows at the exact drop edge", () => {
    const secondProject = { id: "project:local:mysqlpunk", defaultParentId: null };
    const thirdProject = { id: "project:local:mqttape", defaultParentId: null };
    let layout = reconcileSessionSidebarLayout(emptySessionSidebarLayout, [
      project,
      secondProject,
      thirdProject,
    ]);

    const destination = sessionSidebarDropPlacement(
      layout,
      thirdProject.id,
      project.id,
      false,
      true,
    );
    expect(destination).toEqual({
      parentId: null,
      beforeNodeId: secondProject.id,
    });

    layout = moveSessionSidebarNode(
      layout,
      thirdProject.id,
      destination!.parentId,
      destination!.beforeNodeId,
    );
    expect(sessionSidebarChildren(layout, null)).toEqual([
      project.id,
      thirdProject.id,
      secondProject.id,
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

  it("keeps a live project branch collapsed across reconciliation", () => {
    let layout = reconcileSessionSidebarLayout(emptySessionSidebarLayout, [
      project,
      session,
    ]);
    layout = toggleSessionSidebarFolder(layout, project.id);

    expect(layout.collapsedFolderIds).toEqual([project.id]);
    expect(
      reconcileSessionSidebarLayout(layout, [project, session]).collapsedFolderIds,
    ).toEqual([project.id]);
    expect(reconcileSessionSidebarLayout(layout, []).collapsedFolderIds).toEqual([]);
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

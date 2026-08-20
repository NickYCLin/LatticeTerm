import { describe, expect, it } from "vitest";
import {
  activityKindLabelKey,
  appendActivity,
  createActivityEntry,
  exportActivityLogText,
  filterActivity,
  type ActivityEntry,
} from "./activity";

const created = createActivityEntry(
  { kind: "created", subject: "Edge gateway", detail: "operator@gw.example.com:22" },
  1_700_000_000_000,
  "a-1",
);

const updated = createActivityEntry(
  { kind: "updated", subject: "Build server", detail: "runner@192.0.2.1:2222" },
  1_700_000_010_000,
  "a-2",
);

const workspace = createActivityEntry(
  {
    kind: "workspace",
    titleKey: "activity.samplesLoaded",
    note: { key: "activity.samplesDetail", values: { count: 6 } },
  },
  1_700_000_020_000,
  "a-3",
);

const list = [workspace, updated, created];

/** Stands in for the interface's translator during tests. */
const render = (entry: ActivityEntry) =>
  [entry.subject, entry.titleKey, entry.detail, entry.note?.key]
    .filter(Boolean)
    .join(" ");

describe("activity log", () => {
  it("keeps newest first and honours the limit", () => {
    const fresh = appendActivity([created], updated, 2);
    expect(fresh).toEqual([updated, created]);
    expect(appendActivity(fresh, workspace, 2)).toEqual([workspace, updated]);
  });

  it("stamps an id and a time", () => {
    const entry = createActivityEntry({ kind: "deleted", subject: "Lab" });
    expect(entry.id).toBeTruthy();
    expect(entry.at).toBeGreaterThan(0);
  });

  it("stores keys rather than sentences, so it survives a language change", () => {
    expect(workspace.titleKey).toBe("activity.samplesLoaded");
    expect(workspace.note).toEqual({
      key: "activity.samplesDetail",
      values: { count: 6 },
    });
    expect(activityKindLabelKey("created")).toBe("activity.kind.created");
  });
});

describe("filtering", () => {
  it("filters by kind", () => {
    expect(filterActivity(list, "", "created", render)).toEqual([created]);
    expect(filterActivity(list, "", "deleted", render)).toEqual([]);
    expect(filterActivity(list, "", "all", render)).toEqual(list);
  });

  it("matches the text the user can actually see", () => {
    expect(filterActivity(list, "gateway", "all", render)).toEqual([created]);
    expect(filterActivity(list, "192.0.2.1", "all", render)).toEqual([updated]);
    expect(filterActivity(list, "nomatch", "all", render)).toEqual([]);
  });

  it("treats blank input as no filter", () => {
    expect(filterActivity(list, "   ", "all", render)).toEqual(list);
  });
});

describe("text export", () => {
  it("writes a header and one line per entry", () => {
    const text = exportActivityLogText(
      [created],
      (entry) => `${entry.subject} ${entry.detail}`,
      "2026-08-20T00:00:00.000Z",
    );
    const lines = text.split("\n");

    expect(lines[0]).toBe("# LatticeTerm activity log");
    expect(lines[1]).toContain("2026-08-20T00:00:00.000Z");
    expect(lines[2]).toBe("# Entries: 1");
    expect(lines[lines.length - 1]).toContain("Edge gateway operator@gw.example.com:22");
  });

  it("states that no credentials are recorded", () => {
    expect(exportActivityLogText([], () => "")).toContain(
      "No credentials or command output are recorded",
    );
  });
});

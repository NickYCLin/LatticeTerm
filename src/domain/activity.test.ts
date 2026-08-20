import { describe, expect, it } from "vitest";
import {
  appendActivity,
  createActivityEntry,
  exportActivityLogJson,
  exportActivityLogText,
  filterActivity,
  type ActivityEntry,
} from "./activity";

describe("activity domain", () => {
  const e1: ActivityEntry = createActivityEntry(
    "created",
    "Edge gateway",
    "SSH · operator@gateway.example.com:22",
    1700000000000,
    "a-1",
  );

  const e2: ActivityEntry = createActivityEntry(
    "updated",
    "Build server",
    "SFTP · runner@192.0.2.1:22",
    1700000010000,
    "a-2",
  );

  const e3: ActivityEntry = createActivityEntry(
    "workspace",
    "Sample workspace loaded",
    "6 example profiles",
    1700000020000,
    "a-3",
  );

  const list = [e3, e2, e1];

  it("appends activity newest first and respects limit", () => {
    const fresh = appendActivity([e1], e2, 2);
    expect(fresh).toEqual([e2, e1]);

    const over = appendActivity(fresh, e3, 2);
    expect(over).toEqual([e3, e2]);
  });

  it("filters activity by kind", () => {
    expect(filterActivity(list, "", "created")).toEqual([e1]);
    expect(filterActivity(list, "", "updated")).toEqual([e2]);
    expect(filterActivity(list, "", "workspace")).toEqual([e3]);
    expect(filterActivity(list, "", "deleted")).toEqual([]);
    expect(filterActivity(list, "", "all")).toEqual(list);
  });

  it("filters activity by query matching message, label, or detail", () => {
    expect(filterActivity(list, "gateway")).toEqual([e1]);
    expect(filterActivity(list, "SFTP")).toEqual([e2]);
    expect(filterActivity(list, "Profile added")).toEqual([e1]);
    expect(filterActivity(list, "nomatch")).toEqual([]);
  });

  it("exports clean plain text log", () => {
    const text = exportActivityLogText([e1]);
    expect(text).toContain("# LatticeTerm Activity Log");
    expect(text).toContain("Edge gateway");
    expect(text).toContain("SSH · operator@gateway.example.com:22");
  });

  it("exports clean JSON log", () => {
    const jsonStr = exportActivityLogJson([e1]);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.application).toBe("LatticeTerm");
    expect(parsed.totalEntries).toBe(1);
    expect(parsed.entries[0].message).toBe("Edge gateway");
  });
});

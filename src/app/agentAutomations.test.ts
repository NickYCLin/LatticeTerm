import { describe, expect, it } from "vitest";
import {
  beginAutomationRun,
  closeStaleRuns,
  createAutomation,
  dueAutomations,
  emptyAutomationDraft,
  finishAutomationRun,
  loadStoredAutomations,
  nextRunAfter,
  saveStoredAutomations,
  setAutomationEnabled,
  updateAutomation,
  validateAutomationDraft,
  type AutomationDraft,
} from "./agentAutomations";

// 2026-09-02 is a Wednesday.
const wednesday = (hours: number, minutes = 0) => new Date(2026, 8, 2, hours, minutes);

function draft(overrides: Partial<AutomationDraft> = {}): AutomationDraft {
  return emptyAutomationDraft({
    name: "每日巡檢",
    instructions: "看一下昨天的錯誤紀錄",
    workingDirectory: "/work",
    ...overrides,
  });
}

describe("nextRunAfter", () => {
  it("picks later today when the time has not passed", () => {
    const next = nextRunAfter({ kind: "daily", time: "09:00", weekdays: [] }, wednesday(8));
    expect(next).toEqual(wednesday(9));
  });

  it("moves to tomorrow once the time has passed, and never returns now", () => {
    const next = nextRunAfter({ kind: "daily", time: "09:00", weekdays: [] }, wednesday(9));
    expect(next).toEqual(new Date(2026, 8, 3, 9, 0));
  });

  it("skips to the next allowed weekday", () => {
    // Wednesday evening, weekdays Mon+Tue only → next Monday.
    const next = nextRunAfter(
      { kind: "daily", time: "07:30", weekdays: [1, 2] },
      wednesday(20),
    );
    expect(next).toEqual(new Date(2026, 8, 7, 7, 30));
    expect(next.getDay()).toBe(1);
  });

  it("adds the interval to now", () => {
    const next = nextRunAfter({ kind: "interval", everyMinutes: 90 }, wednesday(10));
    expect(next).toEqual(wednesday(11, 30));
  });
});

describe("validateAutomationDraft", () => {
  it("accepts a complete draft", () => {
    expect(validateAutomationDraft(draft())).toEqual({});
  });

  it("refuses the ask permission: nobody is there to answer", () => {
    expect(validateAutomationDraft(draft({ permission: "ask" })).permission).toBe(
      "unattended",
    );
  });

  it("checks the schedule fields", () => {
    expect(
      validateAutomationDraft(
        draft({ schedule: { kind: "daily", time: "25:00", weekdays: [] } }),
      ).time,
    ).toBe("invalid");
    expect(
      validateAutomationDraft(draft({ schedule: { kind: "interval", everyMinutes: 5 } }))
        .everyMinutes,
    ).toBe("range");
  });

  it("requires a name, instructions and a directory", () => {
    const errors = validateAutomationDraft(
      draft({ name: " ", instructions: "", workingDirectory: "" }),
    );
    expect(errors).toEqual({
      name: "required",
      instructions: "required",
      workingDirectory: "required",
    });
  });
});

describe("runs and scheduling", () => {
  it("is due once its time arrives and not while a run is in progress", () => {
    const automation = createAutomation(
      draft({ schedule: { kind: "daily", time: "09:00", weekdays: [] } }),
      "a1",
      wednesday(8),
    );
    expect(dueAutomations([automation], wednesday(8, 59).getTime())).toEqual([]);
    expect(dueAutomations([automation], wednesday(9).getTime())).toHaveLength(1);

    const running = beginAutomationRun(
      automation,
      { runId: "r1", threadId: "t1" },
      wednesday(9),
      true,
    );
    expect(dueAutomations([running], wednesday(9, 1).getTime())).toEqual([]);
    // The schedule already moved on to tomorrow.
    expect(running.nextRunAt).toBe(new Date(2026, 8, 3, 9, 0).getTime());
  });

  it("running early keeps the planned time", () => {
    const automation = createAutomation(
      draft({ schedule: { kind: "daily", time: "09:00", weekdays: [] } }),
      "a1",
      wednesday(8),
    );
    const early = beginAutomationRun(
      automation,
      { runId: "r1", threadId: "t1" },
      wednesday(8, 10),
      false,
    );
    expect(early.nextRunAt).toBe(wednesday(9).getTime());
  });

  it("records the outcome of the run that finished", () => {
    const automation = beginAutomationRun(
      createAutomation(draft(), "a1", wednesday(8)),
      { runId: "r1", threadId: "t1" },
      wednesday(9),
      true,
    );
    const done = finishAutomationRun(automation, "r1", "error", "boom", wednesday(9, 5));
    expect(done.runs[0]).toMatchObject({ outcome: "error", error: "boom" });
    expect(done.runs[0].finishedAt).toBe(wednesday(9, 5).getTime());
  });

  it("pausing clears the next run and resuming plans a fresh one", () => {
    const automation = createAutomation(draft(), "a1", wednesday(8));
    const paused = setAutomationEnabled(automation, false, wednesday(8));
    expect(paused.nextRunAt).toBeNull();
    expect(dueAutomations([paused], wednesday(23).getTime())).toEqual([]);
    const resumed = setAutomationEnabled(paused, true, wednesday(10));
    expect(resumed.nextRunAt).toBe(new Date(2026, 8, 3, 9, 0).getTime());
  });

  it("editing recomputes the next run from the new schedule", () => {
    const automation = createAutomation(draft(), "a1", wednesday(8));
    const edited = updateAutomation(
      automation,
      draft({ schedule: { kind: "interval", everyMinutes: 60 } }),
      wednesday(8),
    );
    expect(edited.nextRunAt).toBe(wednesday(9).getTime());
  });

  it("closes runs left running by a previous session", () => {
    const automation = beginAutomationRun(
      createAutomation(draft(), "a1", wednesday(8)),
      { runId: "r1", threadId: "t1" },
      wednesday(9),
      true,
    );
    expect(closeStaleRuns(automation).runs[0].outcome).toBe("stopped");
  });
});

describe("storage", () => {
  function memoryStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    };
  }

  it("round-trips and downgrades an unattended ask", () => {
    const storage = memoryStorage();
    const automation = createAutomation(draft(), "a1", wednesday(8));
    saveStoredAutomations(storage, [{ ...automation, permission: "ask" }]);
    const [loaded] = loadStoredAutomations(storage);
    expect(loaded.id).toBe("a1");
    expect(loaded.permission).toBe("readOnly");
  });

  it("ignores junk", () => {
    const storage = memoryStorage();
    storage.setItem("latticeterm.agentAutomations.v1", JSON.stringify([{ id: 1 }, "x"]));
    expect(loadStoredAutomations(storage)).toEqual([]);
  });
});

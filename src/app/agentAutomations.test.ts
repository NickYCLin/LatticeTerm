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
  triggerDependents,
  updateAutomation,
  validateAutomationDraft,
  type AutomationDraft,
  mergeBackgroundStatus,
  recordBackgroundRun,
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

  it("has no time of its own for a chained automation", () => {
    expect(
      nextRunAfter({ kind: "after", automationId: "a", onlyOnSuccess: true }, wednesday(8)),
    ).toBeNull();
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
    expect(next?.getDay()).toBe(1);
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

  it("checks a chain for a missing source, itself, and a cycle", () => {
    const a = createAutomation(draft({ name: "A" }), "a", wednesday(8));
    const bAfterA = createAutomation(
      draft({ name: "B", schedule: { kind: "after", automationId: "a", onlyOnSuccess: true } }),
      "b",
      wednesday(8),
    );
    const after = (automationId: string) =>
      draft({ schedule: { kind: "after", automationId, onlyOnSuccess: false } });

    expect(validateAutomationDraft(after(""), [a]).after).toBe("required");
    expect(validateAutomationDraft(after("zzz"), [a]).after).toBe("missing");
    expect(validateAutomationDraft(after("a"), [a], "a").after).toBe("cycle");
    // Editing A to follow B, while B already follows A.
    expect(validateAutomationDraft(after("b"), [a, bAfterA], "a").after).toBe("cycle");
    expect(validateAutomationDraft(after("a"), [a], "c").after).toBeUndefined();
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

  it("makes a chained automation due when its source ends, respecting the success rule", () => {
    // Created after its 09:00 slot, so the source itself is not due today
    // and only the chained ones show up below.
    const source = createAutomation(draft({ name: "A" }), "a", wednesday(9, 30));
    const always = createAutomation(
      draft({ name: "B", schedule: { kind: "after", automationId: "a", onlyOnSuccess: false } }),
      "b",
      wednesday(8),
    );
    const onlyOk = createAutomation(
      draft({ name: "C", schedule: { kind: "after", automationId: "a", onlyOnSuccess: true } }),
      "c",
      wednesday(8),
    );
    expect(always.nextRunAt).toBeNull();
    // Only the timed source is due; a chained one waits for its trigger.
    // Only the timed source is due; a chained one waits for its trigger.
    expect(dueAutomations([source, always, onlyOk], wednesday(23).getTime())).toEqual([]);

    const failed = triggerDependents([source, always, onlyOk], "a", "error", wednesday(9));
    expect(failed.map((entry) => entry.nextRunAt)).toEqual([
      source.nextRunAt,
      wednesday(9).getTime(),
      null,
    ]);

    const succeeded = triggerDependents([source, always, onlyOk], "a", "ok", wednesday(9));
    expect(dueAutomations(succeeded, wednesday(9).getTime()).map((entry) => entry.id)).toEqual([
      "b",
      "c",
    ]);

    // Starting consumes the due mark; it does not schedule a next time.
    const started = beginAutomationRun(succeeded[1], { runId: "r", threadId: "t" }, wednesday(9), true);
    expect(started.nextRunAt).toBeNull();
  });

  it("never lets more than the cap start at once, and keeps the rest due", () => {
    const due = [1, 2, 3, 4].map((n) =>
      createAutomation(
        draft({ name: `A${n}`, schedule: { kind: "interval", everyMinutes: 60 } }),
        `a${n}`,
        wednesday(7, n),
      ),
    );
    const picked = dueAutomations(due, wednesday(9).getTime());
    expect(picked.map((entry) => entry.id)).toEqual(["a1", "a2"]);
    // Two already running (or reserved) leaves no room.
    expect(dueAutomations(due, wednesday(9).getTime(), 2)).toEqual([]);
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

describe("background runs", () => {
  const base = createAutomation(
    {
      name: "nightly",
      instructions: "summarize",
      definitionId: "codex",
      workingDirectory: "/work",
      permission: "readOnly",
      model: "",
      schedule: { kind: "interval", everyMinutes: 60 },
    },
    "a",
    new Date(1_000),
  );
  const record = {
    runId: "bg-run-1",
    automationId: "a",
    automationName: "nightly",
    threadId: "bg-thread-1",
    turnId: "bg-turn-1",
    definitionId: "codex" as const,
    workingDirectory: "/work",
    permission: "readOnly" as const,
    model: "",
    instructions: "summarize",
    startedAt: 5_000,
    finishedAt: 6_000,
    outcome: "ok" as const,
    error: null,
    events: [],
  };

  it("files a service run once, pointing at the imported thread", () => {
    const once = recordBackgroundRun(base, record, "thread-x", 7_000);
    expect(once.runs).toHaveLength(1);
    expect(once.runs[0]).toMatchObject({ runId: "bg-run-1", threadId: "thread-x", outcome: "ok" });
    expect(once.lastRunAt).toBe(5_000);
    expect(recordBackgroundRun(once, record, "thread-y", 8_000)).toBe(once);
  });

  it("takes the service's marks only where it got further", () => {
    const untouched = mergeBackgroundStatus(
      [base],
      [{ id: "a", nextRunAt: 999, lastRunAt: null, running: false }],
    );
    expect(untouched[0]).toBe(base);
    const merged = mergeBackgroundStatus(
      [base],
      [{ id: "a", nextRunAt: 9_000, lastRunAt: 5_000, running: true }],
    );
    expect(merged[0].lastRunAt).toBe(5_000);
    expect(merged[0].nextRunAt).toBe(9_000);
    const chained = { ...base, id: "b", schedule: { kind: "after" as const, automationId: "a", onlyOnSuccess: false }, nextRunAt: null };
    const due = mergeBackgroundStatus(
      [chained],
      [{ id: "b", nextRunAt: 6_000, lastRunAt: null, running: false }],
    );
    expect(due[0].nextRunAt).toBe(6_000);
  });
});

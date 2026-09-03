/**
 * Scheduled chat runs, modelled on the Codex app's Automations: a name, the
 * instructions to send, a project, a CLI, and a schedule. Each run opens a
 * fresh chat thread so the result is reviewed like any other conversation,
 * and the thread list works as the inbox.
 *
 * Runs happen only while LatticeTerm is open: there is no daemon, so a
 * schedule that fell due while the app was closed runs once at the next
 * start and then continues from there. Unattended runs never use the
 * ask-each-time permission, because nobody is there to answer.
 *
 * Pure rules only; `useAgentAutomations` wires them to the clock and to
 * chat mode.
 */

import type { ChatDefinitionId, ChatPermission } from "./agentChat";

export type AutomationSchedule =
  | {
      kind: "daily";
      /** Local wall-clock time, `HH:MM`. */
      time: string;
      /** Days of the week as `Date.getDay()` numbers; empty means every day. */
      weekdays: number[];
    }
  | { kind: "interval"; everyMinutes: number };

export type AutomationRunOutcome = "running" | "ok" | "error" | "stopped";

export interface AutomationRun {
  runId: string;
  threadId: string;
  startedAt: number;
  finishedAt: number | null;
  outcome: AutomationRunOutcome;
  error: string | null;
}

export interface Automation {
  id: string;
  name: string;
  instructions: string;
  definitionId: ChatDefinitionId;
  workingDirectory: string;
  permission: ChatPermission;
  model: string;
  schedule: AutomationSchedule;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  /** Next due time, or null while paused. */
  nextRunAt: number | null;
  lastRunAt: number | null;
  /** Most recent runs, newest first. */
  runs: AutomationRun[];
}

export type AutomationDraft = Pick<
  Automation,
  | "name"
  | "instructions"
  | "definitionId"
  | "workingDirectory"
  | "permission"
  | "model"
  | "schedule"
>;

export const automationLimits = {
  nameLength: 60,
  instructionsBytes: 8 * 1024,
  minIntervalMinutes: 15,
  maxIntervalMinutes: 7 * 24 * 60,
  runsKept: 20,
  count: 50,
} as const;

export type AutomationField =
  | "name"
  | "instructions"
  | "workingDirectory"
  | "permission"
  | "time"
  | "weekdays"
  | "everyMinutes";

export type AutomationErrors = Partial<Record<AutomationField, string>>;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function validateAutomationDraft(draft: AutomationDraft): AutomationErrors {
  const errors: AutomationErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "required";
  else if (name.length > automationLimits.nameLength) errors.name = "tooLong";

  const instructions = draft.instructions.trim();
  if (!instructions) errors.instructions = "required";
  else if (new TextEncoder().encode(instructions).length > automationLimits.instructionsBytes) {
    errors.instructions = "tooLong";
  }

  if (!draft.workingDirectory.trim()) errors.workingDirectory = "required";
  // Nobody is there to answer a prompt in an unattended run.
  if (draft.permission === "ask") errors.permission = "unattended";

  if (draft.schedule.kind === "daily") {
    if (!TIME.test(draft.schedule.time)) errors.time = "invalid";
    if (draft.schedule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      errors.weekdays = "invalid";
    }
  } else {
    const minutes = draft.schedule.everyMinutes;
    if (
      !Number.isInteger(minutes) ||
      minutes < automationLimits.minIntervalMinutes ||
      minutes > automationLimits.maxIntervalMinutes
    ) {
      errors.everyMinutes = "range";
    }
  }
  return errors;
}

/**
 * The first time the schedule fires strictly after `after`, in local time.
 * A daily schedule scans at most eight days ahead, which always contains
 * one allowed weekday.
 */
export function nextRunAfter(schedule: AutomationSchedule, after: Date): Date {
  if (schedule.kind === "interval") {
    return new Date(after.getTime() + schedule.everyMinutes * 60_000);
  }
  const match = TIME.exec(schedule.time);
  const hours = match ? Number(match[1]) : 0;
  const minutes = match ? Number(match[2]) : 0;
  const allowed = new Set(schedule.weekdays);
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = new Date(
      after.getFullYear(),
      after.getMonth(),
      after.getDate() + offset,
      hours,
      minutes,
      0,
      0,
    );
    if (candidate.getTime() <= after.getTime()) continue;
    if (allowed.size === 0 || allowed.has(candidate.getDay())) return candidate;
  }
  // Unreachable for a valid schedule; a full week from now is the honest
  // fallback rather than never.
  return new Date(after.getTime() + 7 * 24 * 60 * 60_000);
}

export function createAutomation(
  draft: AutomationDraft,
  id: string = crypto.randomUUID(),
  now: Date = new Date(),
): Automation {
  return {
    id,
    name: draft.name.trim(),
    instructions: draft.instructions.trim(),
    definitionId: draft.definitionId,
    workingDirectory: draft.workingDirectory.trim(),
    permission: draft.permission,
    model: draft.model.trim(),
    schedule: draft.schedule,
    enabled: true,
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
    nextRunAt: nextRunAfter(draft.schedule, now).getTime(),
    lastRunAt: null,
    runs: [],
  };
}

/** Applies an edited draft; the next run is recomputed from the new schedule. */
export function updateAutomation(
  automation: Automation,
  draft: AutomationDraft,
  now: Date = new Date(),
): Automation {
  return {
    ...automation,
    name: draft.name.trim(),
    instructions: draft.instructions.trim(),
    definitionId: draft.definitionId,
    workingDirectory: draft.workingDirectory.trim(),
    permission: draft.permission,
    model: draft.model.trim(),
    schedule: draft.schedule,
    updatedAt: now.getTime(),
    nextRunAt: automation.enabled ? nextRunAfter(draft.schedule, now).getTime() : null,
  };
}

export function setAutomationEnabled(
  automation: Automation,
  enabled: boolean,
  now: Date = new Date(),
): Automation {
  return {
    ...automation,
    enabled,
    updatedAt: now.getTime(),
    nextRunAt: enabled ? nextRunAfter(automation.schedule, now).getTime() : null,
  };
}

export function isAutomationRunning(automation: Automation): boolean {
  return automation.runs.some((run) => run.outcome === "running");
}

/**
 * Automations whose time has come. One that is still running is skipped
 * rather than started twice; it catches up when its next time arrives.
 */
export function dueAutomations(automations: Automation[], now: number): Automation[] {
  return automations.filter(
    (automation) =>
      automation.enabled &&
      automation.nextRunAt !== null &&
      automation.nextRunAt <= now &&
      !isAutomationRunning(automation),
  );
}

/**
 * Marks a run as started and moves the schedule past it. Called for both
 * scheduled and "run now" starts; only a scheduled start advances
 * `nextRunAt`, so running early never skips the planned time.
 */
export function beginAutomationRun(
  automation: Automation,
  run: Pick<AutomationRun, "runId" | "threadId">,
  now: Date,
  scheduled: boolean,
): Automation {
  const entry: AutomationRun = {
    runId: run.runId,
    threadId: run.threadId,
    startedAt: now.getTime(),
    finishedAt: null,
    outcome: "running",
    error: null,
  };
  return {
    ...automation,
    lastRunAt: now.getTime(),
    nextRunAt:
      scheduled && automation.enabled
        ? nextRunAfter(automation.schedule, now).getTime()
        : automation.nextRunAt,
    runs: [entry, ...automation.runs].slice(0, automationLimits.runsKept),
    updatedAt: now.getTime(),
  };
}

export function finishAutomationRun(
  automation: Automation,
  runId: string,
  outcome: Exclude<AutomationRunOutcome, "running">,
  error: string | null,
  now: Date = new Date(),
): Automation {
  return {
    ...automation,
    runs: automation.runs.map((run) =>
      run.runId === runId && run.outcome === "running"
        ? { ...run, outcome, error, finishedAt: now.getTime() }
        : run,
    ),
    updatedAt: now.getTime(),
  };
}

/** Whatever was "running" when the app last closed cannot still be. */
export function closeStaleRuns(automation: Automation): Automation {
  if (!isAutomationRunning(automation)) return automation;
  return {
    ...automation,
    runs: automation.runs.map((run) =>
      run.outcome === "running"
        ? { ...run, outcome: "stopped", error: null, finishedAt: run.startedAt }
        : run,
    ),
  };
}

const STORAGE_KEY = "latticeterm.agentAutomations.v1";

function isSchedule(value: unknown): value is AutomationSchedule {
  if (!value || typeof value !== "object") return false;
  const schedule = value as Partial<AutomationSchedule> & { kind?: string };
  if (schedule.kind === "daily") {
    return (
      typeof (schedule as { time?: unknown }).time === "string" &&
      Array.isArray((schedule as { weekdays?: unknown }).weekdays)
    );
  }
  if (schedule.kind === "interval") {
    return typeof (schedule as { everyMinutes?: unknown }).everyMinutes === "number";
  }
  return false;
}

function isAutomation(value: unknown): value is Automation {
  if (!value || typeof value !== "object") return false;
  const automation = value as Partial<Automation>;
  return (
    typeof automation.id === "string" &&
    typeof automation.name === "string" &&
    typeof automation.instructions === "string" &&
    (automation.definitionId === "claude" || automation.definitionId === "codex") &&
    typeof automation.workingDirectory === "string" &&
    typeof automation.permission === "string" &&
    isSchedule(automation.schedule) &&
    Array.isArray(automation.runs)
  );
}

export function loadStoredAutomations(storage: Pick<Storage, "getItem">): Automation[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAutomation).map((automation) =>
      closeStaleRuns({
        ...automation,
        model: typeof automation.model === "string" ? automation.model : "",
        enabled: automation.enabled !== false,
        createdAt: typeof automation.createdAt === "number" ? automation.createdAt : 0,
        updatedAt: typeof automation.updatedAt === "number" ? automation.updatedAt : 0,
        nextRunAt: typeof automation.nextRunAt === "number" ? automation.nextRunAt : null,
        lastRunAt: typeof automation.lastRunAt === "number" ? automation.lastRunAt : null,
        // A stored "ask" cannot run unattended; the read-only sandbox is the
        // one choice that changes nothing without being told.
        permission: automation.permission === "ask" ? "readOnly" : automation.permission,
      }),
    );
  } catch {
    return [];
  }
}

export function saveStoredAutomations(
  storage: Pick<Storage, "setItem" | "removeItem">,
  automations: Automation[],
): void {
  try {
    if (automations.length === 0) {
      storage.removeItem(STORAGE_KEY);
      return;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(automations.slice(0, automationLimits.count)));
  } catch {
    // Storage full or unavailable: schedules still work for this session.
  }
}

export function emptyAutomationDraft(
  defaults: Partial<AutomationDraft> = {},
): AutomationDraft {
  return {
    name: "",
    instructions: "",
    definitionId: "claude",
    workingDirectory: "",
    permission: "readOnly",
    model: "",
    schedule: { kind: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] },
    ...defaults,
  };
}

export function draftFromAutomation(automation: Automation): AutomationDraft {
  return {
    name: automation.name,
    instructions: automation.instructions,
    definitionId: automation.definitionId,
    workingDirectory: automation.workingDirectory,
    permission: automation.permission,
    model: automation.model,
    schedule: automation.schedule,
  };
}

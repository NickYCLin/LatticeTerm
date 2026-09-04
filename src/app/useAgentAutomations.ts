/**
 * Runs scheduled automations through chat mode.
 *
 * A tick every half minute asks the pure model what is due, opens a chat
 * thread for each run and sends the instructions. The thread's own turn
 * lifecycle reports back: when it ends, the run's outcome is recorded and
 * the thread is flagged unread so the thread list works as an inbox.
 *
 * Mounted at the application root, not in the chat view, so schedules keep
 * firing while another view is open.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  beginAutomationRun,
  createAutomation,
  dueAutomations,
  finishAutomationRun,
  isAutomationRunning,
  loadStoredAutomations,
  saveStoredAutomations,
  setAutomationEnabled,
  triggerDependents,
  updateAutomation,
  type Automation,
  type AutomationDraft,
} from "./agentAutomations";
import { hasDesktopBackend } from "./nativeRuntime";
import type { AgentChatApi } from "./useAgentChat";

const TICK_MS = 30_000;

export interface AgentAutomationsApi {
  automations: Automation[];
  create: (draft: AutomationDraft) => Automation;
  update: (id: string, draft: AutomationDraft) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  remove: (id: string) => void;
  /** Starts a run right away without touching the planned time. */
  runNow: (id: string) => void;
  /** Runs that ended and have not been opened yet. */
  unreadCount: number;
}

function runTitle(automation: Automation, at: Date, locale: string): string {
  const stamp = new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  return `${automation.name} · ${stamp}`;
}

export function useAgentAutomations(chat: AgentChatApi, locale: string): AgentAutomationsApi {
  const [automations, setAutomations] = useState<Automation[]>(() =>
    typeof localStorage === "undefined" ? [] : loadStoredAutomations(localStorage),
  );
  const automationsRef = useRef(automations);
  automationsRef.current = automations;
  const chatRef = useRef(chat);
  chatRef.current = chat;
  // Starts whose run entry is not in state yet. They count against the cap
  // so two ticks in one render cycle cannot overshoot it.
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    saveStoredAutomations(localStorage, automations);
  }, [automations]);

  const start = useCallback(
    (automation: Automation, scheduled: boolean) => {
      const now = new Date();
      const thread = chatRef.current.createThread({
        definitionId: automation.definitionId,
        workingDirectory: automation.workingDirectory,
        // Never "ask": nobody is there to answer. The model already refuses
        // to store one, but a stale value must not reach the CLI either.
        permission: automation.permission === "ask" ? "readOnly" : automation.permission,
        model: automation.model,
        title: runTitle(automation, now, locale),
        automationId: automation.id,
        activate: false,
      });
      const runId = crypto.randomUUID();
      inFlight.current.add(automation.id);
      setAutomations((current) =>
        current.map((entry) =>
          entry.id === automation.id
            ? beginAutomationRun(entry, { runId, threadId: thread.id }, now, scheduled)
            : entry,
        ),
      );
      void chatRef.current.send(thread.id, automation.instructions);
    },
    [locale],
  );

  const tick = useCallback(() => {
    if (!hasDesktopBackend()) return;
    const current = automationsRef.current;
    for (const id of inFlight.current) {
      const entry = current.find((automation) => automation.id === id);
      if (!entry || isAutomationRunning(entry)) inFlight.current.delete(id);
    }
    for (const automation of dueAutomations(current, Date.now(), inFlight.current.size)) {
      if (inFlight.current.has(automation.id)) continue;
      start(automation, true);
    }
  }, [start]);

  // The clock. Only the desktop backend can run a CLI, so the browser
  // preview never ticks. A change to the list (a run ending frees a slot,
  // a chained automation becoming due) is checked at once rather than at
  // the next half minute.
  useEffect(() => {
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [tick]);

  useEffect(() => {
    tick();
  }, [automations, tick]);

  // A run ends when its thread's turn does. The thread's last item says
  // how; the thread is then news until someone opens it.
  useEffect(() => {
    for (const automation of automationsRef.current) {
      if (!isAutomationRunning(automation)) continue;
      for (const run of automation.runs) {
        if (run.outcome !== "running") continue;
        const thread = chat.threads.find((entry) => entry.id === run.threadId);
        if (!thread) {
          setAutomations((current) =>
            current.map((entry) =>
              entry.id === automation.id
                ? finishAutomationRun(entry, run.runId, "stopped", null)
                : entry,
            ),
          );
          continue;
        }
        if (thread.runningTurnId !== null) continue;
        const last = thread.items[thread.items.length - 1];
        if (!last || last.type !== "turnEnd") continue;
        const outcome = last.error === null ? "ok" : "error";
        setAutomations((current) =>
          triggerDependents(
            current.map((entry) =>
              entry.id === automation.id
                ? finishAutomationRun(entry, run.runId, outcome, last.error)
                : entry,
            ),
            automation.id,
            outcome,
          ),
        );
        if (chat.activeThreadId !== thread.id) chat.markUnread(thread.id, true);
      }
    }
  }, [chat]);

  const create = useCallback((draft: AutomationDraft) => {
    const automation = createAutomation(draft);
    setAutomations((current) => [automation, ...current]);
    return automation;
  }, []);

  const update = useCallback((id: string, draft: AutomationDraft) => {
    setAutomations((current) =>
      current.map((entry) => (entry.id === id ? updateAutomation(entry, draft) : entry)),
    );
  }, []);

  const setEnabled = useCallback((id: string, enabled: boolean) => {
    setAutomations((current) =>
      current.map((entry) => (entry.id === id ? setAutomationEnabled(entry, enabled) : entry)),
    );
  }, []);

  const remove = useCallback((id: string) => {
    setAutomations((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const runNow = useCallback(
    (id: string) => {
      const automation = automationsRef.current.find((entry) => entry.id === id);
      if (!automation || isAutomationRunning(automation)) return;
      start(automation, false);
    },
    [start],
  );

  const unreadCount = useMemo(
    () => chat.threads.filter((thread) => thread.automationId !== null && thread.unread).length,
    [chat.threads],
  );

  return useMemo(
    () => ({ automations, create, update, setEnabled, remove, runNow, unreadCount }),
    [automations, create, update, setEnabled, remove, runNow, unreadCount],
  );
}

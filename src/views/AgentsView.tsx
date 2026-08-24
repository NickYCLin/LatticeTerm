import { useEffect, useMemo, useState } from "react";
import type {
  AgentApi,
  AgentDefinition,
  AgentLaunchPlan,
  AgentSessionSummary,
} from "../app/useAgentSessions";
import {
  MAX_AGENT_BROADCAST_TARGETS,
  MAX_SAVED_AGENT_PLANS,
  moveAgentLaunchPlan,
  splitAgentArguments,
} from "../app/useAgentSessions";
import { Callout } from "../components/common/Callout";
import { ConfirmDialog } from "../components/overlays/ConfirmDialog";
import {
  AgentIcon,
  ChevronDownIcon,
  EditIcon,
  FolderIcon,
  MemoryIcon,
  PlayIcon,
  RefreshIcon,
  StopIcon,
  TerminalIcon,
  TrashIcon,
  TransferIcon,
} from "../components/icons";
import { useI18n } from "../i18n/context";
import type { MessageKey } from "../i18n/messages/zh-TW";

function stateKey(session: AgentSessionSummary): MessageKey {
  switch (session.state) {
    case "needsAttention":
      return "agents.state.needsAttention";
    case "idle":
      return "agents.state.idle";
    case "done":
      return "agents.state.done";
    default:
      return "agents.state.working";
  }
}

function stateTone(session: AgentSessionSummary): string {
  if (session.state === "needsAttention") return "tone-warn";
  if (session.state === "idle") return "tone-neutral";
  return "tone-ok";
}

export function AgentsView({
  agents,
  onOpen,
}: {
  agents: AgentApi;
  onOpen: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [launchNote, setLaunchNote] = useState("");
  const [launching, setLaunching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [customExecutable, setCustomExecutable] = useState("");
  const [customArguments, setCustomArguments] = useState("");
  const [resumeDefinitionId, setResumeDefinitionId] = useState("");
  const [resumeSessionId, setResumeSessionId] = useState("");
  const [resumeNote, setResumeNote] = useState("");
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [editingWorkspaceName, setEditingWorkspaceName] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [savingWorkspaceName, setSavingWorkspaceName] = useState(false);
  const [reorderingPlanId, setReorderingPlanId] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<string[] | null>(null);
  const [pendingDeletePlan, setPendingDeletePlan] =
    useState<AgentLaunchPlan | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<{
    saved?: string;
    renamed?: string;
    restored?: number;
    failed?: number;
    detail?: string;
  } | null>(null);
  const [pendingStop, setPendingStop] = useState<AgentSessionSummary | null>(null);
  const [selectedBroadcastIds, setSelectedBroadcastIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [broadcastPrompt, setBroadcastPrompt] = useState("");
  const [pendingBroadcast, setPendingBroadcast] = useState<string[] | null>(null);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastNotice, setBroadcastNotice] = useState<{
    delivered: number;
    failed: number;
    detail: string;
  } | null>(null);

  useEffect(() => {
    if (!workingDirectory && agents.defaultWorkingDirectory) {
      setWorkingDirectory(agents.defaultWorkingDirectory);
    }
  }, [agents.defaultWorkingDirectory, workingDirectory]);

  useEffect(() => {
    if (!editingWorkspaceName) {
      setWorkspaceNameDraft(agents.workspaceName);
    }
  }, [agents.workspaceName, editingWorkspaceName]);

  useEffect(() => {
    const activeIds = new Set(agents.sessions.map((session) => session.sessionId));
    setSelectedBroadcastIds((current) => {
      const next = new Set(
        [...current].filter((sessionId) => activeIds.has(sessionId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [agents.sessions]);

  const installedCount = useMemo(
    () => agents.catalog.filter((definition) => definition.installed).length,
    [agents.catalog],
  );
  const attentionCount = useMemo(
    () =>
      agents.sessions.filter((session) => session.state === "needsAttention")
        .length,
    [agents.sessions],
  );
  const resumeDefinitions = useMemo(
    () => agents.catalog.filter((definition) => definition.resumeSupported),
    [agents.catalog],
  );
  const resumeDefinition = useMemo(
    () =>
      resumeDefinitions.find(
        (definition) => definition.id === resumeDefinitionId,
      ) ?? null,
    [resumeDefinitionId, resumeDefinitions],
  );
  // Session ids the running CLIs announced themselves — one click to reuse
  // instead of hunting through another tool's history.
  const resumeDefaultLabel = resumeDefinition?.label ?? "";
  const capturedResumeIds = useMemo(() => {
    const seen = new Set<string>();
    return agents.sessions
      .filter(
        (session) =>
          session.definitionId === resumeDefinitionId &&
          session.capturedSessionId,
      )
      .map((session) => ({
        id: session.capturedSessionId as string,
        // A renamed tab becomes the note default; the plain CLI name is not
        // worth carrying (it says nothing the row does not already show).
        note: session.label === resumeDefaultLabel ? "" : session.label,
      }))
      .filter((entry) => (seen.has(entry.id) ? false : (seen.add(entry.id), true)));
  }, [agents.sessions, resumeDefinitionId, resumeDefaultLabel]);

  useEffect(() => {
    if (
      resumeDefinitions.length > 0 &&
      !resumeDefinitions.some(
        (definition) => definition.id === resumeDefinitionId,
      )
    ) {
      setResumeDefinitionId(
        resumeDefinitions.find((definition) => definition.installed)?.id ??
          resumeDefinitions[0].id,
      );
    }
  }, [resumeDefinitionId, resumeDefinitions]);

  function launchDraft(
    definition: AgentDefinition | null,
    custom = false,
  ) {
    return {
      definitionId: custom ? "custom" : (definition?.id ?? ""),
      label: custom ? customLabel : "",
      executable: custom ? customExecutable : "",
      arguments: custom ? splitAgentArguments(customArguments) : [],
      resumeSessionId: null,
      note: launchNote.trim(),
      workingDirectory,
    };
  }

  function nativeResumeDraft(definition: AgentDefinition) {
    return {
      definitionId: definition.id,
      label: "",
      executable: "",
      arguments: [],
      resumeSessionId: resumeSessionId.trim(),
      note: resumeNote.trim(),
      workingDirectory,
    };
  }

  async function launch(
    definition: AgentDefinition | null,
    custom = false,
  ) {
    const id = custom ? "custom" : (definition?.id ?? "");
    setLaunching(id);
    setError(null);
    try {
      const session = await agents.launch({
        ...launchDraft(definition, custom),
        cols: 120,
        rows: 32,
      });
      onOpen(session.sessionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLaunching(null);
    }
  }

  async function savePlan(
    definition: AgentDefinition | null,
    custom = false,
  ) {
    const id = custom ? "custom" : (definition?.id ?? "");
    setSaving(id);
    setError(null);
    setWorkspaceNotice(null);
    try {
      const plan = await agents.savePlan(launchDraft(definition, custom));
      setWorkspaceNotice({ saved: plan.label });
      setLaunchNote("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(null);
    }
  }

  async function launchNativeResume() {
    if (!resumeDefinition) return;
    const actionId = `resume:${resumeDefinition.id}`;
    setLaunching(actionId);
    setError(null);
    setResumeNotice(null);
    try {
      const session = await agents.launch({
        ...nativeResumeDraft(resumeDefinition),
        cols: 120,
        rows: 32,
      });
      onOpen(session.sessionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLaunching(null);
    }
  }

  async function saveNativeResumePlan() {
    if (!resumeDefinition) return;
    const actionId = `resume:${resumeDefinition.id}`;
    setSaving(actionId);
    setError(null);
    setResumeNotice(null);
    try {
      const plan = await agents.savePlan(nativeResumeDraft(resumeDefinition));
      setResumeNotice(plan.label);
      setResumeNote("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(null);
    }
  }

  async function confirmRestorePlans() {
    const planIds = pendingRestore;
    if (!planIds) return;
    setPendingRestore(null);
    setRestoring(true);
    setError(null);
    setWorkspaceNotice(null);
    try {
      const outcomes = await agents.restorePlans(planIds);
      const failures = outcomes.filter((outcome) => !outcome.session);
      setWorkspaceNotice({
        restored: outcomes.length - failures.length,
        failed: failures.length,
        detail: failures
          .map((outcome) =>
            outcome.error ? `${outcome.label}: ${outcome.error}` : "",
          )
          .filter(Boolean)
          .join("; "),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRestoring(false);
    }
  }

  async function confirmDeletePlan() {
    const plan = pendingDeletePlan;
    if (!plan) return;
    setPendingDeletePlan(null);
    setError(null);
    setWorkspaceNotice(null);
    try {
      await agents.deletePlan(plan.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function saveWorkspaceName() {
    setSavingWorkspaceName(true);
    setError(null);
    setWorkspaceNotice(null);
    try {
      const name = await agents.renameWorkspace(workspaceNameDraft);
      setWorkspaceNameDraft(name);
      setEditingWorkspaceName(false);
      setWorkspaceNotice({ renamed: name });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingWorkspaceName(false);
    }
  }

  async function movePlan(planId: string, offset: -1 | 1) {
    const reordered = moveAgentLaunchPlan(agents.plans, planId, offset);
    if (reordered === agents.plans) return;
    setReorderingPlanId(planId);
    setError(null);
    setWorkspaceNotice(null);
    try {
      await agents.reorderPlans(reordered.map((plan) => plan.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setReorderingPlanId(null);
    }
  }

  const launchDisabled =
    agents.mode !== "ready" || !workingDirectory.trim() || launching !== null;
  const planLimitReached = agents.plans.length >= MAX_SAVED_AGENT_PLANS;
  const saveDisabled =
    agents.mode !== "ready" ||
    !workingDirectory.trim() ||
    saving !== null ||
    planLimitReached;
  const broadcastCandidates = agents.sessions.slice(
    0,
    MAX_AGENT_BROADCAST_TARGETS,
  );
  const allBroadcastTargetsSelected =
    broadcastCandidates.length > 0 &&
    broadcastCandidates.every((session) =>
      selectedBroadcastIds.has(session.sessionId),
    );

  function toggleBroadcastTarget(sessionId: string) {
    setSelectedBroadcastIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
    setBroadcastNotice(null);
  }

  function toggleAllBroadcastTargets() {
    setSelectedBroadcastIds(
      allBroadcastTargetsSelected
        ? new Set()
        : new Set(
            broadcastCandidates.map((session) => session.sessionId),
          ),
    );
    setBroadcastNotice(null);
  }

  async function confirmBroadcast() {
    const targets = pendingBroadcast;
    if (!targets) return;
    setPendingBroadcast(null);
    setBroadcasting(true);
    setBroadcastNotice(null);
    try {
      const outcomes = await agents.broadcast(targets, broadcastPrompt);
      const failures = outcomes.filter((outcome) => !outcome.delivered);
      const delivered = outcomes.length - failures.length;
      setBroadcastNotice({
        delivered,
        failed: failures.length,
        detail: failures
          .map((outcome) => outcome.error)
          .filter(Boolean)
          .join("; "),
      });
      if (failures.length === 0) setBroadcastPrompt("");
    } catch (reason) {
      setBroadcastNotice({
        delivered: 0,
        failed: targets.length,
        detail: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setBroadcasting(false);
    }
  }

  return (
    <div className="agents-view">
      <section className="agents-hero">
        <div>
          <span className="eyebrow">{t("agents.hero.eyebrow")}</span>
          <h2>{t("agents.hero.title")}</h2>
          <p>{t("agents.hero.body")}</p>
        </div>
        <dl className="agents-stats">
          <div>
            <dt>{t("agents.stats.installed")}</dt>
            <dd>{installedCount}</dd>
          </div>
          <div>
            <dt>{t("agents.stats.running")}</dt>
            <dd>{agents.sessions.length}</dd>
          </div>
          <div className={attentionCount > 0 ? "is-attention" : ""}>
            <dt>{t("agents.stats.attention")}</dt>
            <dd>{attentionCount}</dd>
          </div>
        </dl>
      </section>

      <Callout tone="security" title={t("agents.security.title")}>
        {t("agents.security.body")}
      </Callout>

      {agents.mode === "unavailable" && (
        <Callout tone="planned" title={t("agents.backend.unavailable.title")}>
          {t("agents.backend.unavailable.body")}
        </Callout>
      )}
      {error && (
        <Callout tone="danger" title={t("agents.operation.failed")}>
          <span className="mono">{error}</span>
        </Callout>
      )}

      <section className="agents-directory">
        <div className="agents-section-heading">
          <div>
            <span className="eyebrow">{t("agents.directory.eyebrow")}</span>
            <h3>{t("agents.directory.title")}</h3>
          </div>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => void agents.refreshCatalog()}
            disabled={agents.mode === "loading"}
          >
            <RefreshIcon size={13} />
            {t("agents.directory.refresh")}
          </button>
        </div>

        <label className="field agents-cwd">
          <span className="field__label">
            <FolderIcon size={13} />
            {t("agents.cwd")}
          </span>
          <input
            className="input mono"
            value={workingDirectory}
            onChange={(event) => setWorkingDirectory(event.currentTarget.value)}
            placeholder={t("agents.cwd.placeholder")}
            spellCheck={false}
          />
          <span className="agents-field-hint">{t("agents.cwd.hint")}</span>
        </label>

        <label className="field agents-cwd">
          <span className="field__label">{t("agents.launchNote")}</span>
          <input
            className="input"
            value={launchNote}
            onChange={(event) => setLaunchNote(event.currentTarget.value)}
            placeholder={t("agents.launchNote.placeholder")}
            maxLength={200}
          />
          <span className="agents-field-hint">{t("agents.launchNote.hint")}</span>
        </label>

        <div className="agent-grid">
          {agents.catalog.map((definition) => (
            <article
              className={`agent-card${definition.installed ? "" : " is-missing"}`}
              key={definition.id}
            >
              <div className="agent-card__icon">
                <AgentIcon size={20} />
              </div>
              <div className="agent-card__body">
                <div className="agent-card__title">
                  <strong>{definition.label}</strong>
                  <span
                    className={`badge ${definition.installed ? "tone-ok" : "tone-neutral"}`}
                  >
                    {t(
                      definition.installed
                        ? "agents.installed"
                        : "agents.notInstalled",
                    )}
                  </span>
                </div>
                <code>{definition.executable}</code>
                <span className="agent-card__path">
                  {definition.installedPath ?? t("agents.path.missing")}
                </span>
              </div>
              <div className="agent-card__actions">
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  disabled={saveDisabled}
                  onClick={() => void savePlan(definition)}
                >
                  <MemoryIcon size={12} />
                  {saving === definition.id
                    ? t("agents.workspace.saving")
                    : t("agents.workspace.save")}
                </button>
                <button
                  type="button"
                  className="button button--secondary button--sm"
                  disabled={launchDisabled || !definition.installed}
                  onClick={() => void launch(definition)}
                >
                  <PlayIcon size={12} />
                  {launching === definition.id
                    ? t("agents.launching")
                    : t("agents.launch")}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="agents-resume">
        <div className="agents-section-heading">
          <div>
            <span className="eyebrow">{t("agents.resume.eyebrow")}</span>
            <h3>{t("agents.resume.title")}</h3>
            <p>{t("agents.resume.body")}</p>
          </div>
        </div>

        <Callout tone="security" title={t("agents.resume.securityTitle")}>
          {t("agents.resume.securityBody")}
        </Callout>

        {resumeNotice && (
          <Callout tone="info" title={t("agents.resume.savedTitle")}>
            {t("agents.resume.savedBody", { name: resumeNotice })}
          </Callout>
        )}

        <div className="agents-resume__fields">
          <label className="field">
            <span className="field__label">{t("agents.resume.cli")}</span>
            <select
              className="select"
              value={resumeDefinitionId}
              onChange={(event) => {
                setResumeDefinitionId(event.currentTarget.value);
                setResumeNotice(null);
              }}
              disabled={resumeDefinitions.length === 0}
            >
              {resumeDefinitions.map((definition) => (
                <option value={definition.id} key={definition.id}>
                  {definition.label} · {t(
                    definition.installed
                      ? "agents.installed"
                      : "agents.notInstalled",
                  )}
                </option>
              ))}
            </select>
            <span className="agents-field-hint">
              {t("agents.resume.adapterVersion", {
                version: resumeDefinition?.adapterVersion ?? 1,
              })}
            </span>
          </label>
          <label className="field agents-resume__session">
            <span className="field__label">
              {t("agents.resume.sessionId")}
            </span>
            <input
              className="input mono"
              value={resumeSessionId}
              onChange={(event) => {
                setResumeSessionId(event.currentTarget.value);
                setResumeNotice(null);
              }}
              placeholder={t("agents.resume.sessionId.placeholder")}
              maxLength={512}
              spellCheck={false}
            />
            <span className="agents-field-hint">
              {t("agents.resume.sessionId.hint")}
            </span>
            {capturedResumeIds.length > 0 && (
              <span
                className="agents-field-hint"
                style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", alignItems: "center" }}
              >
                {t("agents.resume.captured")}
                {capturedResumeIds.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="button button--ghost"
                    style={{ padding: "0.1rem 0.5rem", height: "auto", fontSize: "var(--text-2xs)" }}
                    onClick={() => {
                      setResumeSessionId(entry.id);
                      // Carry a renamed tab's name into the note, unless the
                      // user already typed one.
                      if (entry.note && !resumeNote.trim()) setResumeNote(entry.note);
                      setResumeNotice(null);
                    }}
                    title={entry.note || undefined}
                  >
                    <code className="mono">{entry.id.slice(0, 8)}…</code>
                    {entry.note && <span> · {entry.note}</span>}
                  </button>
                ))}
              </span>
            )}
          </label>
          <label className="field agents-resume__note">
            <span className="field__label">{t("agents.resume.note")}</span>
            <input
              className="input"
              value={resumeNote}
              onChange={(event) => {
                setResumeNote(event.currentTarget.value);
                setResumeNotice(null);
              }}
              placeholder={t("agents.resume.note.placeholder")}
              maxLength={200}
            />
            <span className="agents-field-hint">
              {t("agents.resume.note.hint")}
            </span>
          </label>
          <div className="agents-resume__actions">
            <button
              type="button"
              className="button button--ghost"
              disabled={
                saveDisabled ||
                !resumeDefinition ||
                !resumeSessionId.trim()
              }
              onClick={() => void saveNativeResumePlan()}
            >
              <MemoryIcon size={13} />
              {saving === `resume:${resumeDefinition?.id}`
                ? t("agents.workspace.saving")
                : t("agents.resume.save")}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={
                launchDisabled ||
                !resumeDefinition?.installed ||
                !resumeSessionId.trim()
              }
              onClick={() => void launchNativeResume()}
            >
              <PlayIcon size={13} />
              {launching === `resume:${resumeDefinition?.id}`
                ? t("agents.resume.resuming")
                : t("agents.resume.launch")}
            </button>
          </div>
        </div>
      </section>

      <section className="agents-custom">
        <div className="agents-section-heading">
          <div>
            <span className="eyebrow">{t("agents.custom.eyebrow")}</span>
            <h3>{t("agents.custom.title")}</h3>
            <p>{t("agents.custom.body")}</p>
          </div>
        </div>
        <div className="agents-custom__fields">
          <label className="field">
            <span className="field__label">{t("agents.custom.label")}</span>
            <input
              className="input"
              value={customLabel}
              onChange={(event) => setCustomLabel(event.currentTarget.value)}
              placeholder={t("agents.custom.label.placeholder")}
            />
          </label>
          <label className="field">
            <span className="field__label">{t("agents.custom.executable")}</span>
            <input
              className="input mono"
              value={customExecutable}
              onChange={(event) =>
                setCustomExecutable(event.currentTarget.value)
              }
              placeholder={t("agents.custom.executable.placeholder")}
              spellCheck={false}
            />
          </label>
          <label className="field agents-custom__arguments">
            <span className="field__label">{t("agents.custom.arguments")}</span>
            <textarea
              className="input mono"
              value={customArguments}
              onChange={(event) =>
                setCustomArguments(event.currentTarget.value)
              }
              placeholder={t("agents.custom.arguments.placeholder")}
              spellCheck={false}
            />
            <span className="agents-field-hint">
              {t("agents.custom.arguments.hint")}
            </span>
          </label>
          <div className="agents-custom__actions">
            <button
              type="button"
              className="button button--ghost"
              disabled={
                saveDisabled ||
                !customLabel.trim() ||
                !customExecutable.trim()
              }
              onClick={() => void savePlan(null, true)}
            >
              <MemoryIcon size={13} />
              {saving === "custom"
                ? t("agents.workspace.saving")
                : t("agents.workspace.save")}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={
                launchDisabled ||
                !customLabel.trim() ||
                !customExecutable.trim()
              }
              onClick={() => void launch(null, true)}
            >
              <PlayIcon size={13} />
              {launching === "custom"
                ? t("agents.launching")
                : t("agents.custom.launch")}
            </button>
          </div>
        </div>
      </section>

      <section className="agents-workspace">
        <div className="agents-section-heading">
          <div className="agents-workspace__identity">
            <span className="eyebrow">{t("agents.workspace.eyebrow")}</span>
            {editingWorkspaceName ? (
              <div className="agents-workspace__name-editor">
                <label className="field">
                  <span className="field__label">
                    {t("agents.workspace.nameLabel")}
                  </span>
                  <input
                    className="input"
                    value={workspaceNameDraft}
                    onChange={(event) =>
                      setWorkspaceNameDraft(event.currentTarget.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && workspaceNameDraft.trim()) {
                        event.preventDefault();
                        void saveWorkspaceName();
                      }
                      if (event.key === "Escape") {
                        setWorkspaceNameDraft(agents.workspaceName);
                        setEditingWorkspaceName(false);
                      }
                    }}
                    maxLength={80}
                    autoFocus
                  />
                  <span className="agents-field-hint">
                    {t("agents.workspace.nameHint")}
                  </span>
                </label>
                <div className="agents-workspace__name-actions">
                  <button
                    type="button"
                    className="button button--primary button--sm"
                    disabled={savingWorkspaceName || !workspaceNameDraft.trim()}
                    onClick={() => void saveWorkspaceName()}
                  >
                    {savingWorkspaceName
                      ? t("agents.workspace.saving")
                      : t("agents.workspace.saveName")}
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    disabled={savingWorkspaceName}
                    onClick={() => {
                      setWorkspaceNameDraft(agents.workspaceName);
                      setEditingWorkspaceName(false);
                    }}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="agents-workspace__name-row">
                <h3>
                  {agents.workspaceName || t("agents.workspace.defaultName")}
                </h3>
                <button
                  type="button"
                  className="icon-button icon-button--sm"
                  disabled={agents.mode !== "ready" || restoring}
                  onClick={() => {
                    setWorkspaceNameDraft(
                      agents.workspaceName || t("agents.workspace.defaultName"),
                    );
                    setEditingWorkspaceName(true);
                  }}
                  aria-label={t("agents.workspace.editName")}
                  data-tooltip={t("agents.workspace.editName")}
                >
                  <EditIcon size={12} />
                </button>
              </div>
            )}
            <p>{t("agents.workspace.body")}</p>
          </div>
          <button
            type="button"
            className="button button--secondary button--sm"
            disabled={
              agents.plans.length === 0 ||
              restoring ||
              agents.mode !== "ready"
            }
            onClick={() =>
              setPendingRestore(agents.plans.map((plan) => plan.id))
            }
          >
            <PlayIcon size={12} />
            {restoring
              ? t("agents.workspace.restoring")
              : t("agents.workspace.restoreAll", {
                  count: agents.plans.length,
                })}
          </button>
        </div>

        <Callout tone="security" title={t("agents.workspace.securityTitle")}>
          {t("agents.workspace.securityBody", {
            count: MAX_SAVED_AGENT_PLANS,
          })}
        </Callout>

        {agents.planRecovery && (
          <Callout tone="warn" title={t("agents.workspace.recoveryTitle")}>
            {t("agents.workspace.recoveryBody", {
              detail: agents.planRecovery.reason,
              path: agents.planRecovery.backupPath,
            })}
          </Callout>
        )}

        {workspaceNotice && (
          <Callout
            tone={(workspaceNotice.failed ?? 0) > 0 ? "danger" : "info"}
            title={t(
              workspaceNotice.saved
                ? "agents.workspace.savedTitle"
                : workspaceNotice.renamed
                  ? "agents.workspace.renamedTitle"
                : (workspaceNotice.failed ?? 0) > 0
                  ? "agents.workspace.partialTitle"
                  : "agents.workspace.restoredTitle",
            )}
          >
            {workspaceNotice.saved
              ? t("agents.workspace.savedBody", {
                  name: workspaceNotice.saved,
                })
              : workspaceNotice.renamed
                ? t("agents.workspace.renamedBody", {
                    name: workspaceNotice.renamed,
                  })
              : t("agents.workspace.restoreResult", {
                  restored: workspaceNotice.restored ?? 0,
                  failed: workspaceNotice.failed ?? 0,
                })}
            {workspaceNotice.detail && (
              <span className="mono agents-workspace__error">
                {workspaceNotice.detail}
              </span>
            )}
          </Callout>
        )}

        {agents.plans.length === 0 ? (
          <p className="agents-running__empty">
            {t("agents.workspace.empty")}
          </p>
        ) : (
          <div className="agent-plan-list">
            {agents.plans.map((plan, index) => (
              <article className="agent-plan-row" key={plan.id}>
                <div className="agent-plan-row__main">
                  <strong>{plan.label}</strong>
                  {plan.note && (
                    <span className="agent-plan-row__note">{plan.note}</span>
                  )}
                  <span className="mono">{plan.workingDirectory}</span>
                  <small>
                    {plan.resumeSessionId
                      ? t("agents.workspace.nativeResumeCommand", {
                          executable: plan.executable,
                        })
                      : t("agents.workspace.command", {
                          executable: plan.executable,
                          count: plan.arguments.length,
                        })}
                  </small>
                </div>
                <div className="agent-plan-row__reorder">
                  <button
                    type="button"
                    className="icon-button icon-button--sm agent-plan-row__move-up"
                    disabled={
                      index === 0 ||
                      restoring ||
                      reorderingPlanId !== null ||
                      agents.mode !== "ready"
                    }
                    onClick={() => void movePlan(plan.id, -1)}
                    aria-label={t("agents.workspace.moveUp", {
                      name: plan.label,
                    })}
                    data-tooltip={t("agents.workspace.moveUp", {
                      name: plan.label,
                    })}
                  >
                    <ChevronDownIcon size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--sm"
                    disabled={
                      index === agents.plans.length - 1 ||
                      restoring ||
                      reorderingPlanId !== null ||
                      agents.mode !== "ready"
                    }
                    onClick={() => void movePlan(plan.id, 1)}
                    aria-label={t("agents.workspace.moveDown", {
                      name: plan.label,
                    })}
                    data-tooltip={t("agents.workspace.moveDown", {
                      name: plan.label,
                    })}
                  >
                    <ChevronDownIcon size={12} />
                  </button>
                </div>
                <button
                  type="button"
                  className="button button--secondary button--sm"
                  disabled={restoring || agents.mode !== "ready"}
                  onClick={() => setPendingRestore([plan.id])}
                >
                  <PlayIcon size={12} />
                  {t("agents.workspace.restore")}
                </button>
                <button
                  type="button"
                  className="icon-button icon-button--sm icon-button--danger"
                  disabled={restoring || reorderingPlanId !== null}
                  onClick={() => setPendingDeletePlan(plan)}
                  aria-label={t("agents.workspace.delete")}
                  data-tooltip={t("agents.workspace.delete")}
                >
                  <TrashIcon size={12} />
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="agents-orchestration">
        <div className="agents-section-heading">
          <div>
            <span className="eyebrow">{t("agents.broadcast.eyebrow")}</span>
            <h3>{t("agents.broadcast.title")}</h3>
            <p>{t("agents.broadcast.body")}</p>
          </div>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={toggleAllBroadcastTargets}
            disabled={agents.sessions.length === 0 || broadcasting}
          >
            {t(
              allBroadcastTargetsSelected
                ? "agents.broadcast.clearAll"
                : "agents.broadcast.selectAll",
            )}
          </button>
        </div>

        <Callout tone="security" title={t("agents.broadcast.securityTitle")}>
          {t("agents.broadcast.securityBody")}
        </Callout>

        {broadcastNotice && (
          <Callout
            tone={broadcastNotice.failed > 0 ? "danger" : "info"}
            title={t(
              broadcastNotice.failed > 0
                ? "agents.broadcast.partialTitle"
                : "agents.broadcast.successTitle",
            )}
          >
            {t("agents.broadcast.result", {
              delivered: broadcastNotice.delivered,
              failed: broadcastNotice.failed,
            })}
            {broadcastNotice.detail && (
              <span className="mono agents-broadcast__error">
                {broadcastNotice.detail}
              </span>
            )}
          </Callout>
        )}

        {agents.sessions.length === 0 ? (
          <p className="agents-running__empty">
            {t("agents.broadcast.empty")}
          </p>
        ) : (
          <div className="agents-broadcast__targets">
            {agents.sessions.map((session) => (
              <label
                className={`checkbox agents-broadcast__target${
                  selectedBroadcastIds.has(session.sessionId) ? " is-selected" : ""
                }`}
                key={session.sessionId}
              >
                <input
                  type="checkbox"
                  checked={selectedBroadcastIds.has(session.sessionId)}
                  onChange={() => toggleBroadcastTarget(session.sessionId)}
                  disabled={
                    broadcasting ||
                    (!selectedBroadcastIds.has(session.sessionId) &&
                      selectedBroadcastIds.size >= MAX_AGENT_BROADCAST_TARGETS)
                  }
                />
                <span className="checkbox__box" aria-hidden="true">
                  ✓
                </span>
                <span className="agents-broadcast__target-label">
                  <strong>{session.label}</strong>
                  <span className="mono">{session.workingDirectory}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="agents-broadcast__compose">
          <label className="field">
            <span className="field__label">{t("agents.broadcast.prompt")}</span>
            <textarea
              className="input"
              value={broadcastPrompt}
              onChange={(event) => {
                setBroadcastPrompt(event.currentTarget.value);
                setBroadcastNotice(null);
              }}
              placeholder={t("agents.broadcast.promptPlaceholder")}
              maxLength={16000}
              disabled={broadcasting || agents.sessions.length === 0}
            />
            <span className="agents-field-hint">
              {t("agents.broadcast.promptHint", {
                count: MAX_AGENT_BROADCAST_TARGETS,
              })}
            </span>
          </label>
          <button
            type="button"
            className="button button--primary"
            disabled={
              broadcasting ||
              selectedBroadcastIds.size === 0 ||
              !broadcastPrompt.trim() ||
              agents.mode !== "ready"
            }
            onClick={() => setPendingBroadcast([...selectedBroadcastIds])}
          >
            <TransferIcon size={13} />
            {broadcasting
              ? t("agents.broadcast.sending")
              : t("agents.broadcast.review", {
                  count: selectedBroadcastIds.size,
                })}
          </button>
        </div>
      </section>

      <section className="agents-running">
        <div className="agents-section-heading">
          <div>
            <span className="eyebrow">{t("agents.running.eyebrow")}</span>
            <h3>{t("agents.running.title")}</h3>
          </div>
        </div>
        {agents.sessions.length === 0 ? (
          <p className="agents-running__empty">{t("agents.running.empty")}</p>
        ) : (
          <div className="agent-session-list">
            {agents.sessions.map((session) => (
              <article className="agent-session-row" key={session.sessionId}>
                <span
                  className={`agent-state-dot state-${session.state}`}
                  aria-hidden="true"
                />
                <div className="agent-session-row__main">
                  <strong>{session.label}</strong>
                  <span className="mono">{session.workingDirectory}</span>
                </div>
                <div className="agent-session-row__status">
                  <span className={`badge ${stateTone(session)}`}>
                    {t(stateKey(session))}
                  </span>
                  <span className="agent-state-source">
                    {t(
                      session.stateSource === "integration"
                        ? "agents.state.source.integration"
                        : "agents.state.source.heuristic",
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() => onOpen(session.sessionId)}
                >
                  <TerminalIcon size={13} />
                  {t("agents.open")}
                </button>
                <button
                  type="button"
                  className="icon-button icon-button--sm icon-button--danger"
                  onClick={() => setPendingStop(session)}
                  aria-label={t("agents.stop")}
                  data-tooltip={t("agents.stop")}
                >
                  <StopIcon size={12} />
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {pendingStop && (
        <ConfirmDialog
          title={t("agents.stop.confirm.title", { name: pendingStop.label })}
          body={t("agents.stop.confirm.body")}
          confirmLabel={t("agents.stop.confirm.action")}
          cancelLabel={t("common.cancel")}
          tone="danger"
          onConfirm={() => {
            void agents
              .disconnect(pendingStop.sessionId)
              .finally(() => setPendingStop(null));
          }}
          onCancel={() => setPendingStop(null)}
        />
      )}

      {pendingBroadcast && (
        <ConfirmDialog
          title={t("agents.broadcast.confirmTitle")}
          body={t("agents.broadcast.confirmBody", {
            count: pendingBroadcast.length,
          })}
          confirmLabel={t("agents.broadcast.confirmAction", {
            count: pendingBroadcast.length,
          })}
          cancelLabel={t("common.cancel")}
          tone="default"
          onConfirm={() => void confirmBroadcast()}
          onCancel={() => setPendingBroadcast(null)}
        />
      )}

      {pendingRestore && (
        <ConfirmDialog
          title={t("agents.workspace.confirmTitle")}
          body={t("agents.workspace.confirmBody", {
            count: pendingRestore.length,
          })}
          confirmLabel={t("agents.workspace.confirmAction", {
            count: pendingRestore.length,
          })}
          cancelLabel={t("common.cancel")}
          tone="default"
          onConfirm={() => void confirmRestorePlans()}
          onCancel={() => setPendingRestore(null)}
        />
      )}

      {pendingDeletePlan && (
        <ConfirmDialog
          title={t("agents.workspace.deleteTitle", {
            name: pendingDeletePlan.label,
          })}
          body={t("agents.workspace.deleteBody")}
          confirmLabel={t("agents.workspace.deleteAction")}
          cancelLabel={t("common.cancel")}
          tone="danger"
          onConfirm={() => void confirmDeletePlan()}
          onCancel={() => setPendingDeletePlan(null)}
        />
      )}
    </div>
  );
}

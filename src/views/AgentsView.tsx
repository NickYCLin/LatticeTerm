import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentApi,
  AgentDefinition,
  AgentLaunchPlan,
  AgentSessionSummary,
} from "../app/useAgentSessions";
import { agentCatalogForDisplay } from "../app/useAgentSessions";
import { copyTextToClipboard } from "../app/clipboardText";
import { displayPath } from "../app/displayPath";
import type { RemoteApi } from "../app/useRemoteSessions";
import {
  MAX_AGENT_BROADCAST_TARGETS,
  MAX_SAVED_AGENT_PLANS,
  moveAgentLaunchPlan,
} from "../app/useAgentSessions";
import { AgentRemoteDelivery } from "../components/agents/AgentRemoteDelivery";
import { SharedAgentRulesPanel } from "../components/agents/SharedAgentRulesPanel";
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

export const TRADITIONAL_CHINESE_COMMIT_TEMPLATE = `進行任何工作前，先遵守以下協作規則：
- 只有使用者明確要求提交時才建立 Git commit。
- Git commit message 一律使用自然的台灣繁體中文。
- 標題使用 <type>(<scope>): <subject>；scope 可省略。
- type 僅使用 feat、fix、docs、style、refactor、perf、test、chore、revert。
- subject 具體描述本次變更，不超過 50 個字，結尾不加句號。
- 需要 body 時，說清楚 why 與 what，每行不超過 72 個字；有 issue 時在 footer 標註。
- 一個 commit 只處理一個有意義的變更；提交前檢查 diff，只納入本次任務檔案。
- 避免「全面優化」「提升體驗」「確保穩定」等空泛、制式的 AI 語氣，改用符合實際修改內容的自然說法。`;

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

function accountKey(definition: AgentDefinition): MessageKey {
  switch (definition.account.state) {
    case "signedIn":
      return "agents.account.signedIn";
    case "signedOut":
      return "agents.account.signedOut";
    case "unknown":
      return "agents.account.unknown";
    default:
      return "agents.account.unsupported";
  }
}

export function AgentsView({
  agents,
  remote,
  onOpen,
}: {
  agents: AgentApi;
  remote: RemoteApi;
  onOpen: (sessionId: string) => void;
}) {
  const { t, tag } = useI18n();
  const tokenNumber = useMemo(() => new Intl.NumberFormat(tag), [tag]);
  const compactTokenNumber = useMemo(
    () =>
      new Intl.NumberFormat(tag, {
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    [tag],
  );
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [launchNote, setLaunchNote] = useState("");
  const [launching, setLaunching] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<AgentDefinition | null>(null);
  const [copiedInstallSource, setCopiedInstallSource] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const copyRequestRef = useRef(0);
  const [copyProblem, setCopyProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [editingWorkspaceName, setEditingWorkspaceName] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [savingWorkspaceName, setSavingWorkspaceName] = useState(false);
  const [startupInstructionsDraft, setStartupInstructionsDraft] = useState("");
  const [savingStartupInstructions, setSavingStartupInstructions] = useState(false);
  const [startupInstructionsSaved, setStartupInstructionsSaved] = useState(false);
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

  useEffect(
    () => () => {
      copyRequestRef.current += 1;
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    },
    [],
  );
  const [pendingStop, setPendingStop] = useState<AgentSessionSummary | null>(null);
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null);
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
    setStartupInstructionsDraft(agents.startupInstructions);
  }, [agents.startupInstructions]);

  useEffect(() => {
    const activeIds = new Set(agents.sessions.map((session) => session.sessionId));
    setSelectedBroadcastIds((current) => {
      const next = new Set(
        [...current].filter((sessionId) => activeIds.has(sessionId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [agents.sessions]);

  const displayCatalog = useMemo(
    () => agentCatalogForDisplay(agents.catalog),
    [agents.catalog],
  );
  const installedCount = useMemo(
    () => displayCatalog.filter((definition) => definition.installed).length,
    [displayCatalog],
  );
  const attentionCount = useMemo(
    () =>
      agents.sessions.filter((session) => session.state === "needsAttention")
        .length,
    [agents.sessions],
  );
  function launchDraft(definition: AgentDefinition) {
    return {
      definitionId: definition.id,
      label: "",
      executable: "",
      arguments: [],
      resumeSessionId: null,
      note: launchNote.trim(),
      workingDirectory,
    };
  }

  async function launch(definition: AgentDefinition) {
    const id = definition.id;
    setLaunching(id);
    setError(null);
    try {
      const session = await agents.launch({
        ...launchDraft(definition),
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

  async function confirmInstall() {
    const definition = pendingInstall;
    const recipe = definition?.install;
    if (!definition || !recipe || !recipe.executable || !recipe.available) return;
    setPendingInstall(null);
    setInstalling(definition.id);
    setError(null);
    try {
      const session = await agents.launch({
        definitionId: "custom",
        label: t("agents.install.sessionLabel", { name: definition.label }),
        executable: recipe.executable,
        arguments: recipe.arguments,
        resumeSessionId: null,
        workingDirectory,
        cols: 120,
        rows: 32,
      });
      let stopWatching = () => {};
      stopWatching = agents.onClosed(session.sessionId, () => {
        stopWatching();
        void agents.refreshCatalog();
      });
      onOpen(session.sessionId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setInstalling(null);
    }
  }

  async function copyInstallSource(definition: AgentDefinition) {
    const request = ++copyRequestRef.current;
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    setCopiedInstallSource(null);
    setCopyProblem(null);
    try {
      await copyTextToClipboard(definition.install.sourceUrl);
      if (request !== copyRequestRef.current) return;
      setCopiedInstallSource(definition.id);
      copyTimerRef.current = window.setTimeout(() => {
        if (request === copyRequestRef.current) {
          setCopiedInstallSource(null);
          copyTimerRef.current = null;
        }
      }, 2_000);
    } catch (reason) {
      if (request !== copyRequestRef.current) return;
      setCopyProblem(
        t("common.copyFailed.body", {
          error: reason instanceof Error ? reason.message : String(reason),
        }),
      );
    }
  }

  async function savePlan(definition: AgentDefinition) {
    const id = definition.id;
    setSaving(id);
    setError(null);
    setWorkspaceNotice(null);
    try {
      const plan = await agents.savePlan(launchDraft(definition));
      setWorkspaceNotice({ saved: plan.label });
      setLaunchNote("");
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

  async function saveStartupInstructions() {
    setSavingStartupInstructions(true);
    setStartupInstructionsSaved(false);
    setError(null);
    try {
      const saved = await agents.updateStartupInstructions(startupInstructionsDraft);
      setStartupInstructionsDraft(saved);
      setStartupInstructionsSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingStartupInstructions(false);
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
  const installDisabled =
    agents.mode !== "ready" || !workingDirectory.trim() || installing !== null;
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
      {copyProblem && (
        <Callout tone="danger" title={t("common.copyFailed.title")}>
          <span className="mono">{copyProblem}</span>
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

        <section className="agents-startup-instructions">
          <div className="agents-startup-instructions__heading">
            <div>
              <span className="field__label">{t("agents.startupInstructions")}</span>
              <p className="agents-field-hint">
                {t("agents.startupInstructions.hint")}
              </p>
            </div>
            <span
              className={`badge ${agents.startupInstructions ? "tone-ok" : "tone-neutral"}`}
            >
              {t(
                agents.startupInstructions
                  ? "agents.startupInstructions.enabled"
                  : "agents.startupInstructions.disabled",
              )}
            </span>
          </div>
          <textarea
            className="input agents-startup-instructions__input"
            value={startupInstructionsDraft}
            onChange={(event) => {
              setStartupInstructionsDraft(event.currentTarget.value);
              setStartupInstructionsSaved(false);
            }}
            placeholder={t("agents.startupInstructions.placeholder")}
            rows={8}
            maxLength={2_000}
            spellCheck={false}
          />
          <div className="agents-startup-instructions__actions">
            <span className="agents-field-hint" aria-live="polite">
              {startupInstructionsSaved
                ? t("agents.startupInstructions.saved")
                : t("agents.startupInstructions.localOnly")}
            </span>
            <button
              type="button"
              className="button button--ghost button--sm"
              disabled={savingStartupInstructions || agents.mode !== "ready"}
              onClick={() => {
                setStartupInstructionsDraft(TRADITIONAL_CHINESE_COMMIT_TEMPLATE);
                setStartupInstructionsSaved(false);
              }}
            >
              {t("agents.startupInstructions.useCommitTemplate")}
            </button>
            <button
              type="button"
              className="button button--primary button--sm"
              disabled={savingStartupInstructions || agents.mode !== "ready"}
              onClick={() => void saveStartupInstructions()}
            >
              {savingStartupInstructions
                ? t("agents.workspace.saving")
                : t("agents.startupInstructions.save")}
            </button>
          </div>
        </section>

        <SharedAgentRulesPanel
          projectDirectory={workingDirectory}
          disabled={agents.mode !== "ready"}
        />

        <div className="agent-grid">
          {displayCatalog.map((definition) => (
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
                <code>{displayPath(definition.executable)}</code>
                <span className="agent-card__path">
                  {definition.installedPath
                    ? displayPath(definition.installedPath)
                    : t("agents.path.missing")}
                </span>
                {definition.installed && (
                  <div className="agent-card__account">
                    <span>{t("agents.account.current")}</span>
                    <strong className="truncate">
                      {definition.account.label ?? t(accountKey(definition))}
                    </strong>
                    {definition.account.method && (
                      <small>{definition.account.method}</small>
                    )}
                  </div>
                )}
                {!definition.installed && definition.install.displayCommand && (
                  <code className="agent-card__install-command">
                    {definition.install.displayCommand}
                  </code>
                )}
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
                {!definition.installed &&
                  (definition.install.executable && definition.install.available ? (
                    <button
                      type="button"
                      className="button button--primary button--sm"
                      disabled={installDisabled}
                      onClick={() => setPendingInstall(definition)}
                    >
                      <TerminalIcon size={12} />
                      {installing === definition.id
                        ? t("agents.installing")
                        : t("agents.install")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      disabled={!definition.install.sourceUrl}
                      onClick={() => void copyInstallSource(definition)}
                    >
                      <TransferIcon size={12} />
                      {copiedInstallSource === definition.id
                        ? t("agents.install.sourceCopied")
                        : t("agents.install.copySource")}
                    </button>
                  ))}
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
              path: displayPath(agents.planRecovery.backupPath),
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
                  <span className="mono">{displayPath(plan.workingDirectory)}</span>
                  <small>
                    {plan.resumeSessionId
                      ? t("agents.workspace.nativeResumeCommand", {
                          executable: plan.executable,
                        })
                      : agents.catalog.some(
                            (definition) =>
                              definition.id === plan.definitionId &&
                              definition.resumeLatestSupported,
                          ) &&
                          plan.arguments.length === 0
                        ? t("agents.workspace.latestResumeCommand", {
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
                  <span className="mono">{displayPath(session.workingDirectory)}</span>
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

      <AgentRemoteDelivery remote={remote} />

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
                  <span className="mono">{displayPath(session.workingDirectory)}</span>
                  {session.tokenUsage && (
                    <span
                      className="agent-token-usage"
                      title={t("agents.usage.breakdown", {
                        input: tokenNumber.format(session.tokenUsage.inputTokens),
                        output: tokenNumber.format(session.tokenUsage.outputTokens),
                        cacheRead: tokenNumber.format(
                          session.tokenUsage.cacheReadTokens,
                        ),
                        cacheWrite: tokenNumber.format(
                          session.tokenUsage.cacheWriteTokens,
                        ),
                        reasoning: tokenNumber.format(
                          session.tokenUsage.reasoningTokens,
                        ),
                      })}
                    >
                      {t("agents.usage.summary", {
                        tokens: compactTokenNumber.format(
                          session.tokenUsage.totalTokens,
                        ),
                        calls: tokenNumber.format(session.tokenUsage.apiCalls),
                      })}
                    </span>
                  )}
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
          busy={stoppingSessionId === pendingStop.sessionId}
          onConfirm={() => {
            if (stoppingSessionId) return;
            setStoppingSessionId(pendingStop.sessionId);
            void agents
              .disconnect(pendingStop.sessionId)
              .finally(() => {
                setPendingStop(null);
                setStoppingSessionId(null);
              });
          }}
          onCancel={() => {
            if (!stoppingSessionId) setPendingStop(null);
          }}
        />
      )}

      {pendingInstall && (
        <ConfirmDialog
          title={t("agents.install.confirm.title", {
            name: pendingInstall.label,
          })}
          body={t("agents.install.confirm.body", {
            command: pendingInstall.install.displayCommand,
          })}
          confirmLabel={t("agents.install.confirm.action")}
          cancelLabel={t("common.cancel")}
          tone="default"
          onConfirm={() => void confirmInstall()}
          onCancel={() => setPendingInstall(null)}
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

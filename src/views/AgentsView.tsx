import { useEffect, useMemo, useState } from "react";
import type {
  AgentApi,
  AgentDefinition,
  AgentSessionSummary,
} from "../app/useAgentSessions";
import {
  MAX_AGENT_BROADCAST_TARGETS,
  splitAgentArguments,
} from "../app/useAgentSessions";
import { Callout } from "../components/common/Callout";
import { ConfirmDialog } from "../components/overlays/ConfirmDialog";
import {
  AgentIcon,
  FolderIcon,
  PlayIcon,
  RefreshIcon,
  StopIcon,
  TerminalIcon,
  TransferIcon,
} from "../components/icons";
import { useI18n } from "../i18n";
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
  const [launching, setLaunching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [customExecutable, setCustomExecutable] = useState("");
  const [customArguments, setCustomArguments] = useState("");
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

  async function launch(
    definition: AgentDefinition | null,
    custom = false,
  ) {
    const id = custom ? "custom" : (definition?.id ?? "");
    setLaunching(id);
    setError(null);
    try {
      const session = await agents.launch({
        definitionId: id,
        label: custom ? customLabel : "",
        executable: custom ? customExecutable : "",
        arguments: custom ? splitAgentArguments(customArguments) : [],
        workingDirectory,
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

  const launchDisabled =
    agents.mode !== "ready" || !workingDirectory.trim() || launching !== null;
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
        <Callout tone="danger" title={t("agents.launch.failed")}>
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
            </article>
          ))}
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
    </div>
  );
}

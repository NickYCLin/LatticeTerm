/**
 * Chat mode: talk to a local agent CLI in a message thread.
 *
 * The CLI still does the work, with its own login, model access and tool
 * permissions; this view only changes how the conversation looks. People
 * who would rather not drive a terminal get a composer, streamed replies,
 * and a card per tool call instead of scrolling terminal output.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  defaultPermission,
  formatTokens,
  permissionsFor,
  threadIsFresh,
  type ChatDefinitionId,
  type ChatItem,
  type ChatPermission,
  type ChatThread,
} from "../app/agentChat";
import type { AgentChatApi } from "../app/useAgentChat";
import type { AgentAutomationsApi } from "../app/useAgentAutomations";
import { AutomationPane, describeSchedule } from "../components/chat/AutomationPane";
import type { AgentApi } from "../app/useAgentSessions";
import { displayPath } from "../app/displayPath";
import { useI18n } from "../i18n/context";
import type { MessageKey } from "../i18n/messages/zh-TW";
import { Callout, EmptyState } from "../components/common/Callout";
import { ConfirmDialog } from "../components/overlays/ConfirmDialog";
import { ChatMarkdown } from "../components/chat/ChatMarkdown";
import { ModelField } from "../components/chat/ModelField";
import { ChatThreadTree } from "../components/chat/ChatThreadTree";
import {
  ChatIcon,
  ClockIcon,
  FolderIcon,
  PlusIcon,
  SendIcon,
  SettingsIcon,
  StopIcon,
  TrashIcon,
} from "../components/icons";

const permissionLabelKey: Record<ChatPermission, MessageKey> = {
  ask: "chat.permission.ask",
  readOnly: "chat.permission.readOnly",
  workspaceWrite: "chat.permission.workspaceWrite",
  full: "chat.permission.full",
};

const permissionHintKey: Record<ChatPermission, MessageKey> = {
  ask: "chat.permission.ask.hint",
  readOnly: "chat.permission.readOnly.hint",
  workspaceWrite: "chat.permission.workspaceWrite.hint",
  full: "chat.permission.full.hint",
};

function directoryName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

export function ChatView({
  agents,
  chat,
  automations,
}: {
  agents: AgentApi;
  chat: AgentChatApi;
  automations: AgentAutomationsApi;
}) {
  const { t, tag } = useI18n();
  const [pendingDelete, setPendingDelete] = useState<ChatThread | null>(null);
  const [mode, setMode] = useState<"threads" | "automations">("threads");
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);
  const [composingAutomation, setComposingAutomation] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const cliLabel = (id: ChatDefinitionId) =>
    agents.catalog.find((definition) => definition.id === id)?.label ?? id;
  const installed = chat.supported.filter(
    (id) => agents.catalog.find((definition) => definition.id === id)?.installed,
  );
  const active = chat.threads.find((thread) => thread.id === chat.activeThreadId) ?? null;

  function startThread() {
    // A fresh thread borrows the last one's choices: the same project and
    // CLI are the likely next conversation too.
    const previous = chat.threads[0];
    const definitionId =
      previous && installed.includes(previous.definitionId)
        ? previous.definitionId
        : (installed[0] ?? chat.supported[0] ?? "claude");
    chat.createThread({
      definitionId,
      workingDirectory: previous?.workingDirectory ?? "",
      permission:
        previous && permissionsFor(definitionId).includes(previous.permission)
          ? previous.permission
          : defaultPermission(definitionId),
      model: "",
    });
  }

  function startAutomation() {
    setSelectedAutomationId(null);
    setComposingAutomation(true);
    setMode("automations");
  }

  function openThread(threadId: string) {
    setMode("threads");
    chat.setActiveThreadId(threadId);
  }

  const previous = chat.threads[0];
  const automationDefaults = {
    definitionId:
      previous && installed.includes(previous.definitionId)
        ? previous.definitionId
        : (installed[0] ?? "claude"),
    workingDirectory: previous?.workingDirectory ?? "",
  };

  return (
    <section className="chat-view" aria-label={t("chat.title")}>
      <aside className="chat-threads">
        <div className="chat-threads__header">
          <div className="chat-mode" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "threads"}
              className={`chat-mode__tab${mode === "threads" ? " is-active" : ""}`}
              onClick={() => setMode("threads")}
            >
              <ChatIcon />
              {t("chat.title")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "automations"}
              className={`chat-mode__tab${mode === "automations" ? " is-active" : ""}`}
              onClick={() => setMode("automations")}
            >
              <ClockIcon />
              {t("automation.title")}
              {automations.unreadCount > 0 && (
                <span className="chat-mode__badge" aria-label={t("automation.unread", { count: automations.unreadCount })}>
                  {automations.unreadCount}
                </span>
              )}
            </button>
          </div>
          <div className="chat-composer__actions">
            {mode === "threads" && (
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => {
                  setNewFolderOpen((current) => !current);
                  setNewFolderName("");
                }}
                aria-label={t("chat.folder.new")}
                title={t("chat.folder.new")}
                aria-expanded={newFolderOpen}
              >
                <FolderIcon />
              </button>
            )}
            <button
              type="button"
              className="button button--primary button--sm"
              onClick={mode === "threads" ? startThread : startAutomation}
              disabled={agents.mode !== "ready"}
              aria-label={mode === "threads" ? t("chat.new") : t("automation.new")}
              title={mode === "threads" ? t("chat.new") : t("automation.new")}
            >
              <PlusIcon />
            </button>
          </div>
        </div>
        {mode === "threads" && newFolderOpen && (
          <form
            className="chat-folder-form"
            onSubmit={(event) => {
              event.preventDefault();
              const name = newFolderName.trim();
              if (name) chat.createFolder(name, null);
              setNewFolderOpen(false);
              setNewFolderName("");
            }}
          >
            <input
              className="input"
              autoFocus
              value={newFolderName}
              placeholder={t("chat.folder.name.placeholder")}
              aria-label={t("chat.folder.name.placeholder")}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setNewFolderOpen(false);
              }}
            />
            <button type="submit" className="button button--primary button--sm">
              {t("chat.folder.create")}
            </button>
          </form>
        )}
        {mode === "threads" ? (
          <div className="chat-threads__list">
            <ChatThreadTree
              layout={chat.layout}
              threads={chat.threads}
              activeThreadId={chat.activeThreadId}
              onSelectThread={(id) => chat.setActiveThreadId(id)}
              onToggleFolder={chat.toggleFolder}
              onRenameFolder={chat.renameFolder}
              onRemoveFolder={chat.removeFolder}
              onCreateFolder={chat.createFolder}
              onMoveNode={chat.moveNode}
              renderThread={(thread, active) => (
                <div
                  className={`chat-thread${active ? " is-active" : ""}${thread.unread ? " is-unread" : ""}`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      chat.setActiveThreadId(thread.id);
                    }
                  }}
                >
                  <span>
                    <span className="chat-thread__title">
                      {thread.title || t("chat.untitled")}
                    </span>
                    <span className="chat-thread__meta">
                      {thread.automationId ? `${t("automation.badge")} · ` : ""}
                      {cliLabel(thread.definitionId)}
                      {thread.workingDirectory
                        ? ` · ${directoryName(thread.workingDirectory)}`
                        : ""}
                    </span>
                  </span>
                  {thread.runningTurnId ? (
                    <span className="chat-thread__dot" aria-label={t("chat.running")} />
                  ) : thread.unread ? (
                    <span className="chat-thread__dot chat-thread__dot--unread" aria-label={t("automation.unread.one")} />
                  ) : null}
                </div>
              )}
            />
            {chat.layout.folders.length > 0 && (
              <p className="chat-threads__hint">{t("chat.folder.dragHint")}</p>
            )}
          </div>
        ) : (
          <ul className="chat-threads__list">
            {automations.automations.map((automation) => (
              <li key={automation.id}>
                <button
                  type="button"
                  className={`chat-thread${automation.id === selectedAutomationId && !composingAutomation ? " is-active" : ""}`}
                  onClick={() => {
                    setComposingAutomation(false);
                    setSelectedAutomationId(automation.id);
                  }}
                >
                  <span>
                    <span className="chat-thread__title">{automation.name}</span>
                    <br />
                    <span className="chat-thread__meta">
                      {automation.enabled
                        ? describeSchedule(automation.schedule, t)
                        : t("automation.paused")}
                    </span>
                  </span>
                  {automation.runs[0]?.outcome === "running" && (
                    <span className="chat-thread__dot" aria-label={t("automation.running")} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="chat-main">
        {mode === "automations" && agents.mode !== "unavailable" ? (
          composingAutomation || selectedAutomationId ? (
            <AutomationPane
              automations={automations}
              selectedId={selectedAutomationId}
              editing={composingAutomation}
              defaults={automationDefaults}
              installed={installed}
              cliLabel={cliLabel}
              onSelect={setSelectedAutomationId}
              onDoneEditing={() => setComposingAutomation(false)}
              onOpenThread={openThread}
              models={chat.models}
              loadModels={chat.loadModels}
            />
          ) : (
            <EmptyState
              icon={<ClockIcon />}
              title={t("automation.empty.title")}
              description={t("automation.empty.body")}
              actions={
                <button
                  type="button"
                  className="button button--primary"
                  onClick={startAutomation}
                  disabled={agents.mode !== "ready" || installed.length === 0}
                >
                  <PlusIcon />
                  {t("automation.new")}
                </button>
              }
            />
          )
        ) : agents.mode === "unavailable" ? (
          <div className="chat-header">
            <Callout tone="warn" title={t("desktopBackend.required.title")}>
              {t("desktopBackend.required.body")}
            </Callout>
          </div>
        ) : installed.length === 0 && agents.mode === "ready" ? (
          <EmptyState
            icon={<ChatIcon />}
            title={t("chat.none.title")}
            description={t("chat.none.body")}
          />
        ) : !active ? (
          <EmptyState
            icon={<ChatIcon />}
            title={t("chat.empty.title")}
            description={t("chat.empty.body")}
            actions={
              <button
                type="button"
                className="button button--primary"
                onClick={startThread}
                disabled={agents.mode !== "ready"}
              >
                <PlusIcon />
                {t("chat.new")}
              </button>
            }
          />
        ) : (
          <ThreadPane
            key={active.id}
            thread={active}
            chat={chat}
            installed={installed}
            cliLabel={cliLabel}
            tag={tag}
            onDelete={() => setPendingDelete(active)}
          />
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={t("chat.delete.confirm.title", {
            title: pendingDelete.title || t("chat.untitled"),
          })}
          body={t("chat.delete.confirm.body")}
          confirmLabel={t("chat.delete.confirm.action")}
          tone="danger"
          onConfirm={() => {
            chat.removeThread(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </section>
  );
}

function ThreadPane({
  thread,
  chat,
  installed,
  cliLabel,
  tag,
  onDelete,
}: {
  thread: ChatThread;
  chat: AgentChatApi;
  installed: readonly ChatDefinitionId[];
  cliLabel: (id: ChatDefinitionId) => string;
  tag: string;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const fresh = threadIsFresh(thread);
  // A new thread needs its directory chosen, so its settings start open;
  // an ongoing conversation keeps them tucked behind the summary chips.
  const [settingsOpen, setSettingsOpen] = useState(fresh || thread.workingDirectory === "");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottom = useRef(true);
  const running = thread.runningTurnId !== null;
  const cliInstalled = installed.includes(thread.definitionId);
  const canSend =
    !running && cliInstalled && thread.workingDirectory !== "" && draft.trim() !== "";
  const assistant = cliLabel(thread.definitionId);

  // Follow the reply as it streams, unless the reader scrolled up to look
  // at something earlier.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node && pinnedToBottom.current) node.scrollTop = node.scrollHeight;
  }, [thread.items]);

  useEffect(() => {
    setNotice(null);
  }, [thread.id]);

  function onScroll() {
    const node = scrollRef.current;
    if (!node) return;
    pinnedToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  }

  async function chooseDirectory() {
    setNotice(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("chat.directory.choose"),
      });
      if (typeof selected === "string") {
        chat.updateThread(thread.id, { workingDirectory: selected });
      }
    } catch (reason) {
      setNotice(
        t("chat.directory.chooseFailed", {
          detail: reason instanceof Error ? reason.message : String(reason),
        }),
      );
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    const prompt = draft;
    setDraft("");
    pinnedToBottom.current = true;
    setSettingsOpen(false);
    void chat.send(thread.id, prompt);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter while an input method is composing picks a candidate; it must
    // not send half a sentence.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  async function answer(requestId: string, allow: boolean) {
    setNotice(null);
    try {
      await chat.respond(thread.id, requestId, allow);
    } catch (reason) {
      setNotice(
        t("chat.approval.failed", {
          detail: reason instanceof Error ? reason.message : String(reason),
        }),
      );
    }
  }

  async function stop() {
    try {
      await chat.stop(thread.id);
    } catch (reason) {
      setNotice(
        t("chat.stop.failed", {
          detail: reason instanceof Error ? reason.message : String(reason),
        }),
      );
    }
  }

  const modelLabel = (() => {
    const list = chat.models[thread.definitionId];
    if (list.state === "ready") {
      const match = list.models.find((model) => model.value === thread.model);
      if (match) return match.label;
    }
    return thread.model || t("chat.model.default");
  })();

  return (
    <>
      <header className="chat-header">
        <div className="chat-header__title">
          <div className="chat-header__identity">
            <span className="chat-avatar" aria-hidden="true">
              {assistant.slice(0, 1)}
            </span>
            <div>
              <h2>{thread.title || t("chat.untitled")}</h2>
              <div className="chat-chips">
                <button
                  type="button"
                  className="chat-chip"
                  onClick={() => setSettingsOpen((current) => !current)}
                  aria-expanded={settingsOpen}
                  aria-controls={`chat-settings-${thread.id}`}
                >
                  <SettingsIcon />
                  {assistant}
                </button>
                <span className="chat-chip" title={thread.workingDirectory}>
                  <FolderIcon />
                  {thread.workingDirectory
                    ? directoryName(thread.workingDirectory)
                    : t("chat.directory.none")}
                </span>
                <span className="chat-chip">{t(permissionLabelKey[thread.permission])}</span>
                <span className="chat-chip">{modelLabel}</span>
              </div>
            </div>
          </div>
          <div className="chat-composer__actions">
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => setSettingsOpen((current) => !current)}
              aria-expanded={settingsOpen}
            >
              {settingsOpen ? t("chat.settings.hide") : t("chat.settings")}
            </button>
            <button
              type="button"
              className="button button--ghost button--danger button--sm"
              onClick={onDelete}
              aria-label={t("chat.delete")}
              title={t("chat.delete")}
            >
              <TrashIcon />
            </button>
          </div>
        </div>
        {settingsOpen && (
          <div className="chat-settings" id={`chat-settings-${thread.id}`}>
            <label className="field">
              <span className="field__label">{t("chat.cli")}</span>
              <select
                className="select"
                value={thread.definitionId}
                disabled={!fresh}
                onChange={(event) => {
                  const definitionId = event.target.value as ChatDefinitionId;
                  chat.updateThread(thread.id, {
                    definitionId,
                    // A permission the new assistant cannot honour falls back
                    // to its own default rather than being sent and refused.
                    ...(permissionsFor(definitionId).includes(thread.permission)
                      ? {}
                      : { permission: defaultPermission(definitionId) }),
                  });
                }}
              >
                {chat.supported.map((id) => (
                  <option key={id} value={id}>
                    {cliLabel(id)}
                  </option>
                ))}
              </select>
            </label>
            <div className="field field--grow">
              <span className="field__label">{t("chat.directory")}</span>
              <div className="chat-directory">
                <button
                  type="button"
                  className="button button--secondary button--sm"
                  onClick={chooseDirectory}
                  disabled={running}
                >
                  <FolderIcon />
                  {t("chat.directory.choose")}
                </button>
                <span className="chat-directory__path" title={thread.workingDirectory}>
                  {thread.workingDirectory
                    ? displayPath(thread.workingDirectory)
                    : t("chat.directory.none")}
                </span>
              </div>
            </div>
            <label className="field">
              <span className="field__label">{t("chat.permission")}</span>
              <select
                className="select"
                value={thread.permission}
                disabled={running}
                onChange={(event) =>
                  chat.updateThread(thread.id, {
                    permission: event.target.value as ChatPermission,
                  })
                }
              >
                {permissionsFor(thread.definitionId).map((permission) => (
                  <option key={permission} value={permission}>
                    {t(permissionLabelKey[permission])}
                  </option>
                ))}
              </select>
            </label>
            <ModelField
              definitionId={thread.definitionId}
              value={thread.model}
              disabled={running || (thread.definitionId === "codex" && !fresh)}
              title={thread.definitionId === "codex" && !fresh ? t("chat.model.locked") : undefined}
              models={chat.models}
              loadModels={chat.loadModels}
              onChange={(model) => chat.updateThread(thread.id, { model })}
            />
            <p className="chat-settings__hint">{t(permissionHintKey[thread.permission])}</p>
          </div>
        )}
        {thread.permission === "full" && (
          <Callout tone="warn">{t("chat.permission.full.hint")}</Callout>
        )}
        {!cliInstalled && (
          <Callout tone="warn">
            {t("chat.notInstalled", { cli: cliLabel(thread.definitionId) })}
          </Callout>
        )}
        {notice && <Callout tone="danger">{notice}</Callout>}
      </header>

      <div className="chat-messages" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-messages__inner">
          {thread.items.length === 0 && (
            <div className="chat-welcome">
              <span className="chat-avatar chat-avatar--lg" aria-hidden="true">
                {assistant.slice(0, 1)}
              </span>
              <h3>{t("chat.welcome.title", { assistant })}</h3>
              <p>
                {thread.workingDirectory
                  ? t("chat.welcome.body", { directory: directoryName(thread.workingDirectory) })
                  : t("chat.welcome.chooseDirectory")}
              </p>
            </div>
          )}
          {thread.items.map((item, index) => (
            <ChatItemView
              key={item.id}
              item={item}
              assistant={assistant}
              streaming={running && index === thread.items.length - 1}
              tag={tag}
              onAnswer={answer}
            />
          ))}
          {running && thread.items[thread.items.length - 1]?.type === "user" && (
            <div className="chat-msg chat-msg--assistant">
              <span className="chat-avatar" aria-hidden="true">
                {assistant.slice(0, 1)}
              </span>
              <div className="chat-msg__body">
                <p className="chat-notice chat-cursor">{t("chat.running")}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <form className="chat-composer" onSubmit={submit}>
        <div className={`chat-composer__box${running ? " is-busy" : ""}`}>
          <textarea
            className="chat-composer__input"
            value={draft}
            placeholder={
              thread.workingDirectory
                ? t("chat.composer.placeholder", { assistant })
                : t("chat.welcome.chooseDirectory")
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label={t("chat.composer.label")}
            rows={2}
          />
          <div className="chat-composer__row">
            <span className="chat-composer__hint">
              {thread.nativeSessionId
                ? t("chat.composer.shortcut")
                : t("chat.storage.note")}
            </span>
            <div className="chat-composer__actions">
              {running && (
                <button
                  type="button"
                  className="button button--secondary button--sm"
                  onClick={stop}
                >
                  <StopIcon />
                  {t("chat.stop")}
                </button>
              )}
              <button
                type="submit"
                className="chat-send"
                disabled={!canSend}
                aria-label={t("chat.send")}
                title={t("chat.send")}
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}

function ChatItemView({
  item,
  assistant,
  streaming,
  tag,
  onAnswer,
}: {
  item: ChatItem;
  assistant: string;
  streaming: boolean;
  tag: string;
  onAnswer: (requestId: string, allow: boolean) => void;
}) {
  const { t } = useI18n();
  switch (item.type) {
    case "user":
      return (
        <div className="chat-msg chat-msg--user">
          <div className="chat-bubble">{item.text}</div>
        </div>
      );
    case "text":
      return (
        <div className="chat-msg chat-msg--assistant">
          <span className="chat-avatar" aria-hidden="true">
            {assistant.slice(0, 1)}
          </span>
          <div className="chat-msg__body">
            <span className="chat-msg__name">{assistant}</span>
            <div className={streaming ? "chat-cursor" : undefined}>
              <ChatMarkdown source={item.text} />
            </div>
          </div>
        </div>
      );
    case "reasoning":
      return (
        <details className="chat-card chat-card--reasoning">
          <summary>
            <span className="chat-card__label">{t("chat.reasoning")}</span>
          </summary>
          <p className="chat-card__text">{item.text}</p>
        </details>
      );
    case "tool":
      return (
        <details
          className={`chat-card chat-card--tool${item.isError ? " is-error" : ""}${!item.done ? " is-running" : ""}`}
          open={item.isError || undefined}
        >
          <summary>
            <span className="chat-card__label">{item.name}</span>
            <code className="chat-card__summary" title={item.summary}>
              {item.summary}
            </code>
            <span className="chat-card__state">
              {!item.done ? t("chat.tool.running") : item.isError ? t("chat.tool.failed") : ""}
            </span>
          </summary>
          {item.output && <pre className="chat-card__output">{item.output}</pre>}
        </details>
      );
    case "approval":
      return (
        <div
          className={`chat-card chat-card--approval chat-approval--${item.decision}`}
          role="group"
          aria-label={t("chat.approval.title")}
        >
          <div className="chat-card__head">
            <span className="chat-card__label">{item.name}</span>
            <code className="chat-card__summary" title={item.summary}>
              {item.summary}
            </code>
            <span className="chat-card__state">
              {item.decision === "pending"
                ? t("chat.approval.title")
                : t(`chat.approval.${item.decision}` as MessageKey)}
            </span>
          </div>
          {item.input && item.input !== "null" && (
            <details className="chat-card__details">
              <summary>{t("chat.approval.input")}</summary>
              <pre className="chat-card__output">{item.input}</pre>
            </details>
          )}
          {item.decision === "pending" && (
            <div className="chat-card__actions">
              <button
                type="button"
                className="button button--primary button--sm"
                onClick={() => onAnswer(item.requestId, true)}
              >
                {t("chat.approval.allow")}
              </button>
              <button
                type="button"
                className="button button--secondary button--sm"
                onClick={() => onAnswer(item.requestId, false)}
              >
                {t("chat.approval.deny")}
              </button>
            </div>
          )}
        </div>
      );
    case "notice":
      return <p className="chat-notice">{item.text}</p>;
    case "turnEnd":
      if (item.error) {
        return (
          <Callout tone="danger" title={t("chat.turn.failed")}>
            {item.error}
          </Callout>
        );
      }
      return (
        <p className="chat-turn">
          <span className="chat-turn__pill chat-turn__pill--ok">{t("chat.turn.done")}</span>
          {item.durationMs !== null && (
            <span className="chat-turn__pill">
              {t("chat.turn.duration", {
                seconds: new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(
                  item.durationMs / 1000,
                ),
              })}
            </span>
          )}
          {item.usage && (
            <span className="chat-turn__pill">
              {t("chat.turn.tokens", {
                input: formatTokens(item.usage.inputTokens + item.usage.cacheReadTokens),
                output: formatTokens(item.usage.outputTokens),
              })}
            </span>
          )}
          {item.costUsd !== null && (
            <span className="chat-turn__pill">
              {t("chat.turn.cost", {
                cost: new Intl.NumberFormat("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 4,
                }).format(item.costUsd),
              })}
            </span>
          )}
        </p>
      );
  }
}

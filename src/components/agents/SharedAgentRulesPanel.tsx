import { useEffect, useRef, useState } from "react";
import {
  inspectSharedAgentRules,
  MAX_SHARED_AGENT_RULES_BYTES,
  normalizedSharedRulesByteLength,
  saveSharedAgentRules,
  SHARED_AGENT_RULES_TEMPLATE_ZH_TW,
  type SharedAgentRulesFileState,
  type SharedAgentRulesSnapshot,
} from "../../app/sharedAgentRules";
import { displayPath } from "../../app/displayPath";
import { Callout } from "../common/Callout";
import { CheckIcon, DocumentFileIcon, RefreshIcon } from "../icons";
import { useI18n } from "../../i18n/context";
import type { MessageKey } from "../../i18n/messages/zh-TW";

function statusKey(state: SharedAgentRulesFileState): MessageKey {
  switch (state) {
    case "synced":
      return "agents.sharedRules.status.synced";
    case "needsSync":
      return "agents.sharedRules.status.needsSync";
    case "manualReview":
      return "agents.sharedRules.status.manualReview";
    default:
      return "agents.sharedRules.status.missing";
  }
}

function statusTone(state: SharedAgentRulesFileState): string {
  if (state === "synced") return "tone-ok";
  if (state === "manualReview") return "tone-warn";
  return "tone-neutral";
}

export function SharedAgentRulesPanel({
  projectDirectory,
  disabled,
}: {
  projectDirectory: string;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const requestRef = useRef(0);
  const [snapshot, setSnapshot] = useState<SharedAgentRulesSnapshot | null>(null);
  const [loadedFrom, setLoadedFrom] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedDirectory = projectDirectory.trim();
  const isCurrent = Boolean(snapshot) && loadedFrom === normalizedDirectory;
  const bytes = normalizedSharedRulesByteLength(draft);
  const tooLarge = bytes > MAX_SHARED_AGENT_RULES_BYTES;
  const requiresManualReview =
    snapshot?.files.some((file) => file.state === "manualReview") ?? false;

  useEffect(() => {
    if (loadedFrom && loadedFrom !== normalizedDirectory) {
      requestRef.current += 1;
      setSnapshot(null);
      setLoadedFrom("");
      setDraft("");
      setError(null);
      setSaved(false);
    }
  }, [loadedFrom, normalizedDirectory]);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

  async function inspect() {
    if (!normalizedDirectory) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const next = await inspectSharedAgentRules(normalizedDirectory);
      if (request !== requestRef.current) return;
      setSnapshot(next);
      setLoadedFrom(normalizedDirectory);
      setDraft(next.content);
    } catch (reason) {
      if (request !== requestRef.current) return;
      setSnapshot(null);
      setLoadedFrom("");
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }

  async function save() {
    if (!snapshot || !isCurrent) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await saveSharedAgentRules(
        snapshot.projectDirectory,
        draft,
        snapshot.revision,
      );
      setSnapshot(next);
      setDraft(next.content);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="agents-shared-rules">
      <div className="agents-shared-rules__heading">
        <div>
          <span className="field__label">
            <DocumentFileIcon size={13} />
            {t("agents.sharedRules.title")}
          </span>
          <p className="agents-field-hint">{t("agents.sharedRules.hint")}</p>
        </div>
        <button
          type="button"
          className="button button--ghost button--sm"
          disabled={disabled || loading || !normalizedDirectory}
          onClick={() => void inspect()}
        >
          <RefreshIcon size={12} />
          {loading
            ? t("agents.sharedRules.loading")
            : t("agents.sharedRules.inspect")}
        </button>
      </div>

      {!isCurrent && !error && (
        <p className="agents-shared-rules__empty">
          {t("agents.sharedRules.inspectHint")}
        </p>
      )}

      {isCurrent && snapshot && (
        <>
          <div className="agents-shared-rules__files">
            {snapshot.files.map((file) => (
              <article className="agents-shared-rules__file" key={file.fileName}>
                <div>
                  <strong>{file.cli}</strong>
                  <code>{file.fileName}</code>
                </div>
                <span className={`badge ${statusTone(file.state)}`}>
                  {file.state === "synced" && <CheckIcon size={11} />}
                  {t(statusKey(file.state))}
                </span>
                <small className="mono" title={displayPath(file.path)}>
                  {displayPath(file.path)}
                </small>
              </article>
            ))}
          </div>

          {requiresManualReview && (
            <Callout
              tone="warn"
              title={t("agents.sharedRules.manualReview.title")}
            >
              {t("agents.sharedRules.manualReview.body")}
            </Callout>
          )}

          <label className="field">
            <span className="field__label">AGENTS.md</span>
            <textarea
              className="input agents-shared-rules__input mono"
              value={draft}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
                setSaved(false);
              }}
              placeholder={t("agents.sharedRules.placeholder")}
              rows={12}
              spellCheck={false}
            />
          </label>

          <div className="agents-shared-rules__actions">
            <span
              className={`agents-field-hint${tooLarge ? " is-danger" : ""}`}
              aria-live="polite"
            >
              {t("agents.sharedRules.byteCount", {
                used: bytes,
                max: MAX_SHARED_AGENT_RULES_BYTES,
              })}
              {saved ? ` · ${t("agents.sharedRules.saved")}` : ""}
            </span>
            <button
              type="button"
              className="button button--ghost button--sm"
              disabled={saving}
              onClick={() => {
                setDraft(SHARED_AGENT_RULES_TEMPLATE_ZH_TW);
                setSaved(false);
              }}
            >
              {t("agents.sharedRules.useTemplate")}
            </button>
            <button
              type="button"
              className="button button--primary button--sm"
              disabled={
                saving ||
                disabled ||
                tooLarge ||
                !draft.trim() ||
                requiresManualReview
              }
              onClick={() => void save()}
            >
              {saving
                ? t("agents.sharedRules.saving")
                : t("agents.sharedRules.save")}
            </button>
          </div>
        </>
      )}

      {error && (
        <Callout tone="danger" title={t("agents.sharedRules.error.title")}>
          <span className="mono">{error}</span>
        </Callout>
      )}

      <p className="agents-field-hint agents-shared-rules__boundary">
        {t("agents.sharedRules.boundary")}
      </p>
    </section>
  );
}

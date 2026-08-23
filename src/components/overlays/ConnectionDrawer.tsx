/**
 * Add and edit connection drawer.
 *
 * Five short sections instead of one long form: how to connect, where the host
 * is, how to organise it, sign-in, and a review. Errors appear next to their
 * field and never clear what was typed. Closing a dirty form asks first.
 *
 * The sign-in section holds no inputs on purpose. Until the credential store
 * exists there is nowhere safe to put a secret, so the section explains that
 * rather than offering a field that would quietly keep a password in memory.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  connectionTarget,
  createConnectionProfile,
  draftFromProfile,
  emptyDraft,
  environmentCatalog,
  environmentHintKey,
  environmentLabelKey,
  findDuplicateTarget,
  findProtocol,
  limits,
  parseTags,
  protocolCatalog,
  protocolLabelKey,
  protocolSummaryKey,
  validateConnectionDraft,
  type ConnectionDraft,
  type ConnectionProfile,
  type Environment,
  type Protocol,
  type ValidationErrors,
} from "../../domain/connection";
import { useI18n } from "../../i18n";
import { Chip, EnvironmentBadge, ProtocolTile } from "../common/Badge";
import { Callout } from "../common/Callout";
import { AlertIcon, CheckIcon, CloseIcon } from "../icons";
import { clearValidationError } from "./connectionValidation";

function sameDraft(a: ConnectionDraft, b: ConnectionDraft): boolean {
  return (
    a.name === b.name &&
    a.protocol === b.protocol &&
    a.hostname === b.hostname &&
    a.username === b.username &&
    a.port === b.port &&
    (a.environment ?? "unassigned") === (b.environment ?? "unassigned") &&
    (a.group ?? "") === (b.group ?? "") &&
    (a.favorite ?? false) === (b.favorite ?? false) &&
    (a.tags ?? []).join(",") === (b.tags ?? []).join(",")
  );
}

function Section({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="form-section">
      <h3 className="form-section__title">
        <span className="form-section__step" aria-hidden="true">
          {step}
        </span>
        {title}
      </h3>
      {hint && <p className="form-section__hint">{hint}</p>}
      {children}
    </section>
  );
}

export function ConnectionDrawer({
  profile,
  profiles,
  onSave,
  onClose,
}: {
  /** `null` opens an empty draft; a profile opens it for editing. */
  profile: ConnectionProfile | null;
  profiles: ConnectionProfile[];
  onSave: (draft: ConnectionDraft) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  const initial = useMemo(
    () => (profile ? draftFromProfile(profile) : emptyDraft()),
    [profile],
  );

  const [draft, setDraft] = useState<ConnectionDraft>(initial);
  const [tagInput, setTagInput] = useState((initial.tags ?? []).join(", "));
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [checkResult, setCheckResult] = useState<"valid" | "invalid" | null>(
    null,
  );

  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const dirty =
    !sameDraft(draft, initial) ||
    parseTags(tagInput).join(",") !== (initial.tags ?? []).join(",");

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  function requestClose() {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  // Escape closes; Tab is trapped so focus cannot fall behind the drawer.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        requestClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
      );
      const items = [...focusable].filter(
        (item) => !item.hasAttribute("disabled"),
      );
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  });

  function patch(
    next: Partial<ConnectionDraft>,
    changedField?: keyof ValidationErrors,
  ) {
    setDraft((current) => ({ ...current, ...next }));
    if (changedField) {
      setErrors((current) => clearValidationError(current, changedField));
    }
    setCheckResult(null);
  }

  function selectProtocol(protocol: Protocol) {
    const previousDefault = findProtocol(draft.protocol).defaultPort;
    const nextDefault = findProtocol(protocol).defaultPort;
    // Keep a port the user chose deliberately; move the untouched default.
    patch({
      protocol,
      port: draft.port === previousDefault ? nextDefault : draft.port,
    });
  }

  const candidate = useMemo(
    () =>
      createConnectionProfile(
        { ...draft, tags: parseTags(tagInput) },
        profile?.id ?? "draft",
      ),
    [draft, tagInput, profile],
  );

  const duplicate = useMemo(
    () => findDuplicateTarget(profiles, candidate),
    [profiles, candidate],
  );

  /** Shared by submit and the settings check: validate, then focus the first problem. */
  function validateNow(): ValidationErrors {
    const next = { ...draft, tags: parseTags(tagInput) };
    const found = validateConnectionDraft(next);
    setErrors(found);

    const firstField = Object.keys(found)[0];
    if (firstField) {
      panelRef.current
        ?.querySelector<HTMLElement>(`[data-field="${firstField}"]`)
        ?.focus();
    }

    return found;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Object.keys(validateNow()).length > 0) return;
    onSave({ ...draft, tags: parseTags(tagInput) });
  }

  const title = profile ? t("form.editTitle") : t("form.addTitle");
  const error = (field: keyof ValidationErrors) => {
    const issue = errors[field];
    return issue ? t(issue.key, issue.values) : undefined;
  };

  return (
    <div className="scrim" role="presentation" onMouseDown={requestClose}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="drawer__head">
          <div>
            <p className="eyebrow">
              {profile ? t("form.editEyebrow") : t("form.addEyebrow")}
            </p>
            <h2 className="drawer__title">{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={requestClose}
            aria-label={t("common.close")}
          >
            <CloseIcon />
          </button>
        </header>

        <form className="drawer__body" id={formId} onSubmit={submit} noValidate>
          <Section
            step={1}
            title={t("form.step.protocol")}
            hint={t("form.protocolHint")}
          >
            <div
              className="protocol-picker"
              role="radiogroup"
              aria-label={t("form.step.protocol")}
            >
              {protocolCatalog.map((entry) => {
                const active = draft.protocol === entry.id;
                return (
                  <button
                    type="button"
                    key={entry.id}
                    role="radio"
                    aria-checked={active}
                    className={`protocol-option${active ? " is-selected" : ""}`}
                    onClick={() => selectProtocol(entry.id)}
                  >
                    <ProtocolTile protocol={entry.id} />
                    <span className="protocol-option__text">
                      <strong>{t(protocolLabelKey(entry.id))}</strong>
                      <small>{t(protocolSummaryKey(entry.id))}</small>
                    </span>
                    <span className="protocol-option__port mono">
                      :{entry.defaultPort}
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section step={2} title={t("form.step.target")}>
            <div className="field">
              <label className="field__label" htmlFor={`${formId}-name`}>
                {t("form.name")}
              </label>
              <input
                id={`${formId}-name`}
                data-field="name"
                ref={nameRef}
                className={`input${errors.name ? " is-invalid" : ""}`}
                value={draft.name}
                maxLength={limits.nameLength}
                onChange={(event) =>
                  patch({ name: event.currentTarget.value }, "name")
                }
                placeholder={t("form.namePlaceholder")}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={
                  errors.name ? `${formId}-name-error` : undefined
                }
              />
              {error("name") && (
                <p className="field__error" id={`${formId}-name-error`}>
                  <AlertIcon size={12} />
                  {error("name")}
                </p>
              )}
            </div>

            <div className="field">
              <label className="field__label" htmlFor={`${formId}-host`}>
                {t("form.hostname")}
              </label>
              <input
                id={`${formId}-host`}
                data-field="hostname"
                className={`input mono${errors.hostname ? " is-invalid" : ""}`}
                value={draft.hostname}
                onChange={(event) =>
                  patch({ hostname: event.currentTarget.value }, "hostname")
                }
                placeholder={t("form.hostnamePlaceholder")}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={Boolean(errors.hostname)}
              />
              {error("hostname") && (
                <p className="field__error">
                  <AlertIcon size={12} />
                  {error("hostname")}
                </p>
              )}
            </div>

            <div className="field-grid">
              <div className="field">
                <label className="field__label" htmlFor={`${formId}-user`}>
                  {t("form.username")}
                  <span className="field__optional">{t("common.optional")}</span>
                </label>
                <input
                  id={`${formId}-user`}
                  data-field="username"
                  className={`input mono${errors.username ? " is-invalid" : ""}`}
                  value={draft.username}
                  onChange={(event) =>
                    patch({ username: event.currentTarget.value }, "username")
                  }
                  placeholder={t("form.usernamePlaceholder")}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={Boolean(errors.username)}
                />
                {error("username") && (
                  <p className="field__error">
                    <AlertIcon size={12} />
                    {error("username")}
                  </p>
                )}
              </div>

              <div className="field field--port">
                <label className="field__label" htmlFor={`${formId}-port`}>
                  {t("form.port")}
                </label>
                <input
                  id={`${formId}-port`}
                  data-field="port"
                  type="number"
                  inputMode="numeric"
                  min={limits.minPort}
                  max={limits.maxPort}
                  className={`input mono${errors.port ? " is-invalid" : ""}`}
                  value={Number.isFinite(draft.port) ? draft.port : ""}
                  onChange={(event) =>
                    patch({ port: Number(event.currentTarget.value) }, "port")
                  }
                  aria-invalid={Boolean(errors.port)}
                />
                {error("port") && (
                  <p className="field__error">
                    <AlertIcon size={12} />
                    {error("port")}
                  </p>
                )}
              </div>
            </div>
          </Section>

          <Section
            step={3}
            title={t("form.step.organise")}
            hint={t("form.organiseHint")}
          >
            <div className="field">
              <span className="field__label" id={`${formId}-env-label`}>
                {t("form.environment")}
              </span>
              <div
                className="segmented"
                role="radiogroup"
                aria-labelledby={`${formId}-env-label`}
              >
                {environmentCatalog.map((entry) => {
                  const active = (draft.environment ?? "unassigned") === entry;
                  return (
                    <button
                      type="button"
                      key={entry}
                      role="radio"
                      aria-checked={active}
                      title={t(environmentHintKey(entry))}
                      className={`segmented__option env-${entry}${
                        active ? " is-selected" : ""
                      }`}
                      onClick={() =>
                        patch({ environment: entry as Environment })
                      }
                    >
                      <span className="badge__dot" aria-hidden="true" />
                      {t(environmentLabelKey(entry))}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field-grid field-grid--even">
              <div className="field">
                <label className="field__label" htmlFor={`${formId}-group`}>
                  {t("form.group")}
                  <span className="field__optional">{t("common.optional")}</span>
                </label>
                <input
                  id={`${formId}-group`}
                  data-field="group"
                  className={`input${errors.group ? " is-invalid" : ""}`}
                  value={draft.group ?? ""}
                  maxLength={limits.groupLength}
                  onChange={(event) =>
                    patch({ group: event.currentTarget.value }, "group")
                  }
                  placeholder={t("form.groupPlaceholder")}
                  list={`${formId}-groups`}
                  aria-invalid={Boolean(errors.group)}
                />
                <datalist id={`${formId}-groups`}>
                  {[...new Set(profiles.map((entry) => entry.group))].map(
                    (group) => (
                      <option key={group} value={group} />
                    ),
                  )}
                </datalist>
                {error("group") && (
                  <p className="field__error">
                    <AlertIcon size={12} />
                    {error("group")}
                  </p>
                )}
              </div>

              <div className="field">
                <label className="field__label" htmlFor={`${formId}-tags`}>
                  {t("form.tags")}
                  <span className="field__optional">{t("form.tagsHint")}</span>
                </label>
                <input
                  id={`${formId}-tags`}
                  data-field="tags"
                  className={`input${errors.tags ? " is-invalid" : ""}`}
                  value={tagInput}
                  onChange={(event) => {
                    setTagInput(event.currentTarget.value);
                    setErrors((current) =>
                      clearValidationError(current, "tags"),
                    );
                    setCheckResult(null);
                  }}
                  placeholder={t("form.tagsPlaceholder")}
                  aria-invalid={Boolean(errors.tags)}
                />
                {error("tags") && (
                  <p className="field__error">
                    <AlertIcon size={12} />
                    {error("tags")}
                  </p>
                )}
              </div>
            </div>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.favorite ?? false}
                onChange={(event) =>
                  patch({ favorite: event.currentTarget.checked })
                }
              />
              <span className="checkbox__box" aria-hidden="true">
                <CheckIcon size={11} />
              </span>
              {t("form.favorite")}
            </label>
          </Section>

          <Section step={4} title={t("form.step.auth")}>
            <Callout tone="security" title={t("form.auth.title")}>
              {t("form.auth.body")}
            </Callout>
          </Section>

          <Section step={5} title={t("form.step.review")}>
            <div className="review-card">
              <div className="review-card__head">
                <ProtocolTile protocol={candidate.protocol} size="lg" />
                <div className="review-card__identity">
                  <strong className="truncate">
                    {candidate.name || t("form.review.unnamed")}
                  </strong>
                  <span className="mono truncate">
                    {candidate.hostname
                      ? connectionTarget(candidate)
                      : t("form.review.noHost")}
                  </span>
                </div>
              </div>
              <div className="review-card__badges">
                <EnvironmentBadge environment={candidate.environment} />
                <Chip tone="neutral">
                  {findProtocol(candidate.protocol).acronym}
                </Chip>
                {candidate.favorite && (
                  <Chip tone="accent">{t("connections.favorites")}</Chip>
                )}
              </div>
            </div>

            <button
              type="button"
              className="button button--secondary button--sm"
              onClick={() =>
                setCheckResult(
                  Object.keys(validateNow()).length > 0 ? "invalid" : "valid",
                )
              }
            >
              {t("form.test.button")}
            </button>

            {checkResult === "valid" && (
              <Callout tone="info" title={t("form.test.valid.title")}>
                {t("form.test.valid.body", {
                  port: candidate.port,
                  protocol: findProtocol(candidate.protocol).acronym,
                })}
              </Callout>
            )}

            {checkResult === "invalid" && (
              <Callout tone="warn" title={t("form.test.invalid.title")}>
                {t("form.test.invalid.body")}
              </Callout>
            )}

            {duplicate && (
              <Callout tone="warn" title={t("form.duplicate.title")}>
                {t("form.duplicate.body", {
                  name: duplicate.name,
                  target: connectionTarget(duplicate),
                  protocol: findProtocol(duplicate.protocol).acronym,
                })}
              </Callout>
            )}
          </Section>
        </form>

        {confirmDiscard ? (
          <div className="drawer__foot drawer__foot--confirm">
            <p className="drawer__confirm-text">
              <AlertIcon size={14} />
              {t("form.discard.question")}
            </p>
            <div className="drawer__foot-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setConfirmDiscard(false)}
              >
                {t("form.discard.keep")}
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={onClose}
              >
                {t("form.discard.confirm")}
              </button>
            </div>
          </div>
        ) : (
          <div className="drawer__foot">
            <span className="drawer__foot-note">
              {dirty ? t("form.unsaved") : t("form.noChanges")}
            </span>
            <div className="drawer__foot-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={requestClose}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                form={formId}
                className="button button--primary"
              >
                {profile ? t("form.submit.save") : t("form.submit.add")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

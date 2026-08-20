/**
 * Add and edit connection drawer.
 *
 * Follows the sectioned form from the design brief: Protocol, Target,
 * Organisation, Authentication and Review. Errors appear next to their field
 * and never clear what the user typed. Closing a dirty form asks first.
 *
 * The Authentication section holds no inputs on purpose. Until the credential
 * store exists there is nowhere safe to put a secret, so the section explains
 * that rather than offering a field that would quietly keep a password in
 * memory.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  connectionTarget,
  createConnectionProfile,
  draftFromProfile,
  emptyDraft,
  environmentCatalog,
  findDuplicateTarget,
  findProtocol,
  limits,
  parseTags,
  protocolCatalog,
  validateConnectionDraft,
  type ConnectionDraft,
  type ConnectionProfile,
  type Environment,
  type Protocol,
  type ValidationErrors,
} from "../../domain/connection";
import { Chip, EnvironmentBadge, ProtocolTile } from "../common/Badge";
import { Callout } from "../common/Callout";
import { AlertIcon, CheckIcon, CloseIcon } from "../icons";

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
  const initial = useMemo(
    () => (profile ? draftFromProfile(profile) : emptyDraft()),
    [profile],
  );

  const [draft, setDraft] = useState<ConnectionDraft>(initial);
  const [tagInput, setTagInput] = useState((initial.tags ?? []).join(", "));
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [testNotice, setTestNotice] = useState<{
    tone: "info" | "warn";
    title: string;
    message: string;
  } | null>(null);

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
      const items = [...focusable].filter((item) => !item.hasAttribute("disabled"));
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

  function patch(next: Partial<ConnectionDraft>) {
    setDraft((current) => ({ ...current, ...next }));
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = { ...draft, tags: parseTags(tagInput) };
    const found = validateConnectionDraft(next);
    setErrors(found);

    if (Object.keys(found).length > 0) {
      const firstField = Object.keys(found)[0];
      panelRef.current
        ?.querySelector<HTMLElement>(`[data-field="${firstField}"]`)
        ?.focus();
      return;
    }

    onSave(next);
  }

  const title = profile ? "Edit connection" : "New connection";

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
            <p className="eyebrow">{profile ? "Edit" : "Add"}</p>
            <h2 className="drawer__title">{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={requestClose}
            aria-label="Close"
            data-tooltip="Close (Esc)"
          >
            <CloseIcon />
          </button>
        </header>

        <form className="drawer__body" id={formId} onSubmit={submit} noValidate>
          <section className="form-section">
            <h3 className="form-section__title">1 · Protocol</h3>
            <p className="form-section__hint">
              Choose how this host is reached. The port follows the protocol
              until you set one yourself.
            </p>
            <div className="protocol-picker" role="radiogroup" aria-label="Protocol">
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
                      <strong>{entry.name}</strong>
                      <small>{entry.summary}</small>
                    </span>
                    <span className="protocol-option__port mono">
                      :{entry.defaultPort}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="form-section">
            <h3 className="form-section__title">2 · Target</h3>

            <div className="field">
              <label className="field__label" htmlFor={`${formId}-name`}>
                Display name
              </label>
              <input
                id={`${formId}-name`}
                data-field="name"
                ref={nameRef}
                className={`input${errors.name ? " is-invalid" : ""}`}
                value={draft.name}
                maxLength={limits.nameLength}
                onChange={(event) => patch({ name: event.currentTarget.value })}
                placeholder="Edge gateway"
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? `${formId}-name-error` : undefined}
              />
              {errors.name && (
                <p className="field__error" id={`${formId}-name-error`}>
                  <AlertIcon size={12} />
                  {errors.name}
                </p>
              )}
            </div>

            <div className="field">
              <label className="field__label" htmlFor={`${formId}-host`}>
                Hostname or IP address
              </label>
              <input
                id={`${formId}-host`}
                data-field="hostname"
                className={`input mono${errors.hostname ? " is-invalid" : ""}`}
                value={draft.hostname}
                onChange={(event) =>
                  patch({ hostname: event.currentTarget.value })
                }
                placeholder="gateway.example.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={Boolean(errors.hostname)}
                aria-describedby={
                  errors.hostname ? `${formId}-host-error` : undefined
                }
              />
              {errors.hostname && (
                <p className="field__error" id={`${formId}-host-error`}>
                  <AlertIcon size={12} />
                  {errors.hostname}
                </p>
              )}
            </div>

            <div className="field-grid">
              <div className="field">
                <label className="field__label" htmlFor={`${formId}-user`}>
                  Username <span className="field__optional">Optional</span>
                </label>
                <input
                  id={`${formId}-user`}
                  data-field="username"
                  className={`input mono${errors.username ? " is-invalid" : ""}`}
                  value={draft.username}
                  onChange={(event) =>
                    patch({ username: event.currentTarget.value })
                  }
                  placeholder="operator"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={Boolean(errors.username)}
                />
                {errors.username && (
                  <p className="field__error">
                    <AlertIcon size={12} />
                    {errors.username}
                  </p>
                )}
              </div>

              <div className="field field--port">
                <label className="field__label" htmlFor={`${formId}-port`}>
                  Port
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
                    patch({ port: Number(event.currentTarget.value) })
                  }
                  aria-invalid={Boolean(errors.port)}
                />
                {errors.port && (
                  <p className="field__error">
                    <AlertIcon size={12} />
                    {errors.port}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="form-section">
            <h3 className="form-section__title">3 · Organisation</h3>
            <p className="form-section__hint">
              Environment and group decide how the host is sorted and how
              obviously it stands out in the list.
            </p>

            <div className="field">
              <span className="field__label" id={`${formId}-env-label`}>
                Environment
              </span>
              <div
                className="segmented"
                role="radiogroup"
                aria-labelledby={`${formId}-env-label`}
              >
                {environmentCatalog.map((entry) => {
                  const active =
                    (draft.environment ?? "unassigned") === entry.id;
                  return (
                    <button
                      type="button"
                      key={entry.id}
                      role="radio"
                      aria-checked={active}
                      title={entry.hint}
                      className={`segmented__option env-${entry.id}${
                        active ? " is-selected" : ""
                      }`}
                      onClick={() =>
                        patch({ environment: entry.id as Environment })
                      }
                    >
                      <span className="badge__dot" aria-hidden="true" />
                      {entry.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field-grid field-grid--even">
              <div className="field">
                <label className="field__label" htmlFor={`${formId}-group`}>
                  Group <span className="field__optional">Optional</span>
                </label>
                <input
                  id={`${formId}-group`}
                  data-field="group"
                  className={`input${errors.group ? " is-invalid" : ""}`}
                  value={draft.group ?? ""}
                  maxLength={limits.groupLength}
                  onChange={(event) =>
                    patch({ group: event.currentTarget.value })
                  }
                  placeholder="Core platform"
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
                {errors.group && (
                  <p className="field__error">
                    <AlertIcon size={12} />
                    {errors.group}
                  </p>
                )}
              </div>

              <div className="field">
                <label className="field__label" htmlFor={`${formId}-tags`}>
                  Tags <span className="field__optional">Comma separated</span>
                </label>
                <input
                  id={`${formId}-tags`}
                  data-field="tags"
                  className={`input${errors.tags ? " is-invalid" : ""}`}
                  value={tagInput}
                  onChange={(event) => setTagInput(event.currentTarget.value)}
                  placeholder="edge, eu-west"
                  aria-invalid={Boolean(errors.tags)}
                />
                {errors.tags && (
                  <p className="field__error">
                    <AlertIcon size={12} />
                    {errors.tags}
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
              Pin to favorites
            </label>
          </section>

          <section className="form-section">
            <h3 className="form-section__title">4 · Authentication</h3>
            <Callout tone="security" title="No secret fields, by design">
              LatticeTerm has no credential store yet, so this form never asks
              for a password, passphrase or private key. Keys, agent forwarding
              and jump hosts arrive with the system credential store in
              milestone 2.
            </Callout>
          </section>

          <section className="form-section">
            <h3 className="form-section__title">5 · Review</h3>
            <div className="review-card">
              <div className="review-card__head">
                <ProtocolTile protocol={candidate.protocol} size="lg" />
                <div className="review-card__identity">
                  <strong className="truncate">
                    {candidate.name || "Unnamed connection"}
                  </strong>
                  <span className="mono truncate">
                    {candidate.hostname
                      ? connectionTarget(candidate)
                      : "No host entered yet"}
                  </span>
                </div>
              </div>
              <div className="review-card__badges">
                <EnvironmentBadge
                  environment={candidate.environment}
                />
                <Chip tone="neutral">{findProtocol(candidate.protocol).name}</Chip>
                <Chip tone="neutral">{candidate.group}</Chip>
                {candidate.favorite && <Chip tone="accent">Favorite</Chip>}
              </div>
            </div>

            <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                className="button button--secondary button--sm"
                onClick={() => {
                  const next = { ...draft, tags: parseTags(tagInput) };
                  const found = validateConnectionDraft(next);
                  if (Object.keys(found).length > 0) {
                    setErrors(found);
                    setTestNotice({
                      tone: "warn",
                      title: "Validation check failed",
                      message: "Please correct the form errors before testing.",
                    });
                  } else {
                    setTestNotice({
                      tone: "info",
                      title: "Configuration preflight valid",
                      message: `Target syntax, port (${draft.port}) and protocol (${findProtocol(draft.protocol).name}) are valid. Engine execution connects in Milestone ${findProtocol(draft.protocol).milestone}.`,
                    });
                  }
                }}
              >
                Test configuration
              </button>
            </div>

            {testNotice && (
              <Callout tone={testNotice.tone} title={testNotice.title}>
                {testNotice.message}
              </Callout>
            )}

            {duplicate && (
              <Callout tone="warn" title="Another profile uses this target">
                <strong>{duplicate.name}</strong> already reaches{" "}
                <span className="mono">{connectionTarget(duplicate)}</span> over{" "}
                {findProtocol(duplicate.protocol).name}. Saving is still fine if
                that is deliberate.
              </Callout>
            )}
          </section>
        </form>

        {confirmDiscard ? (
          <div className="drawer__foot drawer__foot--confirm">
            <p className="drawer__confirm-text">
              <AlertIcon size={14} />
              Discard your unsaved changes to this connection?
            </p>
            <div className="drawer__foot-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setConfirmDiscard(false)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={onClose}
              >
                Discard changes
              </button>
            </div>
          </div>
        ) : (
          <div className="drawer__foot">
            <span className="drawer__foot-note">
              {dirty ? "Unsaved changes" : "No changes yet"}
            </span>
            <div className="drawer__foot-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={requestClose}
              >
                Cancel
              </button>
              <button type="submit" form={formId} className="button button--primary">
                {profile ? "Save changes" : "Add connection"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

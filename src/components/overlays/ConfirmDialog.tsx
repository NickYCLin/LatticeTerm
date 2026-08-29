/**
 * Confirmation dialog for destructive actions.
 *
 * The confirm button always names the action and its object — "Delete Edge
 * gateway" — because a bare Yes/No does not tell the user what is about to
 * happen.
 */

import { useEffect, useRef } from "react";
import { AlertIcon } from "../icons";
import { useModalFocus } from "./modalFocus";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalFocus({
    dialogRef,
    getInitialFocus: () =>
      (confirmDisabled ? cancelRef : confirmRef).current,
    onEscape: onCancel,
  });

  useEffect(() => {
    (confirmDisabled ? cancelRef : confirmRef).current?.focus();
  }, [confirmDisabled]);

  return (
    <div className="scrim scrim--center" role="presentation" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={`dialog__icon dialog__icon--${tone}`} aria-hidden="true">
          <AlertIcon size={18} />
        </div>
        <h2 className="dialog__title" id="confirm-title">
          {title}
        </h2>
        <p className="dialog__body" id="confirm-body">
          {body}
        </p>
        <div className="dialog__actions">
          <button
            type="button"
            ref={cancelRef}
            className="button button--ghost"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`button ${tone === "danger" ? "button--danger" : "button--primary"}`}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

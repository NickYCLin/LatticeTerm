import { useRef } from "react";
import { useI18n } from "../../i18n/context";
import { useModalFocus } from "./modalFocus";

export function DesktopBackendRequiredDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useModalFocus({
    dialogRef,
    getInitialFocus: () => closeRef.current,
    onEscape: onClose,
  });

  return (
    <div className="scrim scrim--center" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-backend-required-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog__head">
          <h2 className="dialog__title" id="desktop-backend-required-title">
            {t("desktopBackend.required.title")}
          </h2>
        </header>
        <div className="dialog__stack">
          <p className="dialog__body">{t("desktopBackend.required.body")}</p>
          <div className="dialog__actions">
            <button
              ref={closeRef}
              type="button"
              className="button button--primary"
              onClick={onClose}
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

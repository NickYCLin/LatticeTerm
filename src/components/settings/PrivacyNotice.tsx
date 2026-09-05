import { useI18n } from "../../i18n/context";

/** Bundled text stays available before a network connection is configured. */
export function PrivacyNotice() {
  const { t } = useI18n();
  return (
    <section className="panel glass glass--sheen">
      <header className="panel__head">
        <h2 className="panel__title">{t("settings.privacy.title")}</h2>
      </header>
      <details>
        <summary>{t("settings.privacy.read")}</summary>
        <p>{t("settings.privacy.local")}</p>
        <p>{t("settings.privacy.network")}</p>
        <p>{t("settings.privacy.permissions")}</p>
        <p>{t("settings.privacy.removal")}</p>
        <p>{t("settings.privacy.supportHint")}</p>
        <a href="https://github.com/NickYCLin/lattice-term/issues" target="_blank" rel="noreferrer">
          {t("settings.privacy.support")}
        </a>
      </details>
    </section>
  );
}

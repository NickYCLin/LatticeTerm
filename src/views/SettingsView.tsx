/**
 * Settings.
 *
 * Two kinds of entry, kept visually distinct: preferences that take effect
 * immediately, and security settings that are described but not offered,
 * because the subsystem behind them does not exist yet.
 */

import type {
  DensityChoice,
  MotionChoice,
  Preferences,
} from "../app/preferences";
import { themeCatalog } from "../app/themes";
import type { RuntimeState } from "../app/useRuntimeSummary";
import { localeCatalog, useI18n, type Locale } from "../i18n";
import type { MessageKey } from "../i18n";
import { Chip } from "../components/common/Badge";
import { Callout } from "../components/common/Callout";
import { CheckIcon } from "../components/icons";

interface Choice<T> {
  value: T;
  labelKey: MessageKey;
}

const densityChoices: Choice<DensityChoice>[] = [
  { value: "comfortable", labelKey: "settings.density.comfortable" },
  { value: "compact", labelKey: "settings.density.compact" },
];

const motionChoices: Choice<MotionChoice>[] = [
  { value: "system", labelKey: "settings.motion.system" },
  { value: "reduced", labelKey: "settings.motion.reduced" },
];

const plannedSecurity: { titleKey: MessageKey; detailKey: MessageKey }[] = [
  {
    titleKey: "settings.security.autoLock",
    detailKey: "settings.security.autoLockDetail",
  },
  {
    titleKey: "settings.security.hostKey",
    detailKey: "settings.security.hostKeyDetail",
  },
  {
    titleKey: "settings.security.clipboard",
    detailKey: "settings.security.clipboardDetail",
  },
  {
    titleKey: "settings.security.backup",
    detailKey: "settings.security.backupDetail",
  },
];

function SegmentedSetting<T extends string>({
  title,
  description,
  choices,
  value,
  onChange,
}: {
  title: string;
  description: string;
  choices: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="setting">
      <div className="setting__text">
        <strong className="setting__title">{title}</strong>
        <p className="setting__description">{description}</p>
      </div>
      <div className="segmented" role="radiogroup" aria-label={title}>
        {choices.map((choice) => (
          <button
            type="button"
            key={choice.value}
            role="radio"
            aria-checked={value === choice.value}
            className={`segmented__option${
              value === choice.value ? " is-selected" : ""
            }`}
            onClick={() => onChange(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsView({
  preferences,
  onChange,
  runtime,
}: {
  preferences: Preferences;
  onChange: (patch: Partial<Preferences>) => void;
  runtime: RuntimeState;
}) {
  const { t } = useI18n();
  const { summary, host } = runtime;

  return (
    <div className="stack">
      <section className="panel glass glass--sheen">
        <header className="panel__head">
          <div>
            <h2 className="panel__title">{t("settings.appearance")}</h2>
            <p className="panel__hint">{t("settings.appearanceHint")}</p>
          </div>
        </header>

        <div className="setting">
          <div className="setting__text">
            <strong className="setting__title">{t("settings.theme")}</strong>
            <p className="setting__description">{t("settings.themeHint")}</p>
          </div>
        </div>

        <div className="theme-grid" role="radiogroup" aria-label={t("settings.theme")}>
          {themeCatalog.map((theme) => {
            const selected = preferences.theme === theme.id;
            return (
              <button
                type="button"
                key={theme.id}
                role="radio"
                aria-checked={selected}
                className={`theme-option${selected ? " is-selected" : ""}`}
                onClick={() => onChange({ theme: theme.id })}
              >
                <span className="theme-option__preview" aria-hidden="true">
                  <span style={{ background: theme.swatch[0] }} />
                  <span style={{ background: theme.swatch[1] }} />
                  <span style={{ background: theme.swatch[2] }} />
                </span>
                <span className="theme-option__label">
                  {t(theme.labelKey)}
                  {selected && (
                    <span className="theme-option__check">
                      <CheckIcon size={14} />
                    </span>
                  )}
                </span>
                <span className="theme-option__hint">{t(theme.hintKey)}</span>
              </button>
            );
          })}
        </div>

        <div className="setting-list">
          <SegmentedSetting
            title={t("settings.language")}
            description={t("settings.languageHint")}
            choices={localeCatalog.map((entry) => ({
              value: entry.id,
              label: entry.label,
            }))}
            value={preferences.locale}
            onChange={(locale: Locale) => onChange({ locale })}
          />
          <SegmentedSetting
            title={t("settings.density")}
            description={t("settings.densityHint")}
            choices={densityChoices.map((choice) => ({
              value: choice.value,
              label: t(choice.labelKey),
            }))}
            value={preferences.density}
            onChange={(density) => onChange({ density })}
          />
          <SegmentedSetting
            title={t("settings.motion")}
            description={t("settings.motionHint")}
            choices={motionChoices.map((choice) => ({
              value: choice.value,
              label: t(choice.labelKey),
            }))}
            value={preferences.motion}
            onChange={(motion) => onChange({ motion })}
          />
        </div>
      </section>

      <section className="panel glass glass--sheen">
        <header className="panel__head">
          <div>
            <h2 className="panel__title">{t("settings.security")}</h2>
            <p className="panel__hint">{t("settings.securityHint")}</p>
          </div>
        </header>

        <Callout tone="security" title={t("settings.security.title")}>
          {t("settings.security.body")}
        </Callout>

        <ul className="planned-list">
          {plannedSecurity.map((entry) => (
            <li className="planned-list__item" key={entry.titleKey}>
              <div className="planned-list__text">
                <strong>{t(entry.titleKey)}</strong>
                <small>{t(entry.detailKey)}</small>
              </div>
              <Chip tone="planned">{t("common.comingSoon")}</Chip>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel glass glass--sheen">
        <header className="panel__head">
          <div>
            <h2 className="panel__title">{t("settings.about")}</h2>
            <p className="panel__hint">{t("settings.aboutHint")}</p>
          </div>
        </header>

        <dl className="field-list">
          <div className="field-row">
            <dt className="field-row__label">
              {t("settings.about.application")}
            </dt>
            <dd className="field-row__value">
              {summary?.appName ?? t("common.appName")}
            </dd>
          </div>
          <div className="field-row">
            <dt className="field-row__label">{t("settings.about.version")}</dt>
            <dd className="field-row__value mono">{summary?.version ?? "—"}</dd>
          </div>
          <div className="field-row">
            <dt className="field-row__label">{t("settings.about.runtime")}</dt>
            <dd className="field-row__value">
              {host === "tauri"
                ? t("settings.about.runtime.tauri")
                : host === "browser"
                  ? t("settings.about.runtime.browser")
                  : t("common.detecting")}
            </dd>
          </div>
          <div className="field-row">
            <dt className="field-row__label">
              {t("settings.about.credentialStore")}
            </dt>
            <dd className="field-row__value">
              {summary?.credentialStorageReady ? (
                <Chip tone="ok">{t("settings.about.credentialStore.ready")}</Chip>
              ) : (
                <Chip tone="planned">
                  {t("settings.about.credentialStore.pending")}
                </Chip>
              )}
            </dd>
          </div>
          <div className="field-row">
            <dt className="field-row__label">{t("settings.about.license")}</dt>
            <dd className="field-row__value">Mozilla Public License 2.0</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

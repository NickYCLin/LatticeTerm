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
  ThemeChoice,
} from "../app/preferences";
import type { RuntimeState } from "../app/useRuntimeSummary";
import { Chip } from "../components/common/Badge";
import { Callout } from "../components/common/Callout";

interface Choice<T> {
  value: T;
  label: string;
  hint: string;
}

const themeChoices: Choice<ThemeChoice>[] = [
  { value: "dark", label: "Dark", hint: "Default, tuned for long sessions" },
  { value: "light", label: "Light", hint: "For bright rooms" },
  { value: "system", label: "System", hint: "Follow the desktop setting" },
];

const densityChoices: Choice<DensityChoice>[] = [
  { value: "comfortable", label: "Comfortable", hint: "Roomier rows" },
  { value: "compact", label: "Compact", hint: "More hosts per screen" },
];

const motionChoices: Choice<MotionChoice>[] = [
  { value: "system", label: "System", hint: "Follow the desktop setting" },
  { value: "reduced", label: "Reduced", hint: "Suppress transitions" },
];

const plannedSecuritySettings = [
  {
    label: "Auto-lock the vault",
    detail: "Lock after a period of inactivity, and when the app loses focus.",
    milestone: 2,
  },
  {
    label: "Host key verification policy",
    detail: "Strict known_hosts checking, with an explicit trust decision on first connect.",
    milestone: 2,
  },
  {
    label: "Clipboard clearing",
    detail: "Clear copied secrets after a countdown, with an option to clear now.",
    milestone: 2,
  },
  {
    label: "Encrypted backup and recovery",
    detail: "Export and restore the local store without exposing its contents.",
    milestone: 2,
  },
];

function SettingRow<T extends string>({
  title,
  description,
  choices,
  value,
  onChange,
  name,
}: {
  title: string;
  description: string;
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  name: string;
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
            name={name}
            aria-checked={value === choice.value}
            title={choice.hint}
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
  const { summary, host } = runtime;

  return (
    <div className="stack">
      <section className="panel">
        <header className="panel__head">
          <div>
            <h2 className="panel__title">Appearance</h2>
            <p className="panel__hint">Applies immediately and is remembered.</p>
          </div>
        </header>

        <div className="setting-list">
          <SettingRow
            name="theme"
            title="Theme"
            description="Dark is the default. The light theme uses the same tokens with a higher-contrast accent."
            choices={themeChoices}
            value={preferences.theme}
            onChange={(theme) => onChange({ theme })}
          />
          <SettingRow
            name="density"
            title="Density"
            description="Compact tightens row height and spacing for large host inventories."
            choices={densityChoices}
            value={preferences.density}
            onChange={(density) => onChange({ density })}
          />
          <SettingRow
            name="motion"
            title="Motion"
            description="Reduced removes transitions even when the desktop does not request it."
            choices={motionChoices}
            value={preferences.motion}
            onChange={(motion) => onChange({ motion })}
          />
        </div>
      </section>

      <section className="panel">
        <header className="panel__head">
          <div>
            <h2 className="panel__title">Security</h2>
            <p className="panel__hint">
              Described here so the plan is visible; no control is offered until
              the subsystem behind it exists.
            </p>
          </div>
        </header>

        <Callout tone="security" title="No secrets are stored today">
          This build keeps connection metadata in memory and asks for no
          credential of any kind. Nothing is written to disk except the
          appearance preferences above.
        </Callout>

        <ul className="planned-list">
          {plannedSecuritySettings.map((entry) => (
            <li className="planned-list__item" key={entry.label}>
              <div className="planned-list__text">
                <strong>{entry.label}</strong>
                <small>{entry.detail}</small>
              </div>
              <Chip tone="planned">Milestone {entry.milestone}</Chip>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <header className="panel__head">
          <div>
            <h2 className="panel__title">About</h2>
            <p className="panel__hint">Reported by the running build.</p>
          </div>
        </header>

        <dl className="field-list">
          <div className="field-row">
            <dt className="field-row__label">Application</dt>
            <dd className="field-row__value">
              {summary?.appName ?? "LatticeTerm"}
            </dd>
          </div>
          <div className="field-row">
            <dt className="field-row__label">Version</dt>
            <dd className="field-row__value mono">
              {summary?.version ?? "unknown"}
            </dd>
          </div>
          <div className="field-row">
            <dt className="field-row__label">Runtime</dt>
            <dd className="field-row__value">
              {host === "tauri"
                ? "Tauri desktop window"
                : host === "browser"
                  ? "Browser preview (no desktop backend)"
                  : "Detecting…"}
            </dd>
          </div>
          <div className="field-row">
            <dt className="field-row__label">Credential store</dt>
            <dd className="field-row__value">
              {summary?.credentialStorageReady ? (
                <Chip tone="ok">Ready</Chip>
              ) : (
                <Chip tone="planned">Not implemented</Chip>
              )}
            </dd>
          </div>
          <div className="field-row">
            <dt className="field-row__label">Licence</dt>
            <dd className="field-row__value">Mozilla Public License 2.0</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

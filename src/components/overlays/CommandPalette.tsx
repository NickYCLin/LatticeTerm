/**
 * Command palette.
 *
 * The keyboard route to everything the workspace can actually do: jump to an
 * area, open a connection profile, or change an appearance preference. Only
 * real actions are listed — nothing planned appears here as a dead entry.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { connectionTarget, type ConnectionProfile } from "../../domain/connection";
import { matchesSearch } from "../../domain/query";
import { useI18n } from "../../i18n/context";
import { ProtocolTile } from "../common/Badge";
import { Kbd } from "../common/Callout";
import { SearchIcon } from "../icons";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon?: ReactNode;
  keys?: string[];
  run: () => void;
}

export function CommandPalette({
  commands,
  profiles,
  onSelectProfile,
  onClose,
}: {
  commands: Command[];
  profiles: ConnectionProfile[];
  onSelectProfile: (profile: ConnectionProfile) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => {
    const term = query.trim().toLowerCase();

    const matchedCommands = commands.filter(
      (command) =>
        !term ||
        `${command.label} ${command.hint ?? ""} ${command.group}`
          .toLowerCase()
          .includes(term),
    );

    const matchedProfiles = profiles
      .filter((profile) => matchesSearch(profile, query))
      .slice(0, 8)
      .map<Command>((profile) => ({
        id: `profile:${profile.id}`,
        label: profile.name,
        hint: connectionTarget(profile),
        group: t("palette.group.connections"),
        icon: <ProtocolTile protocol={profile.protocol} size="sm" />,
        run: () => onSelectProfile(profile),
      }));

    return [...matchedProfiles, ...matchedCommands];
  }, [commands, profiles, query, onSelectProfile, t]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (entries.length ? (index + 1) % entries.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) =>
        entries.length ? (index - 1 + entries.length) % entries.length : 0,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = entries[active];
      if (entry) {
        entry.run();
        onClose();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  let lastGroup = "";

  return (
    <div className="scrim scrim--top" role="presentation" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette__search">
          <span aria-hidden="true">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
            aria-controls="palette-list"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <Kbd keys={["Esc"]} />
        </div>

        {entries.length === 0 ? (
          <p className="palette__empty">{t("palette.empty", { query })}</p>
        ) : (
          <ul className="palette__list" id="palette-list" ref={listRef} role="listbox">
            {entries.map((entry, index) => {
              const heading = entry.group !== lastGroup ? entry.group : null;
              lastGroup = entry.group;

              return (
                <li key={entry.id}>
                  {heading && <p className="palette__group eyebrow">{heading}</p>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    data-active={index === active}
                    className={`palette__item${index === active ? " is-active" : ""}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => {
                      entry.run();
                      onClose();
                    }}
                  >
                    {entry.icon && (
                      <span className="palette__icon">{entry.icon}</span>
                    )}
                    <span className="palette__label truncate">{entry.label}</span>
                    {entry.hint && (
                      <span className="palette__hint mono truncate">
                        {entry.hint}
                      </span>
                    )}
                    {entry.keys && <Kbd keys={entry.keys} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <footer className="palette__foot">
          <span>
            <Kbd keys={["↑", "↓"]} /> {t("palette.navigate")}
          </span>
          <span>
            <Kbd keys={["Enter"]} /> {t("palette.run")}
          </span>
          <span>
            <Kbd keys={["Esc"]} /> {t("palette.dismiss")}
          </span>
        </footer>
      </div>
    </div>
  );
}

import { Fragment, useState, type ReactNode } from "react";
import { changelogReleases } from "../../app/changelog";
import { useI18n } from "../../i18n/context";
import { Chip } from "../common/Badge";

const INITIAL_RELEASE_COUNT = 6;

function renderInlineMarkdown(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|\[([^\]]+)]\((https?:\/\/[^)]+)\)|`([^`]+)`)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    if (match[2]) {
      nodes.push(<strong key={`${match.index}-strong`}>{match[2]}</strong>);
    } else if (match[3] && match[4]) {
      nodes.push(
        <a
          key={`${match.index}-link`}
          href={match[4]}
          target="_blank"
          rel="noreferrer"
        >
          {match[3]}
        </a>,
      );
    } else if (match[5]) {
      nodes.push(<code key={`${match.index}-code`}>{match[5]}</code>);
    }
    cursor = pattern.lastIndex;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes.map((node, index) => <Fragment key={index}>{node}</Fragment>);
}

export function ChangelogPanel({ currentVersion }: { currentVersion: string }) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const releases = showAll
    ? changelogReleases
    : changelogReleases.slice(0, INITIAL_RELEASE_COUNT);

  return (
    <div className="changelog">
      <div className="changelog__head">
        <div>
          <h3 className="changelog__title">{t("settings.changelog")}</h3>
          <p className="changelog__hint">
            {t("settings.changelogHint", { count: changelogReleases.length })}
          </p>
        </div>
      </div>

      <div className="changelog__timeline">
        {releases.map((release, index) => (
          <details
            className="changelog-release"
            key={release.version}
            open={index === 0}
          >
            <summary className="changelog-release__summary">
              <span className="changelog-release__version">v{release.version}</span>
              {release.version === currentVersion && (
                <Chip tone="ok">{t("settings.changelog.current")}</Chip>
              )}
              <time className="changelog-release__date" dateTime={release.date}>
                {release.date}
              </time>
            </summary>
            <div className="changelog-release__body">
              {release.sections.map((section) => (
                <section key={section.title} className="changelog-section">
                  <h4>{section.title}</h4>
                  <ul>
                    {section.items.map((item, itemIndex) => (
                      <li key={`${release.version}-${itemIndex}`}>
                        {renderInlineMarkdown(item)}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              <a
                className="changelog-release__link"
                href={release.url}
                target="_blank"
                rel="noreferrer"
              >
                {t("settings.changelog.github")}
              </a>
            </div>
          </details>
        ))}
      </div>

      {changelogReleases.length > INITIAL_RELEASE_COUNT && (
        <button
          type="button"
          className="button button--ghost changelog__toggle"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll
            ? t("settings.changelog.collapse")
            : t("settings.changelog.showAll")}
        </button>
      )}
    </div>
  );
}

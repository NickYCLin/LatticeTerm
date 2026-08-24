/**
 * The shape every not-yet-built area shares.
 *
 * It says what the area will do, what has to land first, and what the security
 * boundary will be — instead of a greyed-out mock that looks like a feature
 * waiting to be switched on.
 */

import type { ReactNode } from "react";
import { useI18n } from "../i18n/context";
import type { MessageKey } from "../i18n/context";
import { Chip } from "../components/common/Badge";
import { Callout } from "../components/common/Callout";

export interface PlannedArea {
  summaryKey: MessageKey;
  boundaryKey: MessageKey;
  capabilities: { titleKey: MessageKey; detailKey: MessageKey }[];
  icon: ReactNode;
}

export function PlannedView({ area }: { area: PlannedArea }) {
  const { t } = useI18n();

  return (
    <div className="stack">
      <section className="panel panel--hero glass glass--sheen">
        <span className="panel__hero-icon" aria-hidden="true">
          {area.icon}
        </span>
        <div className="panel__hero-text">
          <div className="panel__hero-badges">
            <Chip tone="planned">{t("planned.badge")}</Chip>
            <Chip tone="neutral">{t("planned.notReady")}</Chip>
          </div>
          <p className="panel__hero-summary">{t(area.summaryKey)}</p>
        </div>
      </section>

      <section className="panel glass glass--sheen">
        <header className="panel__head">
          <div>
            <h2 className="panel__title">{t("planned.whatItDoes")}</h2>
            <p className="panel__hint">{t("planned.whatItDoesHint")}</p>
          </div>
        </header>

        <ul className="planned-list">
          {area.capabilities.map((capability) => (
            <li className="planned-list__item" key={capability.titleKey}>
              <div className="planned-list__text">
                <strong>{t(capability.titleKey)}</strong>
                <small>{t(capability.detailKey)}</small>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Callout tone="security" title={t("planned.boundary")}>
        {t(area.boundaryKey)}
      </Callout>
    </div>
  );
}

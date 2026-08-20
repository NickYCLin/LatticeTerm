/**
 * The shape every not-yet-built area shares.
 *
 * It states what the area will do, what has to land first, and what the
 * security boundary will be — instead of showing a greyed-out mock that looks
 * like a feature waiting to be switched on.
 */

import type { ReactNode } from "react";
import { Chip } from "../components/common/Badge";
import { Callout } from "../components/common/Callout";

export interface PlannedArea {
  milestone: number;
  summary: string;
  capabilities: { title: string; detail: string }[];
  boundary: string;
  icon: ReactNode;
}

export function PlannedView({ area }: { area: PlannedArea }) {
  return (
    <div className="stack">
      <section className="panel panel--hero">
        <span className="panel__hero-icon" aria-hidden="true">
          {area.icon}
        </span>
        <div className="panel__hero-text">
          <div className="panel__hero-badges">
            <Chip tone="planned">Milestone {area.milestone}</Chip>
            <Chip tone="neutral">Not implemented</Chip>
          </div>
          <p className="panel__hero-summary">{area.summary}</p>
        </div>
      </section>

      <section className="panel">
        <header className="panel__head">
          <div>
            <h2 className="panel__title">What this area will do</h2>
            <p className="panel__hint">
              Listed so the plan is auditable, not to imply it works today.
            </p>
          </div>
        </header>

        <ul className="planned-list">
          {area.capabilities.map((capability) => (
            <li className="planned-list__item" key={capability.title}>
              <div className="planned-list__text">
                <strong>{capability.title}</strong>
                <small>{capability.detail}</small>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Callout tone="security" title="Security boundary first">
        {area.boundary}
      </Callout>
    </div>
  );
}

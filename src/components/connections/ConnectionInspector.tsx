/**
 * Details for the selected connection, in two tabs.
 *
 * "Details" is what the entry contains. "Host status" is what the machine is
 * doing — processor, memory and disk — which only exists once a session does,
 * so it renders the honest unavailable state until then.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import {
  UNGROUPED,
  connectionTarget,
  environmentLabelKey,
  findProtocol,
  protocolCatalog,
  protocolLabelKey,
  protocolSummaryKey,
  type ConnectionProfile,
} from "../../domain/connection";
import type { MetricsState } from "../../domain/metrics";
import { useI18n } from "../../i18n";
import { Chip, EnvironmentBadge, ProtocolTile, TagChip } from "../common/Badge";
import { Callout } from "../common/Callout";
import { CloseIcon, DuplicateIcon, EditIcon, TrashIcon } from "../icons";
import { HostMetricsPanel } from "./HostMetricsPanel";

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="field-row">
      <dt className="field-row__label">{label}</dt>
      <dd className="field-row__value">{value}</dd>
    </div>
  );
}

export function ConnectionInspector({
  profile,
  metrics,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  profile: ConnectionProfile;
  metrics: MetricsState;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"info" | "metrics">("info");
  const protocol = findProtocol(profile.protocol);

  return (
    <aside className="inspector glass glass--sheen" aria-label={profile.name}>
      <div className="inspector__head">
        <ProtocolTile protocol={profile.protocol} size="lg" />
        <div className="inspector__identity">
          <h2 className="inspector__name truncate">{profile.name}</h2>
          <p className="inspector__target mono truncate">
            {connectionTarget(profile)}
          </p>
        </div>
        <button
          type="button"
          className="icon-button icon-button--sm"
          onClick={onClose}
          aria-label={t("inspector.close")}
        >
          <CloseIcon size={14} />
        </button>
      </div>

      <div className="inspector__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "info"}
          className={`inspector__tab${tab === "info" ? " is-active" : ""}`}
          onClick={() => setTab("info")}
        >
          {t("inspector.tab.info")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "metrics"}
          className={`inspector__tab${tab === "metrics" ? " is-active" : ""}`}
          onClick={() => setTab("metrics")}
        >
          {t("inspector.tab.metrics")}
        </button>
      </div>

      <div className="inspector__scroll">
        {tab === "info" ? (
          <>
            <div className="inspector__badges">
              <EnvironmentBadge environment={profile.environment} />
              <Chip tone="neutral">{protocol.acronym}</Chip>
              {profile.favorite && (
                <Chip tone="accent">{t("connections.favorites")}</Chip>
              )}
            </div>

            <section className="inspector__section">
              <h3 className="eyebrow">{t("inspector.section.target")}</h3>
              <dl className="field-list">
                <Field
                  label={t("inspector.host")}
                  value={<span className="mono">{profile.hostname}</span>}
                />
                <Field
                  label={t("inspector.port")}
                  value={<span className="mono">{profile.port}</span>}
                />
                <Field
                  label={t("inspector.username")}
                  value={
                    profile.username ? (
                      <span className="mono">{profile.username}</span>
                    ) : (
                      <span className="text-faint">{t("common.notSet")}</span>
                    )
                  }
                />
                <Field
                  label={t("inspector.environment")}
                  value={t(environmentLabelKey(profile.environment))}
                />
                <Field
                  label={t("inspector.group")}
                  value={
                    profile.group === UNGROUPED ? (
                      <span className="text-faint">
                        {t("connections.ungrouped")}
                      </span>
                    ) : (
                      profile.group
                    )
                  }
                />
                <Field
                  label={t("inspector.tags")}
                  value={
                    profile.tags.length > 0 ? (
                      <span className="inspector__tags">
                        {profile.tags.map((tag) => (
                          <TagChip key={tag} label={tag} />
                        ))}
                      </span>
                    ) : (
                      <span className="text-faint">{t("common.none")}</span>
                    )
                  }
                />
              </dl>
            </section>

            <section className="inspector__section">
              <h3 className="eyebrow">{t("inspector.services")}</h3>
              <ul className="service-list">
                {protocolCatalog.map((entry) => (
                  <li className="service-list__item" key={entry.id}>
                    <ProtocolTile protocol={entry.id} size="sm" />
                    <span className="service-list__text">
                      <strong>{t(protocolLabelKey(entry.id))}</strong>
                      <small>{t(protocolSummaryKey(entry.id))}</small>
                    </span>
                    <Chip tone={entry.available ? "ok" : "planned"}>
                      {t(
                        entry.available
                          ? "common.available"
                          : "common.comingSoon",
                      )}
                    </Chip>
                  </li>
                ))}
              </ul>
            </section>

            <Callout tone="security" title={t("inspector.security.title")}>
              {t("inspector.security.body")}
            </Callout>
          </>
        ) : (
          <HostMetricsPanel state={metrics} />
        )}
      </div>

      <div className="inspector__footer">
        <button
          type="button"
          className="button button--secondary button--sm"
          onClick={onEdit}
        >
          <EditIcon size={14} />
          {t("common.edit")}
        </button>
        <button
          type="button"
          className="button button--ghost button--sm"
          onClick={onDuplicate}
        >
          <DuplicateIcon size={14} />
          {t("common.duplicate")}
        </button>
        <button
          type="button"
          className="button button--ghost button--danger button--sm"
          onClick={onDelete}
        >
          <TrashIcon size={14} />
          {t("common.delete")}
        </button>
      </div>
    </aside>
  );
}

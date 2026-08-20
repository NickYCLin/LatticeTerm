/**
 * Inspector for the selected connection.
 *
 * Shows what the profile actually contains, then states plainly which services
 * on that host are still planned and when they arrive. Nothing here implies a
 * session can be opened today.
 */

import {
  connectionTarget,
  findEnvironment,
  findProtocol,
  protocolCatalog,
  UNGROUPED,
  type ConnectionProfile,
} from "../../domain/connection";
import { Chip, EnvironmentBadge, ProtocolTile, TagChip } from "../common/Badge";
import { Callout } from "../common/Callout";
import { CloseIcon, DuplicateIcon, EditIcon, TrashIcon } from "../icons";
import type { ReactNode } from "react";

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
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  profile: ConnectionProfile;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const protocol = findProtocol(profile.protocol);

  return (
    <aside className="inspector" aria-label={`Details for ${profile.name}`}>
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
          aria-label="Close details"
          data-tooltip="Close details"
        >
          <CloseIcon size={14} />
        </button>
      </div>

      <div className="inspector__badges">
        <EnvironmentBadge environment={profile.environment} />
        <Chip tone="neutral">{protocol.name}</Chip>
        {profile.favorite && <Chip tone="accent">Favorite</Chip>}
      </div>

      <div className="inspector__scroll">
        <section className="inspector__section">
          <h3 className="eyebrow">Target</h3>
          <dl className="field-list">
            <Field
              label="Host"
              value={<span className="mono">{profile.hostname}</span>}
            />
            <Field
              label="Port"
              value={<span className="mono">{profile.port}</span>}
            />
            <Field
              label="Username"
              value={
                profile.username ? (
                  <span className="mono">{profile.username}</span>
                ) : (
                  <span className="text-faint">Not set</span>
                )
              }
            />
            <Field
              label="Environment"
              value={findEnvironment(profile.environment).label}
            />
            <Field
              label="Group"
              value={
                profile.group === UNGROUPED ? (
                  <span className="text-faint">Ungrouped</span>
                ) : (
                  profile.group
                )
              }
            />
            <Field
              label="Tags"
              value={
                profile.tags.length > 0 ? (
                  <span className="inspector__tags">
                    {profile.tags.map((tag) => (
                      <TagChip key={tag} label={tag} />
                    ))}
                  </span>
                ) : (
                  <span className="text-faint">None</span>
                )
              }
            />
          </dl>
        </section>

        <section className="inspector__section">
          <h3 className="eyebrow">Services on this host</h3>
          <ul className="service-list">
            {protocolCatalog.map((entry) => (
              <li className="service-list__item" key={entry.id}>
                <ProtocolTile protocol={entry.id} size="sm" />
                <span className="service-list__text">
                  <strong>{entry.name}</strong>
                  <small>{entry.summary}</small>
                </span>
                <Chip tone="planned">Milestone {entry.milestone}</Chip>
              </li>
            ))}
          </ul>
        </section>

        <section className="inspector__section">
          <Callout tone="security" title="No credentials are attached">
            This profile holds host metadata only. Keys, passwords and host
            trust move into the system credential store in milestone 2.
          </Callout>
        </section>
      </div>

      <div className="inspector__footer">
        <button type="button" className="button button--secondary" onClick={onEdit}>
          <EditIcon size={14} />
          Edit
        </button>
        <button type="button" className="button button--ghost" onClick={onDuplicate}>
          <DuplicateIcon size={14} />
          Duplicate
        </button>
        <button
          type="button"
          className="button button--ghost button--danger"
          onClick={onDelete}
        >
          <TrashIcon size={14} />
          Delete
        </button>
      </div>
    </aside>
  );
}

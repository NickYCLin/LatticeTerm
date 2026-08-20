/**
 * One connection row.
 *
 * The row itself selects the profile; every other control is a sibling button
 * so nothing is nested inside an interactive element. `Connect` is deliberately
 * not a button: no protocol engine exists yet, and a disabled button would
 * suggest the capability is merely unavailable right now.
 */

import {
  connectionTarget,
  findProtocol,
  type ConnectionProfile,
} from "../../domain/connection";
import { EnvironmentBadge, ProtocolTile, TagChip } from "../common/Badge";
import { DuplicateIcon, EditIcon, StarIcon, TrashIcon } from "../icons";

export function ConnectionRow({
  profile,
  selected,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
  onToggleFavorite,
}: {
  profile: ConnectionProfile;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}) {
  const protocol = findProtocol(profile.protocol);

  return (
    <li className={`connection-row${selected ? " is-selected" : ""}`}>
      <button
        type="button"
        className="connection-row__main"
        onClick={onSelect}
        aria-pressed={selected}
      >
        <ProtocolTile protocol={profile.protocol} />

        <span className="connection-row__text">
          <span className="connection-row__name truncate">{profile.name}</span>
          <span className="connection-row__target mono truncate">
            {connectionTarget(profile)}
          </span>
        </span>

        <span className="connection-row__meta">
          <EnvironmentBadge environment={profile.environment} />
          {profile.tags.slice(0, 2).map((tag) => (
            <TagChip key={tag} label={tag} />
          ))}
          {profile.tags.length > 2 && (
            <span className="badge badge--tag">
              +{profile.tags.length - 2}
            </span>
          )}
        </span>

        <span className="connection-row__protocol">{protocol.name}</span>
      </button>

      <div className="connection-row__actions">
        <span
          className="badge badge--tone tone-planned connection-row__planned"
          title={`Connecting over ${protocol.name} arrives in milestone ${protocol.milestone}`}
        >
          Connect · Planned
        </span>

        <button
          type="button"
          className="icon-button icon-button--sm"
          onClick={onToggleFavorite}
          aria-pressed={profile.favorite}
          aria-label={
            profile.favorite
              ? `Remove ${profile.name} from favorites`
              : `Add ${profile.name} to favorites`
          }
          data-tooltip={profile.favorite ? "Unfavorite" : "Favorite"}
        >
          <StarIcon
            size={14}
            filled={profile.favorite}
            className={profile.favorite ? "is-favorite" : undefined}
          />
        </button>

        <button
          type="button"
          className="icon-button icon-button--sm"
          onClick={onEdit}
          aria-label={`Edit ${profile.name}`}
          data-tooltip="Edit"
        >
          <EditIcon size={14} />
        </button>

        <button
          type="button"
          className="icon-button icon-button--sm"
          onClick={onDuplicate}
          aria-label={`Duplicate ${profile.name}`}
          data-tooltip="Duplicate"
        >
          <DuplicateIcon size={14} />
        </button>

        <button
          type="button"
          className="icon-button icon-button--sm icon-button--danger"
          onClick={onDelete}
          aria-label={`Delete ${profile.name}`}
          data-tooltip="Delete"
        >
          <TrashIcon size={14} />
        </button>
      </div>
    </li>
  );
}

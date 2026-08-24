/**
 * One connection card.
 *
 * The card body opens the details panel; the star and the action buttons sit
 * above it as siblings, so nothing is nested inside another control. "Connect"
 * is deliberately not a button — no engine exists yet, and a disabled button
 * would suggest the capability is merely unavailable right now.
 */

import {
  connectionTarget,
  findProtocol,
  type ConnectionProfile,
} from "../../domain/connection";
import { useI18n } from "../../i18n/context";
import { EnvironmentBadge, ProtocolTile, TagChip } from "../common/Badge";
import {
  DuplicateIcon,
  EditIcon,
  StarIcon,
  TerminalIcon,
  TrashIcon,
} from "../icons";

export function ConnectionCard({
  profile,
  selected,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
  onToggleFavorite,
  onConnect,
}: {
  profile: ConnectionProfile;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  /** Provided only for protocols that can actually open a session today. */
  onConnect?: () => void;
}) {
  const { t } = useI18n();
  const protocol = findProtocol(profile.protocol);

  return (
    <li
      className={`connection-card glass glass--sheen${selected ? " is-selected" : ""}`}
    >
      <button
        type="button"
        className="connection-card__open"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={t("row.details", { name: profile.name })}
      />

      <div className="connection-card__head">
        <ProtocolTile protocol={profile.protocol} />
        <span className="connection-card__text">
          <span className="connection-card__name truncate">{profile.name}</span>
          <span className="connection-card__target mono truncate">
            {connectionTarget(profile)}
          </span>
        </span>
        <button
          type="button"
          className="icon-button icon-button--sm"
          onClick={onToggleFavorite}
          aria-pressed={profile.favorite}
          aria-label={
            profile.favorite
              ? t("row.removeFavorite", { name: profile.name })
              : t("row.addFavorite", { name: profile.name })
          }
        >
          <StarIcon
            size={15}
            filled={profile.favorite}
            className={profile.favorite ? "is-favorite" : undefined}
          />
        </button>
      </div>

      <div className="connection-card__meta">
        <EnvironmentBadge environment={profile.environment} />
        <span className="badge tone-neutral">{protocol.acronym}</span>
        {profile.tags.slice(0, 2).map((tag) => (
          <TagChip key={tag} label={tag} />
        ))}
        {profile.tags.length > 2 && (
          <span className="badge badge--tag">+{profile.tags.length - 2}</span>
        )}
      </div>

      <div className="connection-card__foot">
        {onConnect ? (
          <button
            type="button"
            className="button button--primary button--sm connection-card__go"
            onClick={onConnect}
          >
            <TerminalIcon size={13} />
            {t("row.connect")}
          </button>
        ) : (
          <span
            className="connection-card__connect"
            title={t("row.connectComingSoon")}
          >
            {t("row.connect")} · {t("common.comingSoon")}
          </span>
        )}

        <div className="connection-card__actions">
          <button
            type="button"
            className="icon-button icon-button--sm"
            onClick={onEdit}
            aria-label={t("row.edit", { name: profile.name })}
            data-tooltip={t("common.edit")}
          >
            <EditIcon size={14} />
          </button>
          <button
            type="button"
            className="icon-button icon-button--sm"
            onClick={onDuplicate}
            aria-label={t("row.duplicate", { name: profile.name })}
            data-tooltip={t("common.duplicate")}
          >
            <DuplicateIcon size={14} />
          </button>
          <button
            type="button"
            className="icon-button icon-button--sm icon-button--danger"
            onClick={onDelete}
            aria-label={t("row.delete", { name: profile.name })}
            data-tooltip={t("common.delete")}
          >
            <TrashIcon size={14} />
          </button>
        </div>
      </div>
    </li>
  );
}

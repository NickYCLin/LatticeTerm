/**
 * Turning a successful "connect by ID" into a saved entry.
 *
 * Dialing a nine-digit device ID used to leave nothing behind, so the next
 * session meant retyping the ID and the relay address even though neither is
 * a secret. Remembering the device puts it in My connections alongside every
 * other host; only the pairing code is asked for again, because that one is a
 * one-time secret that must not be stored.
 */

import {
  draftFromProfile,
  isRelayProfile,
  type ConnectionDraft,
  type ConnectionProfile,
} from "../domain/connection";
import { formatDeviceId } from "./remoteRelay";

export interface RelayDeviceVisit {
  deviceId: string;
  relayAddress: string;
  /** The name the Agent reported, if it sent one. */
  agentName?: string;
}

/** An entry to create, or an existing one to rewrite. */
export type RelayDeviceMemory =
  | { action: "add"; draft: ConnectionDraft }
  | { action: "update"; id: string; draft: ConnectionDraft };

/**
 * What to store for a visit, or `null` when nothing needs writing.
 *
 * A device already saved is updated rather than duplicated, and only when the
 * relay address actually moved: rewriting an unchanged entry would churn
 * storage and log an edit the user did not make.
 *
 * The name on an existing entry is left alone. The user may have renamed it,
 * and the Agent's own name can change on the far side at any time.
 */
export function rememberRelayDevice(
  profiles: ConnectionProfile[],
  visit: RelayDeviceVisit,
): RelayDeviceMemory | null {
  const relayAddress = visit.relayAddress.trim();
  const known = profiles.find(
    (profile) => isRelayProfile(profile) && profile.deviceId === visit.deviceId,
  );

  if (known) {
    if ((known.relayAddress ?? "") === relayAddress) return null;
    return {
      action: "update",
      id: known.id,
      draft: { ...draftFromProfile(known), relayAddress },
    };
  }

  const agentName = (visit.agentName ?? "").trim();
  return {
    action: "add",
    draft: {
      // A device that never introduced itself is still recognisable by the
      // digits its owner reads out loud.
      name: agentName || formatDeviceId(visit.deviceId),
      protocol: "lattice",
      hostname: "",
      username: "",
      port: 0,
      deviceId: visit.deviceId,
      relayAddress,
    },
  };
}

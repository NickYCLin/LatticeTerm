import { useCallback, useEffect, useState } from "react";
import type { ConnectionProfile } from "../domain/connection";

export type CredentialKind = "sshPassword" | "rdpPassword";

export interface CredentialStoreStatus {
  ready: boolean;
  provider: string;
  detail: string | null;
}

export type SavedCredentialState =
  | { mode: "loading"; provider: string | null; detail: null }
  | { mode: "saved" | "missing"; provider: string; detail: null }
  | { mode: "unavailable"; provider: string | null; detail: string };

export interface CredentialInventoryEntry {
  profileId: string;
  kind: CredentialKind;
}

export type CredentialDeleteGuardState =
  | { mode: "clear"; provider: null; detail: null }
  | { mode: "loading"; provider: null; detail: null }
  | { mode: "saved"; provider: string; detail: null }
  | { mode: "unavailable"; provider: string | null; detail: string };

export type CredentialInventoryState =
  | {
      mode: "loading";
      provider: string | null;
      detail: null;
      entries: CredentialInventoryEntry[];
    }
  | {
      mode: "ready";
      provider: string;
      detail: null;
      entries: CredentialInventoryEntry[];
    }
  | {
      mode: "unavailable";
      provider: string | null;
      detail: string;
      entries: CredentialInventoryEntry[];
    };

async function core() {
  return import("@tauri-apps/api/core");
}

export function credentialKindFor(
  profile: ConnectionProfile,
): CredentialKind | null {
  if (profile.protocol === "ssh") return "sshPassword";
  if (profile.protocol === "rdp") return "rdpPassword";
  return null;
}

async function readStatus(): Promise<CredentialStoreStatus> {
  const { invoke } = await core();
  return invoke<CredentialStoreStatus>("credential_status");
}

async function exists(
  profileId: string,
  kind: CredentialKind,
): Promise<boolean> {
  const { invoke } = await core();
  return invoke<boolean>("credential_exists", { profileId, kind });
}

async function readState(
  profileId: string,
  kind: CredentialKind,
): Promise<SavedCredentialState> {
  try {
    const status = await readStatus();
    if (!status.ready) {
      return {
        mode: "unavailable",
        provider: status.provider,
        detail: status.detail ?? "Credential storage is unavailable.",
      };
    }

    return {
      mode: (await exists(profileId, kind)) ? "saved" : "missing",
      provider: status.provider,
      detail: null,
    };
  } catch (reason) {
    return {
      mode: "unavailable",
      provider: null,
      detail: reason instanceof Error ? reason.message : String(reason),
    };
  }
}

async function readInventory(
  profiles: ConnectionProfile[],
): Promise<CredentialInventoryState> {
  try {
    const status = await readStatus();
    if (!status.ready) {
      return {
        mode: "unavailable",
        provider: status.provider,
        detail: status.detail ?? "Credential storage is unavailable.",
        entries: [],
      };
    }

    const candidates = profiles.flatMap((profile) => {
      const kind = credentialKindFor(profile);
      return kind ? [{ profileId: profile.id, kind }] : [];
    });
    const present = await Promise.all(
      candidates.map(async (entry) => ({
        entry,
        exists: await exists(entry.profileId, entry.kind),
      })),
    );

    return {
      mode: "ready",
      provider: status.provider,
      detail: null,
      entries: present.filter((item) => item.exists).map((item) => item.entry),
    };
  } catch (reason) {
    return {
      mode: "unavailable",
      provider: null,
      detail: reason instanceof Error ? reason.message : String(reason),
      entries: [],
    };
  }
}

async function removeCredential(
  profileId: string,
  kind: CredentialKind,
): Promise<void> {
  const { invoke } = await core();
  await invoke("credential_delete", { profileId, kind });
}

export function useSavedCredential(
  profileId: string,
  kind: CredentialKind,
) {
  const [state, setState] = useState<SavedCredentialState>({
    mode: "loading",
    provider: null,
    detail: null,
  });

  const refresh = useCallback(async () => {
    setState({ mode: "loading", provider: null, detail: null });
    setState(await readState(profileId, kind));
  }, [kind, profileId]);

  useEffect(() => {
    let cancelled = false;
    void readState(profileId, kind).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, profileId]);

  const remove = useCallback(async () => {
    await removeCredential(profileId, kind);
    setState((current) => ({
      mode: "missing",
      provider: current.provider ?? "System credential store",
      detail: null,
    }));
  }, [kind, profileId]);

  return { state, refresh, remove };
}

export function useCredentialDeleteGuard(
  profile: ConnectionProfile | null,
): CredentialDeleteGuardState {
  const [state, setState] = useState<CredentialDeleteGuardState>({
    mode: "clear",
    provider: null,
    detail: null,
  });

  useEffect(() => {
    if (!profile) {
      setState({ mode: "clear", provider: null, detail: null });
      return;
    }

    const kind = credentialKindFor(profile);
    if (!kind) {
      setState({ mode: "clear", provider: null, detail: null });
      return;
    }

    let cancelled = false;
    setState({ mode: "loading", provider: null, detail: null });
    void readState(profile.id, kind).then((next) => {
      if (cancelled) return;
      if (next.mode === "saved") {
        setState({
          mode: "saved",
          provider: next.provider,
          detail: null,
        });
      } else if (next.mode === "unavailable") {
        setState(next);
      } else {
        setState({ mode: "clear", provider: null, detail: null });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [profile]);

  return state;
}

export function useCredentialInventory(profiles: ConnectionProfile[]) {
  const [state, setState] = useState<CredentialInventoryState>({
    mode: "loading",
    provider: null,
    detail: null,
    entries: [],
  });

  const refresh = useCallback(async () => {
    setState((current) => ({
      mode: "loading",
      provider: current.provider,
      detail: null,
      entries: current.entries,
    }));
    setState(await readInventory(profiles));
  }, [profiles]);

  useEffect(() => {
    let cancelled = false;
    void readInventory(profiles).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [profiles]);

  const remove = useCallback(
    async (entry: CredentialInventoryEntry) => {
      await removeCredential(entry.profileId, entry.kind);
      setState((current) => ({
        ...current,
        entries: current.entries.filter(
          (item) =>
            item.profileId !== entry.profileId || item.kind !== entry.kind,
        ),
      }));
    },
    [],
  );

  return { state, refresh, remove };
}

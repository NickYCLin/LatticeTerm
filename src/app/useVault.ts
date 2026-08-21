/**
 * The encrypted vault, from the interface's side.
 *
 * Master passwords pass through for one call and are never kept in state.
 * The hook only ever sees the vault's public shape: whether it exists,
 * whether it is unlocked, and how many entries it seals.
 */

import { useCallback, useEffect, useState } from "react";

export type VaultLockState = "notCreated" | "locked" | "unlocked";

export interface VaultStatus {
  state: VaultLockState;
  entryCount: number | null;
  path: string;
}

export type CredentialBackend = "osKeyring" | "vault";

export interface VaultApi {
  status: VaultStatus | null;
  backend: CredentialBackend;
  /** Set when the last action failed; cleared by the next action. */
  problem: string | null;
  busy: boolean;
  refresh: () => Promise<void>;
  create: (masterPassword: string) => Promise<boolean>;
  unlock: (masterPassword: string) => Promise<boolean>;
  lock: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<boolean>;
  setBackend: (backend: CredentialBackend) => Promise<boolean>;
}

async function core() {
  return import("@tauri-apps/api/core");
}

export function useVault(onCredentialStoreChanged?: () => void): VaultApi {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [backend, setBackendState] = useState<CredentialBackend>("osKeyring");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { invoke } = await core();
      const [nextStatus, nextBackend] = await Promise.all([
        invoke<VaultStatus>("vault_status"),
        invoke<CredentialBackend>("credential_backend_get"),
      ]);
      setStatus(nextStatus);
      setBackendState(nextBackend);
    } catch {
      // Browser preview has no vault; the view explains that on its own.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (operation: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      setProblem(null);
      try {
        await operation();
        await refresh();
        onCredentialStoreChanged?.();
        return true;
      } catch (reason) {
        setProblem(reason instanceof Error ? reason.message : String(reason));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onCredentialStoreChanged, refresh],
  );

  const create = useCallback(
    (masterPassword: string) =>
      run(async () => {
        const { invoke } = await core();
        await invoke("vault_create", { masterPassword });
      }),
    [run],
  );

  const unlock = useCallback(
    (masterPassword: string) =>
      run(async () => {
        const { invoke } = await core();
        await invoke("vault_unlock", { masterPassword });
      }),
    [run],
  );

  const lock = useCallback(async () => {
    await run(async () => {
      const { invoke } = await core();
      await invoke("vault_lock");
    });
  }, [run]);

  const changePassword = useCallback(
    (current: string, next: string) =>
      run(async () => {
        const { invoke } = await core();
        await invoke("vault_change_password", {
          currentPassword: current,
          newPassword: next,
        });
      }),
    [run],
  );

  const setBackend = useCallback(
    (next: CredentialBackend) =>
      run(async () => {
        const { invoke } = await core();
        await invoke("credential_backend_set", { backend: next });
      }),
    [run],
  );

  return {
    status,
    backend,
    problem,
    busy,
    refresh,
    create,
    unlock,
    lock,
    changePassword,
    setBackend,
  };
}

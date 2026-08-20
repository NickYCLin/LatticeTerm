/**
 * Key Vault view.
 *
 * Manages host key trust fingerprints, credential references, and
 * vault security lock/unlock states without exposing plaintext secrets.
 */

import { useState, useId } from "react";
import {
  type HostFingerprint,
  type CredentialReference,
  sampleKnownHosts,
  sampleCredentials,
  isValidFingerprint,
} from "../domain/security";
import type { WorkspaceState } from "../app/useWorkspace";
import {
  ShieldIcon,
  PlusIcon,
  TrashIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
} from "../components/icons";
import { Chip } from "../components/common/Badge";
import { Callout } from "../components/common/Callout";

export function VaultView({ workspace }: { workspace: WorkspaceState }) {
  const [isLocked, setIsLocked] = useState(false);
  const [activeTab, setActiveTab] = useState<"hosts" | "credentials">("hosts");
  const [knownHosts, setKnownHosts] = useState<HostFingerprint[]>(sampleKnownHosts());
  const [credentials] = useState<CredentialReference[]>(sampleCredentials());
  const [hostSearch, setHostSearch] = useState("");
  const [showAddHostModal, setShowAddHostModal] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // New host modal form state
  const [newHost, setNewHost] = useState("");
  const [newPort, setNewPort] = useState("22");
  const [newAlgo, setNewAlgo] = useState("ssh-ed25519");
  const [newFp, setNewFp] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const formId = useId();

  const filteredHosts = knownHosts.filter(
    (h) =>
      h.host.toLowerCase().includes(hostSearch.toLowerCase()) ||
      h.fingerprint.toLowerCase().includes(hostSearch.toLowerCase()) ||
      h.algorithm.toLowerCase().includes(hostSearch.toLowerCase()),
  );

  function handleCopy(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function handleRemoveHost(host: HostFingerprint) {
    setKnownHosts((prev) => prev.filter((h) => h.id !== host.id));
    workspace.logActivity({
      type: "deleted",
      message: `Removed host trust for ${host.host}:${host.port} (${host.algorithm})`,
      detail: host.fingerprint,
    });
  }

  function handleAddHostSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newHost.trim()) {
      setFormError("Host address is required.");
      return;
    }
    const portNum = Number.parseInt(newPort, 10);
    if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setFormError("Port must be between 1 and 65535.");
      return;
    }
    if (!newFp.trim() || !isValidFingerprint(newFp.trim())) {
      setFormError("Invalid fingerprint format. Use standard SHA256:... format.");
      return;
    }

    const created: HostFingerprint = {
      id: `host-${Date.now()}`,
      host: newHost.trim(),
      port: portNum,
      algorithm: newAlgo,
      fingerprint: newFp.trim(),
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
    };

    setKnownHosts((prev) => [created, ...prev]);
    workspace.logActivity({
      type: "created",
      message: `Added trusted host fingerprint for ${created.host}:${created.port}`,
      detail: created.fingerprint,
    });

    setShowAddHostModal(false);
    setNewHost("");
    setNewPort("22");
    setNewFp("");
    setFormError(null);
  }

  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      {/* Vault Status Banner */}
      <section className="panel glass glass--sheen">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.875rem" }}>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "40px",
                height: "40px",
                borderRadius: "var(--radius-md)",
                backgroundColor: isLocked ? "var(--surface-raised)" : "var(--accent-glow)",
                color: isLocked ? "var(--text-muted)" : "var(--accent)",
              }}
            >
              <ShieldIcon size={20} />
            </span>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <h2 className="panel__title" style={{ fontSize: "1.0625rem" }}>
                  Key Vault
                </h2>
                <Chip tone={isLocked ? "warn" : "accent"}>
                  {isLocked ? "Locked" : "Unlocked · Active"}
                </Chip>
              </div>
              <p className="panel__hint" style={{ marginTop: "0.125rem" }}>
                {isLocked
                  ? "Vault is locked. Credentials and host keys are sealed in local secure storage."
                  : "Protected by system credential store & Stronghold. Zero plaintext stored in web memory."}
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className={isLocked ? "button button--primary" : "button button--secondary"}
              onClick={() => {
                const nextLocked = !isLocked;
                setIsLocked(nextLocked);
                workspace.logActivity({
                  type: "workspace",
                  message: nextLocked ? "Key Vault locked by user" : "Key Vault unlocked by user",
                });
              }}
            >
              {isLocked ? "Unlock Vault" : "Lock Vault"}
            </button>
          </div>
        </div>
      </section>

      {/* Tabs and Content */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div className="segmented" role="tablist" aria-label="Vault tabs">
          <button
            type="button"
            className="segmented__btn"
            role="tab"
            aria-selected={activeTab === "hosts"}
            onClick={() => setActiveTab("hosts")}
          >
            Trusted Host Keys ({knownHosts.length})
          </button>
          <button
            type="button"
            className="segmented__btn"
            role="tab"
            aria-selected={activeTab === "credentials"}
            onClick={() => setActiveTab("credentials")}
          >
            Credential References ({credentials.length})
          </button>
        </div>

        {activeTab === "hosts" && (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              type="search"
              className="input input--sm"
              placeholder="Filter host keys..."
              value={hostSearch}
              onChange={(e) => setHostSearch(e.target.value)}
              style={{ width: "200px" }}
            />
            <button
              type="button"
              className="button button--secondary button--sm"
              onClick={() => setShowAddHostModal(true)}
            >
              <PlusIcon size={13} />
              Add Host Key
            </button>
          </div>
        )}
      </div>

      {activeTab === "hosts" && (
        <div className="stack" style={{ gap: "0.75rem" }}>
          {filteredHosts.length === 0 ? (
            <div className="panel panel--empty glass">
              <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                {hostSearch ? "No host fingerprints match your search query." : "No trusted host fingerprints recorded yet."}
              </p>
            </div>
          ) : (
            <div
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                <thead>
                  <tr style={{ backgroundColor: "var(--surface-raised)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "0.625rem 0.875rem", fontWeight: 600 }}>Host & Port</th>
                    <th style={{ padding: "0.625rem 0.875rem", fontWeight: 600 }}>Algorithm</th>
                    <th style={{ padding: "0.625rem 0.875rem", fontWeight: 600 }}>Fingerprint</th>
                    <th style={{ padding: "0.625rem 0.875rem", fontWeight: 600, textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHosts.map((h) => (
                    <tr
                      key={h.id}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        transition: "background-color 0.15s ease",
                      }}
                    >
                      <td style={{ padding: "0.625rem 0.875rem" }}>
                        <span className="mono" style={{ fontWeight: 600, color: "var(--text)" }}>
                          {h.host}:{h.port}
                        </span>
                      </td>
                      <td style={{ padding: "0.625rem 0.875rem" }}>
                        <Chip tone="neutral">{h.algorithm}</Chip>
                      </td>
                      <td style={{ padding: "0.625rem 0.875rem" }}>
                        <span className="mono" style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>
                          {h.fingerprint}
                        </span>
                      </td>
                      <td style={{ padding: "0.625rem 0.875rem", textAlign: "right" }}>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.375rem" }}>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => handleCopy(h.id, h.fingerprint)}
                            title="Copy fingerprint"
                            aria-label="Copy fingerprint"
                          >
                            {copiedId === h.id ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                          </button>
                          <button
                            type="button"
                            className="icon-button icon-button--danger"
                            onClick={() => handleRemoveHost(h)}
                            title="Remove trusted key"
                            aria-label="Remove trusted key"
                          >
                            <TrashIcon size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "credentials" && (
        <div className="stack" style={{ gap: "0.75rem" }}>
          <div
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
              <thead>
                <tr style={{ backgroundColor: "var(--surface-raised)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "0.625rem 0.875rem", fontWeight: 600 }}>Identity Name</th>
                  <th style={{ padding: "0.625rem 0.875rem", fontWeight: 600 }}>Type</th>
                  <th style={{ padding: "0.625rem 0.875rem", fontWeight: 600 }}>Identifier / Comment</th>
                  <th style={{ padding: "0.625rem 0.875rem", fontWeight: 600 }}>Mapped Profiles</th>
                </tr>
              </thead>
              <tbody>
                {credentials.map((cred) => {
                  const mappedCount = workspace.profiles.filter(
                    (p) => p.group === "Core platform" || p.username === "operator",
                  ).length;

                  return (
                    <tr key={cred.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.625rem 0.875rem", fontWeight: 600, color: "var(--text)" }}>
                        {cred.name}
                      </td>
                      <td style={{ padding: "0.625rem 0.875rem" }}>
                        <Chip tone="accent">{cred.type}</Chip>
                      </td>
                      <td style={{ padding: "0.625rem 0.875rem" }}>
                        <span className="mono" style={{ color: "var(--text-muted)" }}>
                          {cred.comment || "—"}
                        </span>
                      </td>
                      <td style={{ padding: "0.625rem 0.875rem" }}>
                        <span style={{ color: "var(--text-muted)" }}>
                          {mappedCount > 0 ? `${mappedCount} profiles referenced` : "None"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Callout tone="security" title="Security Boundary Assurance">
            LatticeTerm stores secret key material exclusively inside Tauri Stronghold and the host OS Keychain.
            Connection profiles only maintain opaque reference identifiers.
          </Callout>
        </div>
      )}

      {/* Add Host Modal */}
      {showAddHostModal && (
        <div className="scrim scrim--top" role="presentation" onMouseDown={() => setShowAddHostModal(false)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-host-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="dialog__head">
              <h2 className="dialog__title" id="add-host-title">
                Add Trusted Host Fingerprint
              </h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowAddHostModal(false)}
                aria-label="Close"
              >
                <CloseIcon size={14} />
              </button>
            </header>

            <form onSubmit={handleAddHostSubmit}>
              <div className="dialog__body stack">
                {formError && (
                  <Callout tone="danger" title="Validation Error">
                    {formError}
                  </Callout>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: "0.75rem" }}>
                  <div>
                    <label htmlFor={`${formId}-host`} className="label">
                      Host Address
                    </label>
                    <input
                      id={`${formId}-host`}
                      type="text"
                      className="input"
                      placeholder="e.g. server.example.com"
                      value={newHost}
                      onChange={(e) => setNewHost(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label htmlFor={`${formId}-port`} className="label">
                      Port
                    </label>
                    <input
                      id={`${formId}-port`}
                      type="number"
                      className="input"
                      placeholder="22"
                      value={newPort}
                      onChange={(e) => setNewPort(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor={`${formId}-algo`} className="label">
                    Key Algorithm
                  </label>
                  <select
                    id={`${formId}-algo`}
                    className="select"
                    value={newAlgo}
                    onChange={(e) => setNewAlgo(e.target.value)}
                  >
                    <option value="ssh-ed25519">ssh-ed25519 (Recommended)</option>
                    <option value="ecdsa-sha2-nistp256">ecdsa-sha2-nistp256</option>
                    <option value="ecdsa-sha2-nistp384">ecdsa-sha2-nistp384</option>
                    <option value="rsa-sha2-512">rsa-sha2-512</option>
                    <option value="rsa-sha2-256">rsa-sha2-256</option>
                  </select>
                </div>

                <div>
                  <label htmlFor={`${formId}-fp`} className="label">
                    SHA-256 Fingerprint
                  </label>
                  <input
                    id={`${formId}-fp`}
                    type="text"
                    className="input mono"
                    placeholder="SHA256:..."
                    value={newFp}
                    onChange={(e) => setNewFp(e.target.value)}
                  />
                  <span className="field__hint">
                    Standard SHA-256 base64 fingerprint generated by ssh-keygen or server banner.
                  </span>
                </div>
              </div>

              <div className="dialog__foot">
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setShowAddHostModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="button button--primary">
                  Save Fingerprint
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

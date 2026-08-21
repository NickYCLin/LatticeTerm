/**
 * SSH Tunnels & Port Forwarding View.
 *
 * Provides a comprehensive, interactive workspace to manage, start, stop,
 * and monitor Local (-L), Remote (-R), and Dynamic SOCKS5 (-D) port forwarding
 * over pure Rust SSH connections.
 */

import { useMemo, useState } from "react";
import {
  formatBytes,
  formatSshTunnelCommand,
  type TunnelConfig,
  type TunnelDraft,
  type TunnelType,
  type TunnelValidationError,
} from "../domain/tunnel";
import { useTunnels } from "../app/useTunnels";
import type { ConnectionProfile } from "../domain/connection";
import { useI18n } from "../i18n";
import { Chip } from "../components/common/Badge";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DuplicateIcon,
  EditIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  StopIcon,
  TrashIcon,
  TunnelIcon,
} from "../components/icons";

interface TunnelsViewProps {
  profiles: ConnectionProfile[];
  onActivity?: (type: string, detail: string) => void;
}

export function TunnelsView({ profiles, onActivity }: TunnelsViewProps) {
  const { t } = useI18n();
  const {
    tunnels,
    states,
    addTunnel,
    updateTunnel,
    deleteTunnel,
    duplicateTunnel,
    startTunnel,
    stopTunnel,
    startAll,
    stopAll,
  } = useTunnels(profiles, onActivity);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | TunnelType>("all");
  const [editingTunnel, setEditingTunnel] = useState<TunnelConfig | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filtered tunnels
  const filteredTunnels = useMemo(() => {
    return tunnels.filter((t) => {
      if (typeFilter !== "all" && t.type !== typeFilter) {
        return false;
      }
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const profile = profiles.find((p) => p.id === t.profileId);
      return (
        t.name.toLowerCase().includes(q) ||
        String(t.localPort).includes(q) ||
        t.remoteHost.toLowerCase().includes(q) ||
        String(t.remotePort).includes(q) ||
        (profile?.name.toLowerCase().includes(q) ?? false) ||
        (profile?.hostname.toLowerCase().includes(q) ?? false)
      );
    });
  }, [tunnels, search, typeFilter, profiles]);

  // Summary Metrics
  const totalCount = tunnels.length;
  const activeCount = Object.values(states).filter((s) => s.status === "active").length;
  const totalUploaded = Object.values(states).reduce((acc, s) => acc + s.bytesUploaded, 0);
  const totalDownloaded = Object.values(states).reduce((acc, s) => acc + s.bytesDownloaded, 0);

  const handleCopyCommand = (tunnel: TunnelConfig) => {
    const profile = profiles.find((p) => p.id === targetProfileId(tunnel.profileId));
    const user = profile?.username || "root";
    const host = profile?.hostname || "localhost";
    const port = profile?.port || 22;
    const cmd = formatSshTunnelCommand(tunnel, user, host, port);

    void navigator.clipboard.writeText(cmd);
    setCopiedId(tunnel.id);
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  const targetProfileId = (profileId: string) => {
    const found = profiles.find((p) => p.id === profileId);
    return found ? found.id : profiles[0]?.id || "";
  };

  return (
    <div className="stack" style={{ gap: "var(--space-6)" }}>
      {/* 1. Summary Metrics Bar */}
      <div className="metrics-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-4)" }}>
        <div className="panel glass glass--sheen" style={{ padding: "var(--space-4)", borderRadius: "var(--radius-lg)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: "var(--space-1)" }}>
            {t("tunnels.metrics.total")}
          </div>
          <div style={{ fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--text)" }}>
            {totalCount}
          </div>
        </div>

        <div className="panel glass glass--sheen" style={{ padding: "var(--space-4)", borderRadius: "var(--radius-lg)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: "var(--space-1)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: activeCount > 0 ? "var(--ok)" : "var(--text-faint)", display: "inline-block" }} />
            {t("tunnels.metrics.active")}
          </div>
          <div style={{ fontSize: "var(--text-2xl)", fontWeight: 700, color: activeCount > 0 ? "var(--ok)" : "var(--text)" }}>
            {activeCount}
          </div>
        </div>

        <div className="panel glass glass--sheen" style={{ padding: "var(--space-4)", borderRadius: "var(--radius-lg)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: "var(--space-1)" }}>
            {t("tunnels.metrics.traffic")}
          </div>
          <div style={{ fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--accent)" }}>
            {formatBytes(totalUploaded + totalDownloaded)}
          </div>
        </div>
      </div>

      {/* 2. Control Toolbar */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flex: "1 1 300px" }}>
          <div style={{ position: "relative", width: "100%", maxWidth: "340px" }}>
            <span style={{ position: "absolute", left: "var(--space-3)", top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)" }}>
              <SearchIcon size={16} />
            </span>
            <input
              type="search"
              className="input"
              style={{ width: "100%", paddingLeft: "var(--space-8)" }}
              placeholder={t("tunnels.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="segmented-control" style={{ display: "flex", background: "var(--surface-solid)", padding: "2px", borderRadius: "var(--radius-md)" }}>
            {(["all", "local", "dynamic", "remote"] as const).map((type) => (
              <button
                key={type}
                type="button"
                className={`button ${typeFilter === type ? "button--secondary" : "button--ghost"}`}
                style={{ padding: "0.25rem 0.75rem", fontSize: "var(--text-xs)", height: "auto" }}
                onClick={() => setTypeFilter(type)}
              >
                {t(`tunnels.type.${type}` as any)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          {activeCount > 0 ? (
            <button type="button" className="button button--ghost" onClick={() => void stopAll()}>
              <StopIcon size={14} />
              {t("tunnels.stopAll")}
            </button>
          ) : (
            <button type="button" className="button button--ghost" onClick={() => void startAll()}>
              <PlayIcon size={14} />
              {t("tunnels.startAll")}
            </button>
          )}

          <button
            type="button"
            className="button button--primary"
            onClick={() => setIsCreating(true)}
          >
            <PlusIcon size={15} />
            {t("tunnels.add")}
          </button>
        </div>
      </div>

      {/* 3. Tunnels List */}
      {filteredTunnels.length === 0 ? (
        <div className="panel glass glass--sheen" style={{ padding: "var(--space-9)", textAlign: "center" }}>
          <div style={{ color: "var(--text-faint)", marginBottom: "var(--space-3)" }}>
            <TunnelIcon size={48} />
          </div>
          <h3 style={{ margin: "0 0 var(--space-2)", fontSize: "var(--text-lg)", color: "var(--text)" }}>
            {search ? t("tunnels.emptySearch") : t("tunnels.empty")}
          </h3>
          <p style={{ margin: "0 0 var(--space-5)", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
            {t("tunnels.emptyHint")}
          </p>
          {!search && (
            <button
              type="button"
              className="button button--primary"
              onClick={() => setIsCreating(true)}
            >
              <PlusIcon size={15} />
              {t("tunnels.add")}
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "var(--space-4)" }}>
          {filteredTunnels.map((tunnel) => {
            const state = states[tunnel.id] || { status: "stopped", bytesUploaded: 0, bytesDownloaded: 0, activeConnections: 0 };
            const isActive = state.status === "active";
            const isStarting = state.status === "starting";
            const profile = profiles.find((p) => p.id === tunnel.profileId);
            const isCopied = copiedId === tunnel.id;

            return (
              <div
                key={tunnel.id}
                className="panel glass glass--sheen"
                style={{
                  padding: "var(--space-5)",
                  borderRadius: "var(--radius-lg)",
                  border: isActive ? "1px solid var(--accent-line)" : "1px solid var(--line)",
                  transition: "all var(--duration-fast) var(--ease)",
                }}
              >
                {/* Header Row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-4)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                    <h3 style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: 600, color: "var(--text)" }}>
                      {tunnel.name}
                    </h3>
                    <Chip tone={tunnel.type === "local" ? "info" : tunnel.type === "dynamic" ? "planned" : "warn"}>
                      {t(`tunnels.type.${tunnel.type}` as any)}
                    </Chip>
                    {isActive && (
                      <Chip tone="ok">
                        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--ok)", marginRight: 4 }} />
                        {t("tunnels.status.active")}
                      </Chip>
                    )}
                    {isStarting && <Chip tone="warn">{t("tunnels.status.starting")}</Chip>}
                    {state.status === "stopped" && <Chip tone="neutral">{t("tunnels.status.stopped")}</Chip>}
                    {state.status === "error" && <Chip tone="danger">{t("tunnels.status.error")}</Chip>}
                  </div>

                  {/* Toggle Run Button */}
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <button
                      type="button"
                      className={`button ${isActive ? "button--secondary" : "button--primary"}`}
                      style={{ padding: "0.35rem 0.85rem", height: "auto" }}
                      disabled={isStarting}
                      onClick={() => {
                        if (isActive) {
                          void stopTunnel(tunnel.id);
                        } else {
                          void startTunnel(tunnel.id);
                        }
                      }}
                    >
                      {isActive ? (
                        <>
                          <StopIcon size={14} />
                          {t("tunnels.action.stop")}
                        </>
                      ) : (
                        <>
                          <PlayIcon size={14} />
                          {t("tunnels.action.start")}
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Visual Routing Flow */}
                <div
                  style={{
                    background: "var(--surface-solid)",
                    padding: "var(--space-4)",
                    borderRadius: "var(--radius-md)",
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "var(--space-4)",
                    fontSize: "var(--text-sm)",
                    marginBottom: "var(--space-4)",
                  }}
                >
                  {/* Source */}
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "var(--tracking-caps)" }}>
                      {t("tunnels.flow.localBind")}
                    </span>
                    <span className="mono" style={{ fontWeight: 600, color: "var(--text)" }}>
                      {tunnel.localHost}:{tunnel.localPort}
                    </span>
                  </div>

                  <span style={{ color: "var(--text-faint)", fontSize: "1.25rem" }}>➔</span>

                  {/* SSH Jump Gateway */}
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "var(--tracking-caps)" }}>
                      {t("tunnels.flow.jumpGateway")}
                    </span>
                    <span style={{ fontWeight: 600, color: "var(--accent)" }}>
                      {profile?.name || profile?.hostname || t("tunnels.flow.unassigned")}
                    </span>
                    <small className="mono" style={{ color: "var(--text-muted)", fontSize: "var(--text-2xs)" }}>
                      {profile ? `${profile.username}@${profile.hostname}:${profile.port}` : "—"}
                    </small>
                  </div>

                  <span style={{ color: "var(--text-faint)", fontSize: "1.25rem" }}>➔</span>

                  {/* Remote Target / SOCKS5 */}
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "var(--tracking-caps)" }}>
                      {tunnel.type === "dynamic" ? t("tunnels.flow.dynamicProxy") : t("tunnels.flow.remoteTarget")}
                    </span>
                    <span className="mono" style={{ fontWeight: 600, color: "var(--text)" }}>
                      {tunnel.type === "dynamic" ? "SOCKS5 Proxy (Any Host)" : `${tunnel.remoteHost}:${tunnel.remotePort}`}
                    </span>
                  </div>
                </div>

                {/* Description & Metrics Footnote */}
                {tunnel.description && (
                  <p style={{ margin: "0 0 var(--space-4)", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                    {tunnel.description}
                  </p>
                )}

                {/* Action Bar & Stats */}
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", borderTop: "1px solid var(--line)", paddingTop: "var(--space-3)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                    <span>
                      {t("tunnels.stats.transferred")}: <strong style={{ color: "var(--text)" }}>{formatBytes(state.bytesUploaded + state.bytesDownloaded)}</strong>
                    </span>
                    {isActive && (
                      <span>
                        {t("tunnels.stats.connections")}: <strong style={{ color: "var(--ok)" }}>{state.activeConnections}</strong>
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <button
                      type="button"
                      className="button button--ghost"
                      style={{ padding: "0.25rem 0.6rem", fontSize: "var(--text-xs)" }}
                      onClick={() => handleCopyCommand(tunnel)}
                      title={t("tunnels.action.copySsh")}
                    >
                      {isCopied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                      {isCopied ? t("common.copied") : t("tunnels.action.copySsh")}
                    </button>

                    <button
                      type="button"
                      className="button button--ghost"
                      style={{ padding: "0.25rem 0.6rem", fontSize: "var(--text-xs)" }}
                      onClick={() => setEditingTunnel(tunnel)}
                      title={t("tunnels.action.edit")}
                    >
                      <EditIcon size={14} />
                      {t("tunnels.action.edit")}
                    </button>

                    <button
                      type="button"
                      className="button button--ghost"
                      style={{ padding: "0.25rem 0.6rem", fontSize: "var(--text-xs)" }}
                      onClick={() => duplicateTunnel(tunnel.id)}
                      title={t("tunnels.action.duplicate")}
                    >
                      <DuplicateIcon size={14} />
                      {t("tunnels.action.duplicate")}
                    </button>

                    <button
                      type="button"
                      className="button button--ghost"
                      style={{ padding: "0.25rem 0.6rem", fontSize: "var(--text-xs)", color: "var(--danger)" }}
                      onClick={() => setPendingDeleteId(tunnel.id)}
                      title={t("tunnels.action.delete")}
                    >
                      <TrashIcon size={14} />
                      {t("tunnels.action.delete")}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4. Create / Edit Tunnel Modal Drawer */}
      {(isCreating || editingTunnel) && (
        <TunnelFormModal
          initial={editingTunnel}
          profiles={profiles}
          onClose={() => {
            setIsCreating(false);
            setEditingTunnel(null);
          }}
          onSave={(draft) => {
            if (editingTunnel) {
              const res = updateTunnel(editingTunnel.id, draft);
              if (res.success) {
                setEditingTunnel(null);
              }
              return res;
            } else {
              const res = addTunnel(draft);
              if (res.success) {
                setIsCreating(false);
              }
              return res;
            }
          }}
        />
      )}

      {/* 5. Delete Confirmation Modal */}
      {pendingDeleteId && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.7)",
            display: "grid",
            placeItems: "center",
            zIndex: 100,
            backdropFilter: "blur(4px)",
          }}
        >
          <div className="panel glass glass--sheen" style={{ maxWidth: 420, width: "90%", padding: "var(--space-6)", borderRadius: "var(--radius-lg)" }}>
            <h3 style={{ margin: "0 0 var(--space-2)", fontSize: "var(--text-lg)", color: "var(--text)" }}>
              {t("tunnels.deleteConfirm.title")}
            </h3>
            <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", margin: "0 0 var(--space-6)" }}>
              {t("tunnels.deleteConfirm.body")}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-3)" }}>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setPendingDeleteId(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="button button--primary"
                style={{ background: "var(--danger)" }}
                onClick={() => {
                  deleteTunnel(pendingDeleteId);
                  setPendingDeleteId(null);
                }}
              >
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface TunnelFormModalProps {
  initial: TunnelConfig | null;
  profiles: ConnectionProfile[];
  onClose: () => void;
  onSave: (draft: TunnelDraft) => { success: boolean; errors?: TunnelValidationError[] };
}

function TunnelFormModal({ initial, profiles, onClose, onSave }: TunnelFormModalProps) {
  const { t } = useI18n();

  const [name, setName] = useState(initial?.name || "");
  const [type, setType] = useState<TunnelType>(initial?.type || "local");
  const [profileId, setProfileId] = useState(initial?.profileId || profiles[0]?.id || "");
  const [localHost, setLocalHost] = useState(initial?.localHost || "127.0.0.1");
  const [localPort, setLocalPort] = useState<string | number>(initial?.localPort || 8080);
  const [remoteHost, setRemoteHost] = useState(initial?.remoteHost || "localhost");
  const [remotePort, setRemotePort] = useState<string | number>(initial?.remotePort || 80);
  const [description, setDescription] = useState(initial?.description || "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const draft: TunnelDraft = {
      name,
      type,
      profileId,
      localHost,
      localPort,
      remoteHost,
      remotePort,
      description,
    };

    const result = onSave(draft);
    if (!result.success && result.errors) {
      const errMap: Record<string, string> = {};
      for (const err of result.errors) {
        errMap[err.field] = t(err.messageKey as any);
      }
      setErrors(errMap);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.7)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        className="panel glass glass--sheen"
        style={{
          maxWidth: 540,
          width: "92%",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "var(--space-6)",
          borderRadius: "var(--radius-xl)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-5)" }}>
          <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text)" }}>
            {initial ? t("tunnels.form.editTitle") : t("tunnels.form.createTitle")}
          </h2>
          <button type="button" className="button button--ghost" onClick={onClose} style={{ padding: "0.25rem" }}>
            <CloseIcon size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {/* Type Selector */}
          <div>
            <label className="field-label" style={{ display: "block", marginBottom: "var(--space-2)" }}>
              {t("tunnels.form.type")}
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-2)" }}>
              {(["local", "dynamic", "remote"] as const).map((tType) => (
                <button
                  key={tType}
                  type="button"
                  className={`button ${type === tType ? "button--secondary" : "button--ghost"}`}
                  style={{ fontSize: "var(--text-xs)", height: "2.5rem" }}
                  onClick={() => setType(tType)}
                >
                  {t(`tunnels.type.${tType}` as any)}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="field-label" style={{ display: "block", marginBottom: "var(--space-1)" }}>
              {t("tunnels.form.name")}
            </label>
            <input
              type="text"
              className="input"
              style={{ width: "100%" }}
              placeholder={t("tunnels.form.namePlaceholder")}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((prev) => ({ ...prev, name: "" }));
              }}
            />
            {errors.name && <small style={{ color: "var(--danger)", marginTop: 4, display: "block" }}>{errors.name}</small>}
          </div>

          {/* SSH Jump Gateway */}
          <div>
            <label className="field-label" style={{ display: "block", marginBottom: "var(--space-1)" }}>
              {t("tunnels.form.gateway")}
            </label>
            <select
              className="input select"
              style={{ width: "100%" }}
              value={profileId}
              onChange={(e) => {
                setProfileId(e.target.value);
                setErrors((prev) => ({ ...prev, profileId: "" }));
              }}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.username}@{p.hostname}:{p.port})
                </option>
              ))}
            </select>
            {errors.profileId && <small style={{ color: "var(--danger)", marginTop: 4, display: "block" }}>{errors.profileId}</small>}
          </div>

          {/* Local Binding */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--space-3)" }}>
            <div>
              <label className="field-label" style={{ display: "block", marginBottom: "var(--space-1)" }}>
                {t("tunnels.form.localHost")}
              </label>
              <input
                type="text"
                className="input mono"
                style={{ width: "100%" }}
                value={localHost}
                onChange={(e) => {
                  setLocalHost(e.target.value);
                  setErrors((prev) => ({ ...prev, localHost: "" }));
                }}
              />
              {errors.localHost && <small style={{ color: "var(--danger)", marginTop: 4, display: "block" }}>{errors.localHost}</small>}
            </div>
            <div>
              <label className="field-label" style={{ display: "block", marginBottom: "var(--space-1)" }}>
                {t("tunnels.form.localPort")}
              </label>
              <input
                type="number"
                className="input mono"
                style={{ width: "100%" }}
                value={localPort}
                onChange={(e) => {
                  setLocalPort(e.target.value);
                  setErrors((prev) => ({ ...prev, localPort: "" }));
                }}
              />
              {errors.localPort && <small style={{ color: "var(--danger)", marginTop: 4, display: "block" }}>{errors.localPort}</small>}
            </div>
          </div>

          {/* Remote Target (Hidden if Dynamic SOCKS5) */}
          {type !== "dynamic" && (
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--space-3)" }}>
              <div>
                <label className="field-label" style={{ display: "block", marginBottom: "var(--space-1)" }}>
                  {t("tunnels.form.remoteHost")}
                </label>
                <input
                  type="text"
                  className="input mono"
                  style={{ width: "100%" }}
                  placeholder="e.g. 10.0.0.5 or localhost"
                  value={remoteHost}
                  onChange={(e) => {
                    setRemoteHost(e.target.value);
                    setErrors((prev) => ({ ...prev, remoteHost: "" }));
                  }}
                />
                {errors.remoteHost && <small style={{ color: "var(--danger)", marginTop: 4, display: "block" }}>{errors.remoteHost}</small>}
              </div>
              <div>
                <label className="field-label" style={{ display: "block", marginBottom: "var(--space-1)" }}>
                  {t("tunnels.form.remotePort")}
                </label>
                <input
                  type="number"
                  className="input mono"
                  style={{ width: "100%" }}
                  placeholder="5432"
                  value={remotePort}
                  onChange={(e) => {
                    setRemotePort(e.target.value);
                    setErrors((prev) => ({ ...prev, remotePort: "" }));
                  }}
                />
                {errors.remotePort && <small style={{ color: "var(--danger)", marginTop: 4, display: "block" }}>{errors.remotePort}</small>}
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <label className="field-label" style={{ display: "block", marginBottom: "var(--space-1)" }}>
              {t("tunnels.form.description")}
            </label>
            <textarea
              className="input"
              style={{ width: "100%", minHeight: "60px", resize: "vertical" }}
              placeholder={t("tunnels.form.descPlaceholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Form Actions */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
            <button type="button" className="button button--ghost" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="button button--primary">
              {initial ? t("common.save") : t("tunnels.form.submitCreate")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

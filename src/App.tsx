import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import {
  createConnectionProfile,
  protocolCatalog,
  validateConnectionDraft,
} from "./domain/connection";
import type {
  ConnectionDraft,
  ConnectionProfile,
  Protocol,
} from "./domain/connection";

const navItems = ["Connections", "Activity", "Key vault", "Settings"];

const emptyDraft: ConnectionDraft = {
  name: "",
  protocol: "ssh",
  hostname: "",
  username: "",
  port: 22,
};

function LogoMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function ProtocolGlyph({ protocol }: { protocol: Protocol }) {
  const glyphs: Record<Protocol, string> = {
    ssh: ">_",
    sftp: "↕",
    rdp: "▣",
    vnc: "⌘",
  };

  return (
    <span className={`protocol-glyph protocol-${protocol}`}>
      {glyphs[protocol]}
    </span>
  );
}

function App() {
  const [draft, setDraft] = useState<ConnectionDraft>(emptyDraft);
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState(
    "Profiles stay in memory during this preview.",
  );

  const selectedProtocol = useMemo(
    () => protocolCatalog.find((protocol) => protocol.id === draft.protocol)!,
    [draft.protocol],
  );

  function selectProtocol(protocol: Protocol) {
    const next = protocolCatalog.find((item) => item.id === protocol)!;
    setDraft((current) => ({ ...current, protocol, port: next.defaultPort }));
    setErrors({});
  }

  function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateConnectionDraft(draft);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setNotice("Check the highlighted fields before saving.");
      return;
    }

    const profile = createConnectionProfile(draft);
    setProfiles((current) => [profile, ...current]);
    setDraft({ ...emptyDraft });
    setNotice(
      `${profile.name} was added locally. Connection engines come next.`,
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <LogoMark />
          <div>
            <strong>LatticeTerm</strong>
            <span>Remote workspace</span>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          <p className="nav-heading">Workspace</p>
          {navItems.map((item, index) => (
            <button
              className={`nav-item ${index === 0 ? "active" : ""}`}
              key={item}
              type="button"
            >
              <span className="nav-dot" />
              {item}
              {index > 0 && <span className="coming-soon">Soon</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <span className="status-light" />
          <div>
            <strong>Local preview</strong>
            <span>No credentials are stored</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Secure connections</span>
            <h1>Your remote workspace</h1>
          </div>
          <span className="version-badge">v0.1 foundation</span>
        </header>

        <section className="intro-panel">
          <div className="intro-copy">
            <span className="phase-label">Foundation milestone</span>
            <h2>One place for terminals, files, and remote desktops.</h2>
            <p>
              Create connection profiles now. SSH, SFTP, RDP, and VNC engines
              will be connected in the next milestones.
            </p>
          </div>
          <div className="security-card">
            <span className="shield" aria-hidden="true">
              ◆
            </span>
            <div>
              <strong>Security boundary first</strong>
              <p>
                Host metadata only. Password and key storage are intentionally
                not implemented yet.
              </p>
            </div>
          </div>
        </section>

        <section className="content-grid">
          <div className="connection-area">
            <div className="section-title">
              <div>
                <span className="eyebrow">Protocols</span>
                <h2>Choose how to connect</h2>
              </div>
              <span className="profile-count">{profiles.length} saved</span>
            </div>

            <div className="protocol-grid">
              {protocolCatalog.map((protocol) => (
                <button
                  className={`protocol-card ${draft.protocol === protocol.id ? "selected" : ""}`}
                  key={protocol.id}
                  onClick={() => selectProtocol(protocol.id)}
                  type="button"
                  aria-pressed={draft.protocol === protocol.id}
                >
                  <ProtocolGlyph protocol={protocol.id} />
                  <span>
                    <strong>{protocol.name}</strong>
                    <small>{protocol.summary}</small>
                  </span>
                  <span className="default-port">:{protocol.defaultPort}</span>
                </button>
              ))}
            </div>

            <div className="saved-section">
              <div className="section-title compact">
                <div>
                  <span className="eyebrow">Connections</span>
                  <h2>Saved profiles</h2>
                </div>
              </div>

              {profiles.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon" aria-hidden="true">
                    +
                  </span>
                  <div>
                    <strong>No connection profiles yet</strong>
                    <p>
                      Use the form to add your first host. Secrets are never
                      requested here.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="profile-list">
                  {profiles.map((profile) => (
                    <article className="profile-row" key={profile.id}>
                      <ProtocolGlyph protocol={profile.protocol} />
                      <div>
                        <strong>{profile.name}</strong>
                        <span>
                          {profile.username ? `${profile.username}@` : ""}
                          {profile.hostname}:{profile.port}
                        </span>
                      </div>
                      <span className="profile-protocol">
                        {profile.protocol.toUpperCase()}
                      </span>
                      <button
                        type="button"
                        disabled
                        title="Connection engine is not implemented yet"
                      >
                        Connect
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside
            className="quick-connect"
            aria-labelledby="quick-connect-title"
          >
            <div className="form-heading">
              <ProtocolGlyph protocol={draft.protocol} />
              <div>
                <span className="eyebrow">New profile</span>
                <h2 id="quick-connect-title">
                  Add {selectedProtocol.name} host
                </h2>
              </div>
            </div>

            <form onSubmit={submitProfile} noValidate>
              <label>
                Display name
                <input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.currentTarget.value })
                  }
                  placeholder="Production server"
                  aria-invalid={Boolean(errors.name)}
                />
                {errors.name && (
                  <small className="field-error">{errors.name}</small>
                )}
              </label>

              <label>
                Hostname or IP
                <input
                  value={draft.hostname}
                  onChange={(event) =>
                    setDraft({ ...draft, hostname: event.currentTarget.value })
                  }
                  placeholder="server.example.com"
                  autoCapitalize="none"
                  spellCheck="false"
                  aria-invalid={Boolean(errors.hostname)}
                />
                {errors.hostname && (
                  <small className="field-error">{errors.hostname}</small>
                )}
              </label>

              <div className="form-row">
                <label>
                  Username
                  <input
                    value={draft.username}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        username: event.currentTarget.value,
                      })
                    }
                    placeholder="Optional"
                    autoCapitalize="none"
                  />
                </label>
                <label className="port-field">
                  Port
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={draft.port}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        port: Number(event.currentTarget.value),
                      })
                    }
                    aria-invalid={Boolean(errors.port)}
                  />
                </label>
              </div>
              {errors.port && (
                <small className="field-error port-error">{errors.port}</small>
              )}

              <div className="form-note">
                <span aria-hidden="true">i</span>
                Authentication will be added with OS keychain-backed storage. Do
                not put secrets in these fields.
              </div>

              <button className="primary-action" type="submit">
                Add connection profile
              </button>
              <p className="form-status" aria-live="polite">
                {notice}
              </p>
            </form>
          </aside>
        </section>
      </main>
    </div>
  );
}

export default App;

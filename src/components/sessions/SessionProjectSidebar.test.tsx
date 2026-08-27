import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  emptySessionSidebarLayout,
  reconcileSessionSidebarLayout,
} from "../../app/sessionSidebarLayout";
import { I18nProvider } from "../../i18n";
import { SessionProjectSidebar } from "./SessionProjectSidebar";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("session project sidebar", () => {
  it("renders a project's child session with its remove action", () => {
    vi.stubGlobal("window", { innerWidth: 1200, innerHeight: 800 });
    const projectNodeId = "project:local:latticeterm";
    const sessionNodeId = "session:agent:codex";
    const layout = reconcileSessionSidebarLayout(emptySessionSidebarLayout, [
      { id: projectNodeId, defaultParentId: null },
      { id: sessionNodeId, defaultParentId: projectNodeId },
    ]);

    const markup = renderToStaticMarkup(
      <I18nProvider locale="zh-TW">
        <SessionProjectSidebar
          projects={[
            {
              nodeId: projectNodeId,
              projectId: "local:latticeterm",
              label: "LatticeTerm",
              workingDirectory: "/workspace/LatticeTerm",
              sessions: [
                {
                  nodeId: sessionNodeId,
                  sessionId: "agent-codex",
                  label: "Codex",
                  kind: "agent",
                  status: "working",
                },
              ],
            },
          ]}
          layout={layout}
          activeSessionId="agent-codex"
          choosingProject={false}
          chooseError={false}
          installedAgents={[]}
          onChooseProject={vi.fn()}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
          onQuickLaunch={vi.fn()}
          onCreateFolder={vi.fn()}
          onRenameFolder={vi.fn()}
          onDeleteFolder={vi.fn()}
          onToggleFolder={vi.fn()}
          onMove={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(markup).toContain("LatticeTerm");
    expect(markup).toContain("Codex");
    expect(markup).toContain('class="session-tree__project-branch"');
    expect(markup).toContain("移除「Codex」工作階段");
  });
});

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  RemoteDirectory,
  RemoteSessionSummary,
} from "../../app/useRemoteSessions";
import { I18nProvider } from "../../i18n";
import {
  AgentRemoteDelivery,
  inspectRemoteDeliveryTarget,
  remoteDeliveryPath,
  remoteFileSessions,
} from "./AgentRemoteDelivery";

function session(
  overrides: Partial<RemoteSessionSummary> = {},
): RemoteSessionSummary {
  return {
    sessionId: "remote-1",
    profileId: "profile-1",
    host: "123 456 789",
    port: 44900,
    viaRelay: true,
    agentName: "Office PC",
    width: 1920,
    height: 1080,
    viewOnly: true,
    fileTransfer: true,
    fileRootLabel: "Deliveries",
    terminal: false,
    frame: null,
    ...overrides,
  };
}

function directory(entries: RemoteDirectory["entries"]): RemoteDirectory {
  return { path: "/reports", entries };
}

describe("Agent Remote delivery", () => {
  it("lists only sessions whose host authorised file access", () => {
    const allowed = session();
    const viewOnly = session({ sessionId: "remote-2", fileTransfer: false });

    expect(remoteFileSessions([viewOnly, allowed])).toEqual([allowed]);
  });

  it("preflights overwrites without replacing directories or symlinks", () => {
    expect(inspectRemoteDeliveryTarget(directory([]), "report.pdf")).toEqual({
      overwrite: false,
      blocked: false,
    });
    expect(
      inspectRemoteDeliveryTarget(
        directory([
          {
            name: "report.pdf",
            path: "/reports/report.pdf",
            kind: "file",
            size: 42,
            modifiedAt: null,
          },
        ]),
        "report.pdf",
      ),
    ).toEqual({ overwrite: true, blocked: false });
    expect(
      inspectRemoteDeliveryTarget(
        directory([
          {
            name: "report.pdf",
            path: "/reports/report.pdf",
            kind: "directory",
            size: 0,
            modifiedAt: null,
          },
        ]),
        "report.pdf",
      ),
    ).toEqual({ overwrite: true, blocked: true });
    expect(remoteDeliveryPath("/", "report.pdf")).toBe("/report.pdf");
    expect(remoteDeliveryPath("/reports/", "report.pdf")).toBe(
      "/reports/report.pdf",
    );
  });

  it("explains the explicit-selection boundary when no Remote is ready", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider locale="zh-TW">
        <AgentRemoteDelivery
          remote={{
            sessions: [],
            listFiles: vi.fn(),
            uploadFile: vi.fn(),
          }}
        />
      </I18nProvider>,
    );

    expect(markup).toContain("將 Agent 成果送到 Lattice Remote");
    expect(markup).toContain("只有你明確選取的檔案會被傳送");
    expect(markup).toContain("目前沒有已開啟檔案權限");
  });

  it("shows an authorised Remote target and file picker", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider locale="zh-TW">
        <AgentRemoteDelivery
          remote={{
            sessions: [session()],
            listFiles: vi.fn(),
            uploadFile: vi.fn(),
          }}
        />
      </I18nProvider>,
    );

    expect(markup).toContain("Office PC · 123 456 789 · 分享 Deliveries");
    expect(markup).toContain("選擇檔案");
    expect(markup).toContain("檢查並準備傳送");
  });
});

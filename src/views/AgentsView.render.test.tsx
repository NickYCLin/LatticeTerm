/**
 * Static renders of the Fleet page.  These guard what a person sees on the
 * CLI cards: the account picker with each account's login state, the
 * install command for a CLI that is missing, and the sandbox option only
 * where bubblewrap works.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_ACCOUNT_PROFILES_KEY } from "../app/chatAccountProfiles";
import {
  fakeAgentApi,
  fakeDefinition,
  fakeRemoteApi,
  fakeSession,
  installFakeStorage,
} from "../app/testFixtures/agentApis";
import { I18nProvider } from "../i18n";
import { AgentsView } from "./AgentsView";

function render(
  agents = fakeAgentApi(),
  { sandboxAvailable = false } = {},
): string {
  return renderToStaticMarkup(
    <I18nProvider locale="zh-TW">
      <AgentsView
        agents={agents}
        remote={fakeRemoteApi()}
        sandboxAvailable={sandboxAvailable}
        onOpen={vi.fn()}
      />
    </I18nProvider>,
  );
}

describe("AgentsView", () => {
  let restoreStorage: (() => void) | null = null;
  afterEach(() => {
    restoreStorage?.();
    restoreStorage = null;
  });

  it("offers the account picker with the signed-in default and a named account", () => {
    restoreStorage = installFakeStorage({
      [CHAT_ACCOUNT_PROFILES_KEY]: JSON.stringify([
        { id: "work", definitionId: "codex", name: "公司帳號", configDirectory: "/p/work", managed: true },
      ]),
    });
    const markup = render();

    expect(markup).toContain("啟動時使用的帳號");
    expect(markup).toContain("目前登入的帳號：me@example.com");
    // Before the backend answers, a named account is listed with an unknown state.
    expect(markup).toContain("公司帳號（登入狀態未知）");
    expect(markup).toContain("新增另一個帳號…");
    expect(markup).not.toContain("帳號設定檔");
  });

  it("does not offer accounts for a CLI without profile support", () => {
    const markup = render(fakeAgentApi({
      catalog: [fakeDefinition({ id: "gemini", label: "Gemini CLI", executable: "gemini" })],
    }));

    expect(markup).not.toContain("啟動時使用的帳號");
    expect(markup).not.toContain("新增另一個帳號…");
  });

  it("shows the fixed install command instead of a launch for a missing CLI", () => {
    const markup = render(fakeAgentApi({
      catalog: [fakeDefinition({ installed: false, installedPath: null })],
    }));

    expect(markup).toContain("npm install -g @openai/codex");
    expect(markup).not.toContain("啟動時使用的帳號");
  });

  it("offers keeping a session in the background and badges one that is", () => {
    const markup = render(fakeAgentApi({
      sessions: [fakeSession({ detached: true, label: "夜間批次" })],
    }));
    expect(markup).toContain("留在背景");
    expect(markup).toContain("夜間批次");
    expect(markup).toContain(">背景<");
  });

  it("badges a saved launch plan that restores into the background", () => {
    const markup = render(fakeAgentApi({
      plans: [{
        id: "plan-1",
        definitionId: "codex",
        label: "夜間批次",
        executable: "",
        arguments: [],
        resumeSessionId: null,
        note: "",
        sandbox: false,
        detached: true,
        workingDirectory: "/work",
      }],
    }));
    expect(markup).toContain("夜間批次");
    expect(markup).toContain(">背景<");
  });

  it("offers the sandbox only when bubblewrap was probed to work", () => {
    expect(render(fakeAgentApi(), { sandboxAvailable: true })).toContain("bubblewrap");
    expect(render(fakeAgentApi(), { sandboxAvailable: false })).not.toContain("bubblewrap");
  });
});

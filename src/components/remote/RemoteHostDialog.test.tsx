import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemoteHostApi } from "../../app/useRemoteHost";
import { I18nProvider } from "../../i18n";
import { RemoteHostDialog } from "./RemoteHostDialog";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remote host dialog", () => {
  it("shows the permanent device ID before sharing starts", () => {
    const storage: Storage = {
      length: 0,
      clear: vi.fn(),
      getItem: vi.fn(() => null),
      key: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };
    vi.stubGlobal("window", { localStorage: storage });

    const host: RemoteHostApi = {
      deviceId: "123456789",
      deviceIdError: null,
      status: null,
      closedReason: null,
      start: vi.fn(),
      stop: vi.fn(),
      clearClosedReason: vi.fn(),
    };
    const markup = renderToStaticMarkup(
      <I18nProvider locale="zh-TW">
        <RemoteHostDialog
          host={host}
          sensitiveClipboardClear="off"
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(markup).toContain("這台裝置的永久 ID");
    expect(markup).toContain("123 456 789");
    expect(markup).toContain("重新啟動 LatticeTerm 或電腦後仍會保持相同");
    expect(markup).toContain('aria-label="複製裝置 ID"');
  });
});

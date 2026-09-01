import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemoteHostApi } from "../../app/useRemoteHost";
import { I18nProvider } from "../../i18n";
import { RemoteHostDialog } from "./RemoteHostDialog";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("remote host dialog", () => {
  function render(savedRelayAddress: string | null) {
    const storage: Storage = {
      length: 0,
      clear: vi.fn(),
      getItem: vi.fn(() => savedRelayAddress),
      key: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };
    vi.stubGlobal("window", { localStorage: storage });

    const host: RemoteHostApi = {
      deviceId: "123456789",
      deviceIdError: null,
      ensureDeviceId: vi.fn(async () => {}),
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
    return { host, markup };
  }

  it("shows the permanent device ID before relay sharing starts", () => {
    // A saved relay address opens the dialog in relay mode.
    const { markup } = render("wss://relay.example/ws");

    expect(markup).toContain("這台裝置的永久 ID");
    expect(markup).toContain("123 456 789");
    expect(markup).toContain("重新啟動 LatticeTerm 或電腦後仍會保持相同");
    expect(markup).toContain('aria-label="複製裝置 ID"');
  });

  it("hides the relay identity while direct sharing is selected", () => {
    // The nine-digit ID only means anything to a relay, and reading it creates
    // an identity file holding a registration token and a Noise private key.
    const { markup } = render(null);

    expect(markup).not.toContain("這台裝置的永久 ID");
    expect(markup).not.toContain("123 456 789");
    expect(markup).toContain("區網直連");
  });
});

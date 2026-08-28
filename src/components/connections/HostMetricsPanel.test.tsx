import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../i18n";
import type { MetricsState } from "../../domain/metrics";
import { HostMetricsPanel } from "./HostMetricsPanel";

const ready: MetricsState = {
  status: "ready",
  metrics: {
    collectedAt: Date.UTC(2026, 7, 28, 2, 30),
    uptimeSeconds: 183_600,
    cpu: {
      usagePercent: 37,
      cores: 4,
      model: "Test CPU",
      loadAverage: [0.4, 0.3, 0.2],
    },
    memory: {
      usedBytes: 4 * 1024 ** 3,
      totalBytes: 8 * 1024 ** 3,
    },
    disks: [
      {
        mountpoint: "/",
        filesystem: "ext4",
        usedBytes: 25 * 1024 ** 3,
        totalBytes: 100 * 1024 ** 3,
      },
    ],
  },
};

describe("host metrics panel", () => {
  it("renders SSH sidebar readings as one compact accessible row", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider locale="zh-TW">
        <HostMetricsPanel state={ready} variant="compact" />
      </I18nProvider>,
    );

    expect(markup).toContain('class="host-metrics-compact"');
    expect(markup).toContain("處理器: 37%. Test CPU · 4 核心");
    expect(markup).toContain("記憶體: 50%");
    expect(markup).toContain("磁碟 /: 25%");
    expect(markup).not.toContain('class="metric-card"');
  });
});

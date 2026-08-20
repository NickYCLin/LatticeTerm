/**
 * Host resources for the selected connection.
 *
 * Renders whatever state the reading is in. Today every host reports
 * `unavailable`, because resource figures can only come from an established
 * session — so this panel explains that rather than showing invented numbers
 * or a spinner that will never finish.
 */

import {
  formatBytes,
  sortDisks,
  splitUptime,
  usageLevel,
  usagePercent,
  type MetricsState,
} from "../../domain/metrics";
import { useI18n } from "../../i18n";
import { Callout } from "../common/Callout";
import { ClockIcon, CpuIcon, DiskIcon, MemoryIcon } from "../icons";
import type { ReactNode } from "react";

function Meter({ percent }: { percent: number }) {
  const level = usageLevel(percent);
  return (
    <div
      className={`meter meter--${level}`}
      role="meter"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="meter__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  percent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  percent?: number;
}) {
  return (
    <div className="metric-card">
      <div className="metric-card__head">
        <span style={{ display: "flex", color: "var(--text-faint)" }}>
          {icon}
        </span>
        <span className="metric-card__label">{label}</span>
        <span className="metric-card__value">{value}</span>
      </div>
      {percent !== undefined && <Meter percent={percent} />}
      {detail && <span className="metric-card__detail">{detail}</span>}
    </div>
  );
}

export function HostMetricsPanel({ state }: { state: MetricsState }) {
  const { t, tag } = useI18n();

  if (state.status === "unavailable") {
    return (
      <Callout tone="info" title={t("metrics.notConnected.title")}>
        {t("metrics.notConnected.body")}
      </Callout>
    );
  }

  if (state.status === "loading") {
    return <p className="text-faint">{t("common.detecting")}</p>;
  }

  if (state.status === "error") {
    return (
      <Callout tone="danger" title={t("metrics.title")}>
        {state.detail}
      </Callout>
    );
  }

  const { metrics } = state;
  const memoryPercent = usagePercent(
    metrics.memory.usedBytes,
    metrics.memory.totalBytes,
  );
  const uptime = splitUptime(metrics.uptimeSeconds);

  return (
    <div className="inspector__section">
      <MetricCard
        icon={<CpuIcon size={14} />}
        label={t("metrics.cpu")}
        value={`${Math.round(metrics.cpu.usagePercent)}%`}
        detail={[
          t("metrics.cores", { count: metrics.cpu.cores }),
          metrics.cpu.loadAverage
            ? `${t("metrics.load")} ${metrics.cpu.loadAverage.join(" / ")}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" · ")}
        percent={Math.round(metrics.cpu.usagePercent)}
      />

      <MetricCard
        icon={<MemoryIcon size={14} />}
        label={t("metrics.memory")}
        value={t("metrics.percentUsed", { percent: memoryPercent })}
        detail={t("metrics.usedOfTotal", {
          used: formatBytes(metrics.memory.usedBytes, tag),
          total: formatBytes(metrics.memory.totalBytes, tag),
        })}
        percent={memoryPercent}
      />

      {sortDisks(metrics.disks).map((disk) => {
        const percent = usagePercent(disk.usedBytes, disk.totalBytes);
        return (
          <MetricCard
            key={disk.mountpoint}
            icon={<DiskIcon size={14} />}
            label={`${t("metrics.disk")} ${disk.mountpoint}`}
            value={t("metrics.percentUsed", { percent })}
            detail={t("metrics.usedOfTotal", {
              used: formatBytes(disk.usedBytes, tag),
              total: formatBytes(disk.totalBytes, tag),
            })}
            percent={percent}
          />
        );
      })}

      <MetricCard
        icon={<ClockIcon size={14} />}
        label={t("metrics.uptime")}
        value={
          uptime.days > 0
            ? t("metrics.uptimeValue", {
                days: uptime.days,
                hours: uptime.hours,
              })
            : t("metrics.uptimeHours", {
                hours: uptime.hours,
                minutes: uptime.minutes,
              })
        }
      />
    </div>
  );
}

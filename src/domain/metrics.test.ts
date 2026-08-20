import { describe, expect, it } from "vitest";
import {
  formatBytes,
  initialMetricsState,
  sortDisks,
  splitUptime,
  usageLevel,
  usagePercent,
  type DiskReading,
} from "./metrics";

describe("byte formatting", () => {
  it("scales through the units and keeps small values precise", () => {
    expect(formatBytes(0, "en")).toBe("0 B");
    expect(formatBytes(512, "en")).toBe("512 B");
    expect(formatBytes(1024, "en")).toBe("1.0 KB");
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
    expect(formatBytes(9.4 * 1024 ** 3, "en")).toBe("9.4 GB");
  });

  it("drops the decimal once the number is big enough to read", () => {
    expect(formatBytes(421 * 1024 ** 3, "en")).toBe("421 GB");
  });

  it("refuses to guess for impossible input", () => {
    expect(formatBytes(-1, "en")).toBe("—");
    expect(formatBytes(Number.NaN, "en")).toBe("—");
  });
});

describe("usage share", () => {
  it("rounds to a whole percent", () => {
    expect(usagePercent(1, 3)).toBe(33);
    expect(usagePercent(2, 3)).toBe(67);
  });

  it("never divides by zero or exceeds the bounds", () => {
    expect(usagePercent(5, 0)).toBe(0);
    expect(usagePercent(-5, 100)).toBe(0);
    expect(usagePercent(500, 100)).toBe(100);
  });

  it("bands the figure for the meter colour", () => {
    expect(usageLevel(10)).toBe("normal");
    expect(usageLevel(74)).toBe("normal");
    expect(usageLevel(75)).toBe("warning");
    expect(usageLevel(89)).toBe("warning");
    expect(usageLevel(90)).toBe("critical");
  });
});

describe("uptime", () => {
  it("splits seconds into days, hours and minutes", () => {
    expect(splitUptime(90_061)).toEqual({ days: 1, hours: 1, minutes: 1 });
  });

  it("treats missing or negative input as no uptime", () => {
    expect(splitUptime(-10)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
});

describe("disks", () => {
  const disk = (
    mountpoint: string,
    usedBytes: number,
    totalBytes: number,
  ): DiskReading => ({ mountpoint, usedBytes, totalBytes });

  it("puts the fullest volume first", () => {
    const sorted = sortDisks([
      disk("/", 40, 100),
      disk("/var", 95, 100),
      disk("/home", 60, 100),
    ]);

    expect(sorted.map((entry) => entry.mountpoint)).toEqual([
      "/var",
      "/home",
      "/",
    ]);
  });

  it("does not mutate the input", () => {
    const input = [disk("/", 10, 100), disk("/var", 90, 100)];
    sortDisks(input);
    expect(input[0].mountpoint).toBe("/");
  });
});

describe("initial state", () => {
  it("starts unavailable, because no session exists yet", () => {
    expect(initialMetricsState).toEqual({
      status: "unavailable",
      reason: "not-connected",
    });
  });
});

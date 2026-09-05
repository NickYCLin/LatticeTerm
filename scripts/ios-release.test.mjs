import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { environmentProblems, releaseArguments, releaseConfig, simulatorArguments, simulatorXcodebuildScript, synchronizeNativeVersions } from "./ios-release.mjs";

describe("iOS 發布準備", () => {
  it.skipIf(process.platform === "win32")("只對模擬器建置指定 SDK，且原樣傳遞含空白的路徑", () => {
    const directory = mkdtempSync(join(tmpdir(), "ios-xcode-"));
    try {
      const realTool = join(directory, "Xcode's real tool");
      const wrapper = join(directory, "xcodebuild");
      writeFileSync(realTool, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
      writeFileSync(wrapper, simulatorXcodebuildScript(realTool, "arm64"), { mode: 0o755 });
      const run = (args) => execFileSync(wrapper, args, { encoding: "utf8" }).trim().split("\n");
      expect(run(["-version"])).toEqual(["-version"]);
      expect(run(["archive", "-archivePath", "/a path/archive"])).toEqual([
        "archive", "-archivePath", "/a path/archive", "-sdk", "iphonesimulator", "-destination", "generic/platform=iOS Simulator", "ARCHS=arm64",
      ]);
      const explicit = ["archive", "-sdk", "iphonesimulator", "-destination", "generic/platform=iOS Simulator", "ARCHS=arm64"];
      expect(run(explicit)).toEqual(explicit);
      expect(run(["archive", "-sdk", "iphoneos", "-destination", "generic/platform=iOS"])).toEqual(explicit);
      expect(run(["archive", "-arch", "x86_64", "ARCHS=arm64 x86_64"])).toEqual(explicit);
      writeFileSync(wrapper, simulatorXcodebuildScript(realTool, "x64"), { mode: 0o755 });
      expect(run(["archive"]).at(-1)).toBe("ARCHS=x86_64");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 30_000);
  it("Intel 與 Apple silicon 模擬器都不使用實機 target 或簽章", () => {
    expect(simulatorArguments("config.json", "x64")).toContain("x86_64");
    expect(simulatorArguments("config.json", "arm64")).toContain("aarch64-sim");
    expect(simulatorArguments("config.json", "arm64")).toContain("--no-sign");
    expect(simulatorArguments("config.json", "arm64")).not.toContain("aarch64");
    expect(() => simulatorArguments("config.json", "unknown")).toThrow();
  });
  it("最佳化模擬器使用 Release 並保留無簽章邊界", () => {
    const args = simulatorArguments("config.json", "arm64", true);
    expect(args).not.toContain("--debug");
    expect(args).toContain("--no-sign");
    expect(args).toContain("aarch64-sim");
    expect(simulatorArguments("config.json", "arm64")).toContain("--debug");
    expect(() => simulatorXcodebuildScript("/xcodebuild", "unknown")).toThrow();
  });
  it("同一行銷版本可以產生不同建置號，且不帶入帳號資料", () => {
    expect(releaseConfig("0.45.0", "2")).toEqual({ version: "0.45.0", bundle: { iOS: { bundleVersion: "2" } } });
    expect(releaseConfig("0.45.0", "3").bundle.iOS.bundleVersion).toBe("3");
    expect(releaseConfig("1.0.0", "9999.99.99").bundle.iOS.bundleVersion).toBe("9999.99.99");
  });
  it.each([undefined, "", "0", "01", "10000", "1.100", "1.1.100", "1.2.3.4", "1;echo secret", "1beta"]) (
    "拒絕 Apple 不接受的建置號 %s", (number) => expect(() => releaseConfig("1.0.0", number)).toThrow(),
  );
  it.each(["1.0.0-beta", "v1.0.0", "1.0", "01.0.0"]) (
    "拒絕不適用 App Store 的版本 %s", (version) => expect(() => releaseConfig(version, "1")).toThrow(),
  );
  it("TestFlight 與商店均使用 App Store Connect 的實機匯出方式", () => {
    const args = releaseArguments("/a path/config.json");
    expect(args).toContain("app-store-connect");
    expect(args).toContain("aarch64");
    expect(args.at(-1)).toBe("/a path/config.json");
    expect(args).not.toContain("release-testing");
    expect(args).not.toContain("--build-number");
    expect(args).not.toContain("--no-sign");
  });
  it("列出舊 SDK、團隊與憑證缺項而不宣稱已可送審", () => {
    const problems = environmentProblems({ platform: "darwin", xcode: "Xcode 16.4", sdk: "18.5", team: undefined, identities: "0 valid identities found" });
    expect(problems).toHaveLength(4);
    expect(problems.join("\n")).toContain("Xcode 26");
  });
  it("接受新 SDK 與自動簽章的開發憑證", () => {
    expect(environmentProblems({ platform: "darwin", xcode: "Xcode 26.1\nBuild version 17B", sdk: "26.1", team: "ABCDEFGHIJ", identities: '1) hash "Apple Development: Example (ABCDEFGHIJ)"' })).toEqual([]);
  });
  it("同步過期的原生版本時保留其他 plist 欄位", () => {
    const source = '<key>CFBundleShortVersionString</key>\n<string>0.36.0</string>\n<key>CFBundleVersion</key>\n<string>0.36.0</string>\n<key>Other</key><true/>';
    const result = synchronizeNativeVersions('CFBundleShortVersionString: 0.34.0\nCFBundleVersion: "0.34.0"', source, "0.45.0");
    expect(result.project).not.toContain("0.34.0");
    expect(result.plist).not.toContain("0.36.0");
    expect(result.plist).toContain("<key>Other</key><true/>");
    expect(result.plist).toContain("<string>0.45.0</string>");
    expect(result.plist).toContain("<string>1</string>");
    expect(result.project).toContain('CFBundleVersion: "1"');
  });
  it("原生結構改變時停止，避免只同步部分欄位", () => {
    expect(() => synchronizeNativeVersions("missing", "missing", "1.0.0")).toThrow();
  });
});

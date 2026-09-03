import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("iOS Tauri 設定", () => {
  it("只在 iOS 覆寫 In-House profile 對應的識別與開發團隊", () => {
    const desktopConfig = JSON.parse(
      readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
    );
    const iosConfig = JSON.parse(
      readFileSync(
        new URL("../src-tauri/tauri.ios.conf.json", import.meta.url),
        "utf8",
      ),
    );

    expect(desktopConfig.identifier).toBe("io.github.nickyclin.latticeterm");
    expect(desktopConfig.bundle.iOS).toBeUndefined();
    expect(iosConfig.identifier).toBe("tw.nickyclin.latticeterm");
    expect(iosConfig.bundle.iOS.developmentTeam).toBe("SQDAQK66UY");
  });

  it("同步 Apple/Xcode 專案的 bundle identifier", () => {
    const projectDefinition = readFileSync(
      new URL("../src-tauri/gen/apple/project.yml", import.meta.url),
      "utf8",
    );
    const xcodeProject = readFileSync(
      new URL(
        "../src-tauri/gen/apple/lattice-term.xcodeproj/project.pbxproj",
        import.meta.url,
      ),
      "utf8",
    );

    for (const source of [projectDefinition, xcodeProject]) {
      expect(source).toContain("tw.nickyclin.latticeterm");
      expect(source).not.toContain("io.github.nickyclin.latticeterm");
    }

    expect(projectDefinition).toContain('CODE_SIGN_IDENTITY: "iPhone Distribution"');
    expect(projectDefinition).toContain("CODE_SIGN_STYLE: Manual");
    expect(projectDefinition).toContain("DEVELOPMENT_TEAM: SQDAQK66UY");
    expect(projectDefinition).toContain(
      "PROVISIONING_PROFILE_SPECIFIER: InHouse_nickyclinLatticeterm_2026_09_03",
    );
    expect(projectDefinition).not.toContain("- path: Externals");
  });

  it("不將桌面 sidecar 納入 iOS bundle", () => {
    const config = JSON.parse(
      readFileSync(new URL("../src-tauri/tauri.ios.conf.json", import.meta.url), "utf8"),
    );

    expect(config.bundle.externalBin).toEqual([]);
  });

  it("啟用 iOS Keychain 的 protected feature", () => {
    const cargoManifest = readFileSync(
      new URL("../src-tauri/Cargo.toml", import.meta.url),
      "utf8",
    );

    expect(cargoManifest).toContain(
      'apple-native-keyring-store = { version = "1.0.2", features = ["protected"] }',
    );
  });
});

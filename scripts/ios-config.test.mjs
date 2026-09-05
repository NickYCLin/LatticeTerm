import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("iOS Tauri 設定", () => {
  it("iOS 沿用個人識別且不硬編碼開發團隊", () => {
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
    expect(iosConfig.identifier).toBe("io.github.nickyclin.latticeterm");
    expect(iosConfig.bundle.iOS).toBeUndefined();
  });

  it("Apple/Xcode 專案使用個人自動簽章設定", () => {
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
      expect(source).toContain("io.github.nickyclin.latticeterm");
      expect(source).not.toContain("tw.nickyclin.latticeterm");
      expect(source).not.toContain("SQDAQK66UY");
      expect(source).not.toContain("InHouse_nickyclinLatticeterm_2026_09_03");
    }

    expect(projectDefinition).toContain('CODE_SIGN_IDENTITY: "Apple Development"');
    expect(projectDefinition).toContain("CODE_SIGN_STYLE: Automatic");
    expect(xcodeProject).toContain('CODE_SIGN_IDENTITY = "Apple Development";');
    expect(xcodeProject).toContain("CODE_SIGN_STYLE = Automatic;");
    expect(projectDefinition).not.toContain("- path: Externals");
  });

  it("iOS 實機維持 arm64，模擬器則使用 Xcode 的主機相容架構", () => {
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
      expect(source).toContain("ARCHS[sdk=iphoneos*]");
      expect(source).not.toMatch(/\bVALID_ARCHS\b/);
    }
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

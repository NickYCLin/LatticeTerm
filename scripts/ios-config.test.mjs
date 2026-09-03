import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("iOS Tauri 設定", () => {
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

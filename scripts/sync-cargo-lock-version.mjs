import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cargoTomlPath = resolve(root, "src-tauri/Cargo.toml");
const cargoLockPath = resolve(root, "src-tauri/Cargo.lock");

const cargoToml = readFileSync(cargoTomlPath, "utf8");
const packageSection = cargoToml.split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
const version = packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];

if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`src-tauri/Cargo.toml 沒有有效的 package.version：${String(version)}`);
}

const cargoLock = readFileSync(cargoLockPath, "utf8");
const packagePattern = /(\[\[package\]\]\s*\nname\s*=\s*"lattice-term"\s*\nversion\s*=\s*")([^"]+)(")/g;
const matches = [...cargoLock.matchAll(packagePattern)];

if (matches.length !== 1) {
  throw new Error(`src-tauri/Cargo.lock 應恰好有一個 lattice-term package block，實際為 ${matches.length} 個。`);
}

const currentVersion = matches[0][2];
if (currentVersion === version) {
  console.log(`Cargo.lock 已是 ${version}，不需更新。`);
  process.exit(0);
}

const updated = cargoLock.replace(
  packagePattern,
  (_match, prefix, _previousVersion, suffix) => `${prefix}${version}${suffix}`,
);
writeFileSync(cargoLockPath, updated);
console.log(`Cargo.lock：${currentVersion} → ${version}`);

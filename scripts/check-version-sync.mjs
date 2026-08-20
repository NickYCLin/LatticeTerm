import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function requiredVersion(label, value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`${label} 沒有有效的 SemVer 版本：${String(value)}`);
  }
  return [label, value];
}

function cargoPackageVersion(path) {
  const packageSection = read(path).split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
  const version = packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  return requiredVersion(`${path} [package].version`, version);
}

function cargoLockVersion(path, packageName) {
  const packageBlock = read(path)
    .split(/^\[\[package\]\]\s*$/m)
    .find((block) => block.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1] === packageName);
  const version = packageBlock?.match(/^version\s*=\s*"([^"]+)"(?:\s*#.*)?\s*$/m)?.[1];
  return requiredVersion(`${path} ${packageName}`, version);
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const releaseManifest = readJson(".release-please-manifest.json");

const sources = [
  requiredVersion("package.json", packageJson.version),
  requiredVersion("package-lock.json", packageLock.version),
  requiredVersion('package-lock.json packages[""]', packageLock.packages?.[""]?.version),
  requiredVersion(".release-please-manifest.json", releaseManifest["."]),
  requiredVersion("src-tauri/tauri.conf.json", tauriConfig.version),
  cargoPackageVersion("src-tauri/Cargo.toml"),
  cargoLockVersion("src-tauri/Cargo.lock", "lattice-term"),
];

const expected = sources[0][1];
const mismatches = sources.filter(([, version]) => version !== expected);

if (mismatches.length > 0) {
  const details = sources.map(([label, version]) => `  - ${label}: ${version}`).join("\n");
  throw new Error(`版本來源不一致，應全部與 package.json 的 ${expected} 相同：\n${details}`);
}

console.log(`版本一致：${expected}（${sources.length} 個來源）`);

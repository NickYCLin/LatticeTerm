import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = process.argv.includes("--release");
const triples = {
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
};
const triple = triples[`${process.platform}-${process.arch}`];
if (!triple) {
  throw new Error(`Unsupported Lattice Agent target: ${process.platform}-${process.arch}`);
}

const environment = { ...process.env };
if (process.platform === "linux" && !environment.BINDGEN_EXTRA_CLANG_ARGS) {
  const gccInclude = execFileSync("gcc", ["-print-file-name=include"], {
    encoding: "utf8",
  }).trim();
  environment.BINDGEN_EXTRA_CLANG_ARGS = `-I${gccInclude}`;
}

const args = [
  "build",
  "--manifest-path",
  join(root, "crates/lattice-remote/Cargo.toml"),
  "--features",
  "agent",
  "--bin",
  "lattice-agent",
];
if (release) args.push("--release");
execFileSync("cargo", args, {
  cwd: root,
  env: environment,
  stdio: "inherit",
});

const extension = process.platform === "win32" ? ".exe" : "";
const profile = release ? "release" : "debug";
const source = join(
  root,
  "crates/lattice-remote/target",
  profile,
  `lattice-agent${extension}`,
);
const binaryDir = join(root, "src-tauri/binaries");
const destination = join(binaryDir, `lattice-agent-${triple}${extension}`);
mkdirSync(binaryDir, { recursive: true });
copyFileSync(source, destination);
console.log(`Prepared ${destination}`);

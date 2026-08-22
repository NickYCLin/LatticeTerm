import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(root, "dist");
const html = readFileSync(resolve(outputRoot, "index.html"), "utf8");
const entrySource = html.match(/<script\b[^>]*\bsrc="([^"]+\.js)"[^>]*><\/script>/)?.[1];

if (!entrySource) {
  throw new Error("找不到 dist/index.html 的 JavaScript 入口檔。");
}

const entryPath = resolve(outputRoot, entrySource.replace(/^\//, ""));
const entryBytes = statSync(entryPath).size;
const maximumEntryBytes = 500 * 1024;

if (entryBytes > maximumEntryBytes) {
  throw new Error(
    "前端入口檔過大：" +
      (entryBytes / 1024).toFixed(2) +
      " KiB，限制為 " +
      (maximumEntryBytes / 1024).toFixed(0) +
      " KiB。請把非首屏功能改為動態載入。",
  );
}

console.log(
  "前端入口大小：" +
    (entryBytes / 1024).toFixed(2) +
    " KiB（限制 " +
    (maximumEntryBytes / 1024).toFixed(0) +
    " KiB）",
);

import fs from "node:fs";

import { deduplicateChangelogEntries } from "./render-release-metadata.mjs";

const changelogPath = "CHANGELOG.md";
const before = fs.readFileSync(changelogPath, "utf8");
const after = deduplicateChangelogEntries(before);

if (after === before) {
  console.log("CHANGELOG.md 沒有重複版本項目。");
} else {
  fs.writeFileSync(changelogPath, after, "utf8");
  console.log("已移除 CHANGELOG.md 的重複版本項目。");
}

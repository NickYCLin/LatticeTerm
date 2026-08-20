import { execFileSync } from "node:child_process";

const [baseSha, headSha] = process.argv.slice(2);

if (!/^[0-9a-f]{40}$/.test(baseSha ?? "") || !/^[0-9a-f]{40}$/.test(headSha ?? "")) {
  console.error("用法：node .github/scripts/check-conventional-commits.mjs <base SHA> <head SHA>");
  process.exit(2);
}

const subjects = execFileSync(
  "git",
  ["log", "--format=%s", "--no-merges", `${baseSha}..${headSha}`],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);

const conventionalCommit = /^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|merge)(?:\([^)]+\))?!?: .+$/;
const invalid = subjects.filter((subject) => !conventionalCommit.test(subject));

if (subjects.length === 0) {
  console.error("PR 範圍內找不到可驗證的非合併提交。");
  process.exit(1);
}

if (invalid.length > 0) {
  console.error("下列提交不符合 Conventional Commits：");
  for (const subject of invalid) console.error(`  - ${subject}`);
  console.error("格式範例：feat(遠端): 加入主機分享模式");
  process.exit(1);
}

console.log(`Conventional Commits 驗證通過（${subjects.length} 筆）`);

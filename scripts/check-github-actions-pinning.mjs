import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workflowsDirectory = resolve(".github/workflows");
const workflowFiles = (await readdir(workflowsDirectory))
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .sort();
const failures = [];

for (const file of workflowFiles) {
  const contents = await readFile(resolve(workflowsDirectory, file), "utf8");
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*(?:-\s*)?uses:\s*["']?([^\s"'#]+)["']?/);
    if (!match || match[1].startsWith("./")) continue;

    const reference = match[1];
    const separator = reference.lastIndexOf("@");
    const revision = separator >= 0 ? reference.slice(separator + 1) : "";
    if (!/^[0-9a-f]{40}$/i.test(revision)) {
      failures.push(`${file}:${index + 1}: ${reference}`);
    }
  }
}

if (failures.length > 0) {
  console.error("GitHub Actions 必須固定到完整的 40 字元 commit SHA：");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`GitHub Actions 供應鏈檢查通過：${workflowFiles.length} 個 workflow 均使用不可變 SHA。`);
}

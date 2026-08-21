import fs from "node:fs";
import { pathToFileURL } from "node:url";

export function syncUpdaterReleaseNotes(manifest, metadata) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("latest.json 必須是 JSON 物件");
  }
  if (!manifest.version || !manifest.platforms) {
    throw new Error("latest.json 缺少版本或平台資料");
  }

  const notes = metadata?.body?.trim();
  if (!notes) {
    throw new Error("版本說明不可為空白");
  }

  return { ...manifest, notes };
}

function main() {
  const [, , manifestPath, metadataPath] = process.argv;
  if (!manifestPath || !metadataPath) {
    throw new Error(
      "用法：node scripts/sync-updater-release-notes.mjs <latest.json> <release-metadata.json>",
    );
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const updated = syncUpdaterReleaseNotes(manifest, metadata);
  fs.writeFileSync(manifestPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  console.log(`已同步 ${updated.version} 的 updater 版本說明。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

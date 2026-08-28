export type FileEntryKind = "directory" | "file" | "symlink" | "other";

export type FileEntryIconKind =
  | "folder"
  | "code"
  | "image"
  | "archive"
  | "document"
  | "database"
  | "terminal"
  | "link"
  | "file";

const CODE_EXTENSIONS = new Set([
  "css",
  "go",
  "htm",
  "html",
  "java",
  "js",
  "jsx",
  "json",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sql",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
]);
const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);
const ARCHIVE_EXTENSIONS = new Set([
  "7z",
  "bz2",
  "gz",
  "rar",
  "tar",
  "tgz",
  "xz",
  "zip",
]);
const DOCUMENT_EXTENSIONS = new Set([
  "csv",
  "doc",
  "docx",
  "log",
  "md",
  "pdf",
  "ppt",
  "pptx",
  "rtf",
  "txt",
  "xls",
  "xlsx",
]);
const DATABASE_EXTENSIONS = new Set(["db", "sqlite", "sqlite3"]);
const TERMINAL_EXTENSIONS = new Set([
  "bat",
  "cmd",
  "exe",
  "msi",
  "ps1",
  "sh",
  "zsh",
]);

export function isHiddenEntryName(name: string): boolean {
  return name.startsWith(".") && name !== "." && name !== "..";
}

export function fileEntryIconKind(
  name: string,
  kind: FileEntryKind,
): FileEntryIconKind {
  if (kind === "directory") return "folder";
  if (kind === "symlink") return "link";

  const lower = name.toLocaleLowerCase();
  if (
    ["dockerfile", "makefile", ".env", ".gitignore", ".npmrc"].includes(lower)
  ) {
    return "code";
  }
  const boundary = lower.lastIndexOf(".");
  const extension = boundary >= 0 ? lower.slice(boundary + 1) : "";
  if (CODE_EXTENSIONS.has(extension)) return "code";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (ARCHIVE_EXTENSIONS.has(extension)) return "archive";
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
  if (DATABASE_EXTENSIONS.has(extension)) return "database";
  if (TERMINAL_EXTENSIONS.has(extension)) return "terminal";
  return "file";
}

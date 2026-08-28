import { describe, expect, it } from "vitest";
import { fileEntryIconKind, isHiddenEntryName } from "./fileEntryPresentation";

describe("file entry presentation", () => {
  it("keeps directories and hidden names distinct", () => {
    expect(fileEntryIconKind(".config", "directory")).toBe("folder");
    expect(isHiddenEntryName(".config")).toBe(true);
    expect(isHiddenEntryName("..")).toBe(false);
  });

  it("maps common extensions to stable built-in icon groups", () => {
    expect(fileEntryIconKind("index.html", "file")).toBe("code");
    expect(fileEntryIconKind("photo.webp", "file")).toBe("image");
    expect(fileEntryIconKind("backup.tar.gz", "file")).toBe("archive");
    expect(fileEntryIconKind("manual.pdf", "file")).toBe("document");
    expect(fileEntryIconKind("app.sqlite3", "file")).toBe("database");
    expect(fileEntryIconKind("deploy.ps1", "file")).toBe("terminal");
    expect(fileEntryIconKind("latest", "symlink")).toBe("link");
  });
});

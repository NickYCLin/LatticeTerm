import { describe, expect, it } from "vitest";
import { displayPath } from "./displayPath";

describe("displayPath", () => {
  it("removes Windows verbatim prefixes for drive and UNC paths", () => {
    expect(displayPath("\\\\?\\C:\\Users\\casey")).toBe(
      "C:\\Users\\casey",
    );
    expect(displayPath("\\\\?\\UNC\\server\\share\\project")).toBe(
      "\\\\server\\share\\project",
    );
  });

  it("leaves ordinary paths unchanged", () => {
    expect(displayPath("D:\\project\\LatticeTerm")).toBe(
      "D:\\project\\LatticeTerm",
    );
    expect(displayPath("/work/project")).toBe("/work/project");
  });
});

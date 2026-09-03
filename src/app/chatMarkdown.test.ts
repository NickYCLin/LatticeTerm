import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./chatMarkdown";

describe("parseInline", () => {
  it("reads code spans and bold", () => {
    expect(parseInline("run `npm test` **now**")).toEqual([
      { type: "text", text: "run " },
      { type: "code", text: "npm test" },
      { type: "text", text: " " },
      { type: "strong", children: [{ type: "text", text: "now" }] },
    ]);
  });

  it("keeps an unclosed marker as plain text", () => {
    expect(parseInline("a ` b ** c")).toEqual([
      { type: "text", text: "a ` b ** c" },
    ]);
  });

  it("lets a double backtick span contain a single backtick", () => {
    expect(parseInline("``a ` b``")).toEqual([{ type: "code", text: "a ` b" }]);
  });
});

describe("parseMarkdown", () => {
  it("splits paragraphs, headings, lists and fenced code", () => {
    const blocks = parseMarkdown(
      [
        "## 結論",
        "第一段",
        "接續同一段",
        "",
        "- 一",
        "- 二",
        "1. 甲",
        "2. 乙",
        "",
        "```ts",
        "const a = 1;",
        "```",
      ].join("\n"),
    );

    expect(blocks).toEqual([
      { type: "heading", level: 2, children: [{ type: "text", text: "結論" }] },
      {
        type: "paragraph",
        children: [{ type: "text", text: "第一段 接續同一段" }],
      },
      {
        type: "list",
        ordered: false,
        items: [[{ type: "text", text: "一" }], [{ type: "text", text: "二" }]],
      },
      {
        type: "list",
        ordered: true,
        items: [[{ type: "text", text: "甲" }], [{ type: "text", text: "乙" }]],
      },
      { type: "code", language: "ts", text: "const a = 1;" },
    ]);
  });

  it("treats an unterminated fence as code to the end", () => {
    const blocks = parseMarkdown("```\nstill code\nmore");
    expect(blocks).toEqual([{ type: "code", language: "", text: "still code\nmore" }]);
  });

  it("never produces markup from angle brackets", () => {
    const blocks = parseMarkdown("<script>alert(1)</script>");
    expect(blocks).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", text: "<script>alert(1)</script>" }],
      },
    ]);
  });

  it("keeps indented lines with the list item above", () => {
    const blocks = parseMarkdown("- item\n  continued");
    expect(blocks).toEqual([
      {
        type: "list",
        ordered: false,
        items: [[{ type: "text", text: "item continued" }]],
      },
    ]);
  });
});

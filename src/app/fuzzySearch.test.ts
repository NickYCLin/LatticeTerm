import { describe, expect, it } from "vitest";
import { fuzzySearch } from "./fuzzySearch";

const candidates = [
  {
    value: "project-storyvoice",
    texts: ["StoryVoice", "D:\\project\\StoryVoice"],
  },
  {
    value: "session-codex",
    texts: ["OpenAI Codex", "StoryVoice", "gpt-5.6-sol"],
  },
  {
    value: "session-gemini",
    texts: ["Google Antigravity CLI", "StoryVoice", "Gemini CLI"],
  },
  {
    value: "project-vowbook",
    texts: ["VowBook", "D:\\project\\VowBook"],
  },
];

describe("fuzzy search", () => {
  it("ranks an exact project name ahead of secondary-field matches", () => {
    expect(fuzzySearch("StoryVoice", candidates)).toEqual([
      "project-storyvoice",
      "session-codex",
      "session-gemini",
    ]);
  });

  it("matches non-contiguous characters and multiple fields", () => {
    expect(fuzzySearch("styvc", candidates)[0]).toBe("project-storyvoice");
    expect(fuzzySearch("story codex", candidates)).toEqual(["session-codex"]);
  });

  it("normalizes full-width input and applies the result limit", () => {
    expect(fuzzySearch("Ｖｏｗ", candidates, 1)).toEqual(["project-vowbook"]);
    expect(fuzzySearch("missing", candidates)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { classifyCommit, decideRelease } from "./decide-release.mjs";

function commit(subject, body = "") {
  return { subject, body };
}

describe("classifyCommit", () => {
  it("reads the conventional-commit type and scope", () => {
    expect(classifyCommit(commit("fix(relay): 修正限速"))).toEqual({
      type: "fix",
      releasable: true,
      breaking: false,
    });
  });

  it("counts only the types the release policy calls an item", () => {
    for (const type of ["feat", "fix", "perf"]) {
      expect(classifyCommit(commit(`${type}: 調整`)).releasable).toBe(true);
    }
    // The policy names these as not counting toward the threshold, even
    // though some of them do appear in the changelog.
    for (const type of [
      "docs",
      "test",
      "ci",
      "chore",
      "style",
      "refactor",
      "build",
    ]) {
      expect(classifyCommit(commit(`${type}: 調整`)).releasable).toBe(false);
    }
  });

  it("sees a breaking change in either notation", () => {
    expect(classifyCommit(commit("feat(api)!: 改變協定")).breaking).toBe(true);
    expect(
      classifyCommit(
        commit("feat(api): 改變協定", "BREAKING CHANGE: 舊的檢視端連不上"),
      ).breaking,
    ).toBe(true);
  });

  it("treats an unlabelled subject as releasable", () => {
    // Guessing that an unlabelled commit is a chore would quietly keep real
    // work unreleased.
    expect(classifyCommit(commit("隨手改一下"))).toEqual({
      type: null,
      releasable: true,
      breaking: false,
    });
  });
});

describe("decideRelease", () => {
  it("publishes a breaking change immediately", () => {
    const decision = decideRelease({
      commits: [commit("feat(remote)!: 換掉協定")],
    });

    expect(decision.release).toBe(true);
    expect(decision.reason).toContain("breaking");
  });

  it("waits below the threshold", () => {
    const decision = decideRelease({
      commits: [commit("fix(ui): 對齊按鈕"), commit("feat(ui): 新增分頁")],
      minItems: 3,
    });

    expect(decision.release).toBe(false);
    expect(decision.reason).toContain("below the threshold");
  });

  it("publishes once enough independent items are waiting", () => {
    const commits = [
      commit("fix(ui): 對齊按鈕"),
      commit("feat(ui): 新增分頁"),
      commit("perf(remote): 減少重繪"),
    ];

    expect(decideRelease({ commits, minItems: 3 }).release).toBe(true);
  });

  it("does not let maintenance alone cut a version", () => {
    // A release whose changelog holds nothing a user would notice churns the
    // updater for no reason.
    const commits = [
      commit("chore: 更新相依"),
      commit("docs: 補說明"),
      commit("ci: 調整工作流程"),
      commit("style: 調整間距"),
      commit("refactor: 抽出函式"),
    ];

    const decision = decideRelease({ commits, minItems: 3 });
    expect(decision.release).toBe(false);
    expect(decision.reason).toContain("nothing releasable");
  });

  it("does not count maintenance toward the threshold", () => {
    const commits = [
      commit("fix(ui): 修正一個"),
      commit("chore: 一"),
      commit("refactor: 二"),
      commit("style: 三"),
    ];

    expect(decideRelease({ commits, minItems: 3 }).release).toBe(false);
  });

  it("publishes below the threshold when the maintainer asks", () => {
    const decision = decideRelease({
      commits: [commit("fix(remote): 修正斷線")],
      minItems: 3,
      forced: true,
    });

    expect(decision.release).toBe(true);
    expect(decision.reason).toContain("maintainer");
  });

  it("refuses even a forced release when the changelog would be empty", () => {
    const decision = decideRelease({
      commits: [commit("chore: 更新相依")],
      minItems: 3,
      forced: true,
    });

    expect(decision.release).toBe(false);
  });

  it("does not batch-release on a push, only on the daily pass", () => {
    // Three releasable commits landing on three pushes must not become
    // three releases; the threshold is meant to batch them.
    const commits = [
      commit("fix(ui): 對齊按鈕"),
      commit("feat(ui): 新增分頁"),
      commit("perf(remote): 減少重繪"),
    ];

    const onPush = decideRelease({ commits, minItems: 3, immediateOnly: true });
    expect(onPush.release).toBe(false);
    expect(onPush.reason).toContain("daily pass");
    expect(decideRelease({ commits, minItems: 3 }).release).toBe(true);
  });

  it("still ships a breaking change straight from a push", () => {
    const decision = decideRelease({
      commits: [commit("feat(remote)!: 換掉協定")],
      immediateOnly: true,
    });
    expect(decision.release).toBe(true);
  });

  it("holds when there is nothing at all", () => {
    expect(decideRelease({ commits: [] }).release).toBe(false);
  });
});

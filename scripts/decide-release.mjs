#!/usr/bin/env node
/**
 * Decides whether the pending Release PR should be published now.
 *
 * Release Please only opens the PR; something has to merge it or nothing ever
 * ships. This encodes the policy already written in
 * `docs/RELEASE_AUTOMATION.zh-TW.md` so the daily pass applies exactly the
 * rule a maintainer would: publish a breaking change at once, otherwise wait
 * until enough independent user-visible work has accumulated.
 *
 * Only `feat`, `fix` and `perf` count toward the threshold. The document is
 * explicit that `docs`, `test`, `ci`, `chore`, `style`, `refactor` and
 * `build` do not — a version whose changelog holds nothing a user would
 * notice churns the updater for no reason. It is also explicit that nothing
 * is released merely because time has passed, so this has no timer: an urgent
 * fix ships through the workflow's force input, which is the maintainer
 * decision the document already provides for.
 *
 * Run as a CLI it reads the unreleased commits from git and writes the
 * decision to GITHUB_OUTPUT; `decideRelease` is the pure rule underneath.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Types that count as an independent user-visible item.
 *
 * Narrower than what Release Please renders: `style` and `refactor` appear in
 * the changelog but must not push a release over the line on their own.
 */
export const RELEASABLE_TYPES = new Set(["feat", "fix", "perf"]);

export const DEFAULT_MIN_ITEMS = 3;

const HEADER = /^(?<type>[a-z]+)(?<scope>\([^)]*\))?(?<breaking>!)?:/;

/**
 * Reads one commit's conventional-commit header and body.
 *
 * An unparseable subject is treated as user-visible: guessing that an
 * unlabelled commit is a chore would quietly keep real work unreleased.
 */
export function classifyCommit({ subject, body = "" }) {
  const match = HEADER.exec(subject.trim());
  if (!match) return { type: null, releasable: true, breaking: false };
  const type = match.groups.type;
  return {
    type,
    releasable: RELEASABLE_TYPES.has(type),
    breaking:
      Boolean(match.groups.breaking) || /^BREAKING[ -]CHANGE:/m.test(body),
  };
}

/**
 * @param commits unreleased commits, each `{subject, body}`.
 * @param forced the maintainer asked for a release regardless of the count.
 * @param immediateOnly this is a push, not the daily pass: only a breaking
 *   change ships now, everything else waits to be batched. Without this the
 *   accumulation threshold degenerates into "release on the third push".
 */
export function decideRelease({
  commits,
  minItems = DEFAULT_MIN_ITEMS,
  forced = false,
  immediateOnly = false,
}) {
  const classified = commits.map((commit) => ({
    ...commit,
    ...classifyCommit(commit),
  }));
  const releasable = classified.filter((commit) => commit.releasable);

  if (classified.some((commit) => commit.breaking)) {
    return { release: true, reason: "a breaking change is waiting" };
  }
  if (immediateOnly) {
    return {
      release: false,
      reason: "no breaking change; the daily pass decides on accumulation",
    };
  }
  if (releasable.length === 0) {
    // Forcing a version with an empty changelog would ship nothing while
    // still prompting every installation to update.
    return { release: false, reason: "nothing releasable is waiting" };
  }
  if (forced) {
    return { release: true, reason: "the maintainer asked for a release" };
  }
  if (releasable.length >= minItems) {
    return {
      release: true,
      reason: `${releasable.length} releasable changes are waiting (threshold ${minItems})`,
    };
  }
  return {
    release: false,
    reason: `only ${releasable.length} releasable change(s) waiting, below the threshold of ${minItems}`,
  };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

/** Commits on the current branch that no release tag covers yet. */
export function unreleasedCommits() {
  let range = "HEAD";
  try {
    const tag = git("describe", "--tags", "--abbrev=0", "--match", "v*").trim();
    if (tag) range = `${tag}..HEAD`;
  } catch {
    // No tag yet: everything on the branch is unreleased.
  }
  // A record separator keeps multi-line bodies from being mistaken for the
  // start of the next commit.
  const raw = git("log", range, "--no-merges", "--format=%H%x1f%s%x1f%b%x1e");
  return raw
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [, subject, body] = entry.split("\x1f");
      return { subject, body: body ?? "" };
    });
}

function main() {
  const commits = unreleasedCommits();
  const decision = decideRelease({
    commits,
    minItems: Number(process.env.RELEASE_MIN_ITEMS ?? DEFAULT_MIN_ITEMS),
    forced: process.env.RELEASE_FORCE === "true",
    // A push to main runs this workflow too, but only the scheduled pass
    // and a maintainer's dispatch apply the accumulation rule.
    immediateOnly: process.env.RELEASE_TRIGGER === "push",
  });
  const summary = `release=${decision.release} (${decision.reason})`;
  console.log(summary);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `release=${decision.release}\nreason=${decision.reason}\n`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

import changelogSource from "../../CHANGELOG.md?raw";

export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogRelease {
  version: string;
  date: string;
  url: string;
  sections: ChangelogSection[];
}

const releasePattern = /^## \[([^\]]+)]\((https?:\/\/[^)]+)\) \(([^)]+)\)$/;

export function parseChangelog(source: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | null = null;
  let section: ChangelogSection | null = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    const releaseMatch = releasePattern.exec(line);
    if (releaseMatch) {
      release = {
        version: releaseMatch[1],
        url: releaseMatch[2],
        date: releaseMatch[3],
        sections: [],
      };
      releases.push(release);
      section = null;
      continue;
    }
    if (!release) continue;

    if (line.startsWith("### ")) {
      section = { title: line.slice(4).trim(), items: [] };
      release.sections.push(section);
      continue;
    }

    const item = /^(?:\*|-)\s+(.+)$/.exec(line)?.[1];
    if (!item) continue;
    if (!section) {
      section = { title: "更新內容", items: [] };
      release.sections.push(section);
    }
    section.items.push(item);
  }

  return releases.filter((entry) => entry.sections.some((entrySection) => entrySection.items.length));
}

export const changelogReleases = parseChangelog(changelogSource);

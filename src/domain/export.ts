/**
 * Safe connection export and import.
 *
 * Strictly non-secret: this format only contains metadata such as hostname,
 * port, protocol, environment, group and tags. Secrets belong to the OS
 * credential store and are never exported or accepted here.
 */

import {
  createConnectionProfile,
  emptyDraft,
  parseTags,
  protocolCatalog,
  validateConnectionDraft,
  type ConnectionDraft,
  type ConnectionProfile,
  type Protocol,
} from "./connection";

export const EXPORT_SCHEMA_VERSION = 1;

export interface LatticeTermExport {
  version: number;
  exportedAt: string;
  application: "LatticeTerm";
  profiles: ConnectionDraft[];
}

export interface ImportResult {
  validProfiles: ConnectionProfile[];
  errors: string[];
  skippedCount: number;
}

/**
 * Serializes connection profiles to a clean, non-secret JSON string.
 */
export function serializeProfiles(
  profiles: ConnectionProfile[],
  exportedAt: string = new Date().toISOString(),
): string {
  const exportData: LatticeTermExport = {
    version: EXPORT_SCHEMA_VERSION,
    exportedAt,
    application: "LatticeTerm",
    profiles: profiles.map((p) => ({
      name: p.name,
      protocol: p.protocol,
      hostname: p.hostname,
      username: p.username,
      port: p.port,
      environment: p.environment,
      group: p.group === "Ungrouped" ? "" : p.group,
      tags: p.tags,
      favorite: p.favorite,
    })),
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * Validates and parses an imported JSON string into connection profiles.
 * Rejects invalid JSON, unknown protocols, or malformed entries.
 */
export function parseAndValidateImport(jsonContent: string): ImportResult {
  const errors: string[] = [];
  const validProfiles: ConnectionProfile[] = [];
  let skippedCount = 0;

  let raw: unknown;
  try {
    raw = JSON.parse(jsonContent);
  } catch {
    return {
      validProfiles: [],
      errors: ["Invalid JSON format."],
      skippedCount: 0,
    };
  }

  if (typeof raw !== "object" || raw === null) {
    return {
      validProfiles: [],
      errors: ["Export data must be a JSON object."],
      skippedCount: 0,
    };
  }

  const data = raw as Partial<LatticeTermExport>;

  if (
    data.application &&
    typeof data.application === "string" &&
    data.application !== "LatticeTerm"
  ) {
    errors.push(`Warning: file originated from application '${data.application}'.`);
  }

  const rawProfiles = Array.isArray(data.profiles)
    ? data.profiles
    : Array.isArray(raw)
      ? raw
      : null;

  if (!rawProfiles) {
    return {
      validProfiles: [],
      errors: ["No profiles array found in import data."],
      skippedCount: 0,
    };
  }

  const validProtocols = new Set<string>(protocolCatalog.map((p) => p.id));

  rawProfiles.forEach((item, index) => {
    const entryIndex = index + 1;

    if (typeof item !== "object" || item === null) {
      errors.push(`Item #${entryIndex}: profile must be an object.`);
      skippedCount++;
      return;
    }

    const rec = item as Record<string, unknown>;

    const protocolStr = String(rec.protocol ?? "ssh").toLowerCase();
    if (!validProtocols.has(protocolStr)) {
      errors.push(
        `Item #${entryIndex} (${String(rec.name ?? "unnamed")}): unknown protocol '${protocolStr}'.`,
      );
      skippedCount++;
      return;
    }

    const draft: ConnectionDraft = {
      ...emptyDraft(protocolStr as Protocol),
      name: String(rec.name ?? "").trim(),
      protocol: protocolStr as Protocol,
      hostname: String(rec.hostname ?? "").trim(),
      username: String(rec.username ?? "").trim(),
      port: typeof rec.port === "number" ? rec.port : Number(rec.port ?? 22),
      environment:
        rec.environment === "production" ||
        rec.environment === "staging" ||
        rec.environment === "development"
          ? rec.environment
          : "unassigned",
      group: typeof rec.group === "string" ? rec.group.trim() : "",
      tags: parseTags(
        Array.isArray(rec.tags)
          ? (rec.tags as string[])
          : typeof rec.tags === "string"
            ? rec.tags
            : [],
      ),
      favorite: Boolean(rec.favorite),
    };

    const validationErrors = validateConnectionDraft(draft);
    if (Object.keys(validationErrors).length > 0) {
      const errMsgs = Object.entries(validationErrors)
        .map(([field, msg]) => `${field}: ${msg}`)
        .join("; ");
      errors.push(
        `Item #${entryIndex} (${draft.name || "unnamed"}): ${errMsgs}`,
      );
      skippedCount++;
      return;
    }

    validProfiles.push(createConnectionProfile(draft));
  });

  return {
    validProfiles,
    errors,
    skippedCount,
  };
}

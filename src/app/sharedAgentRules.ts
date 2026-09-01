export type SharedAgentRulesFileState =
  | "missing"
  | "synced"
  | "needsSync"
  | "manualReview";

export interface SharedAgentRulesFile {
  cli: string;
  fileName: string;
  path: string;
  state: SharedAgentRulesFileState;
}

export interface SharedAgentRulesSnapshot {
  projectDirectory: string;
  content: string;
  revision: string;
  files: SharedAgentRulesFile[];
}

export const MAX_SHARED_AGENT_RULES_BYTES = 32 * 1024;

export const SHARED_AGENT_RULES_TEMPLATE_ZH_TW = `# 專案 AI 協作規則

## 語言與溝通

- 使用台灣繁體中文回覆與撰寫文件；程式碼識別字維持專案既有慣例。
- 說明變更原因、驗證結果，以及尚未驗證的邊界。

## 安全與範圍

- 修改前先閱讀相關程式碼、測試、設定與文件，並保留無關變更。
- 不得提交密碼、API Token、私有主機、客戶資料或本機帳號設定。
- 未經明確要求，不執行發布、部署、刪除資料、Git push 或建立 PR。

## 開發與驗證

- 遵循專案既有架構與格式；針對行為變更補上測試並執行相關檢查。
- Commit message 使用 <type>(<scope>): <subject>，主旨簡潔並描述實際變更。
`;

async function core() {
  return import("@tauri-apps/api/core");
}

export async function inspectSharedAgentRules(
  projectDirectory: string,
): Promise<SharedAgentRulesSnapshot> {
  const { invoke } = await core();
  return invoke<SharedAgentRulesSnapshot>("agent_shared_rules_inspect", {
    projectDirectory,
  });
}

export async function saveSharedAgentRules(
  projectDirectory: string,
  content: string,
  expectedRevision: string,
): Promise<SharedAgentRulesSnapshot> {
  const { invoke } = await core();
  return invoke<SharedAgentRulesSnapshot>("agent_shared_rules_save", {
    projectDirectory,
    content,
    expectedRevision,
  });
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function normalizedSharedRulesByteLength(value: string): number {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  return normalized ? utf8ByteLength(`${normalized}\n`) : 0;
}

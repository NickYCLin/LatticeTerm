import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  SftpApi,
  SftpDirectory,
  SftpEntry,
  SftpSessionSummary,
} from "../../app/useSftpSessions";
import { SFTP_MAX_TRANSFER_BYTES } from "../../app/useSftpSessions";
import { useI18n } from "../../i18n";
import { Callout } from "../common/Callout";
import {
  EditIcon,
  ExportIcon,
  FolderIcon,
  ImportIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
} from "../icons";

function parentPath(path: string): string {
  if (path === "/") return "/";
  const normalized = path.replace(/\/+$/, "");
  const boundary = normalized.lastIndexOf("/");
  return boundary <= 0 ? "/" : normalized.slice(0, boundary);
}

function downloadBytes(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function SftpPane({
  session,
  sftp,
}: {
  session: SftpSessionSummary;
  sftp: SftpApi;
}) {
  const { t, tag } = useI18n();
  const [directory, setDirectory] = useState<SftpDirectory | null>(null);
  const [pathInput, setPathInput] = useState(session.currentPath);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const list = sftp.list;

  async function open(path: string) {
    setLoading(true);
    setProblem(null);
    try {
      const next = await list(session.sessionId, path);
      setDirectory(next);
      setPathInput(next.path);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void open(session.currentPath);
  }, [list, session.currentPath, session.sessionId]);

  async function mutate(operation: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await operation();
      await open(directory?.path ?? session.currentPath);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  function submitPath(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void open(pathInput);
  }

  function createFolder() {
    const name = window.prompt(t("sftp.createPrompt"));
    if (!name?.trim() || !directory) return;
    void mutate(() =>
      sftp.createDirectory(session.sessionId, directory.path, name.trim()),
    );
  }

  function rename(entry: SftpEntry) {
    const name = window.prompt(t("sftp.renamePrompt"), entry.name);
    if (!name?.trim() || name.trim() === entry.name) return;
    void mutate(() =>
      sftp.rename(session.sessionId, entry.path, name.trim()),
    );
  }

  function remove(entry: SftpEntry) {
    if (!window.confirm(t("sftp.deleteConfirm", { name: entry.name }))) return;
    void mutate(() =>
      sftp.remove(
        session.sessionId,
        entry.path,
        entry.kind === "directory",
      ),
    );
  }

  async function download(entry: SftpEntry) {
    setBusy(true);
    setProblem(null);
    try {
      downloadBytes(await sftp.readFile(session.sessionId, entry.path), entry.name);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file || !directory) return;
    if (file.size > SFTP_MAX_TRANSFER_BYTES) {
      setProblem(
        t("sftp.tooLarge", {
          limit: SFTP_MAX_TRANSFER_BYTES / 1024 / 1024,
        }),
      );
      if (uploadRef.current) uploadRef.current.value = "";
      return;
    }
    const existing = directory.entries.find((entry) => entry.name === file.name);
    if (existing?.kind === "directory") {
      setProblem(t("sftp.overwriteDirectory", { name: file.name }));
      if (uploadRef.current) uploadRef.current.value = "";
      return;
    }
    if (
      existing &&
      !window.confirm(t("sftp.overwriteConfirm", { name: file.name }))
    ) {
      if (uploadRef.current) uploadRef.current.value = "";
      return;
    }
    await mutate(() =>
      sftp.writeFile(
        session.sessionId,
        directory.path,
        file,
        Boolean(existing),
      ),
    );
    if (uploadRef.current) uploadRef.current.value = "";
  }

  function size(entry: SftpEntry): string {
    if (entry.kind === "directory") return "—";
    return new Intl.NumberFormat(tag, {
      style: "unit",
      unit: entry.size >= 1024 * 1024 ? "megabyte" : "kilobyte",
      unitDisplay: "short",
      maximumFractionDigits: 1,
    }).format(
      entry.size >= 1024 * 1024
        ? entry.size / 1024 / 1024
        : Math.max(entry.size / 1024, 0.1),
    );
  }

  function modified(entry: SftpEntry): string {
    if (entry.modifiedAt === null) return "—";
    return new Intl.DateTimeFormat(tag, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(entry.modifiedAt * 1000));
  }

  return (
    <section className="sftp-pane" aria-label={t("sftp.title")}>
      <header className="sftp-toolbar">
        <form className="sftp-path" onSubmit={submitPath}>
          <label className="sr-only" htmlFor={`sftp-path-${session.sessionId}`}>
            {t("sftp.path")}
          </label>
          <input
            id={`sftp-path-${session.sessionId}`}
            className="input mono"
            value={pathInput}
            onChange={(event) => setPathInput(event.currentTarget.value)}
            spellCheck={false}
            disabled={loading || busy}
          />
          <button
            type="submit"
            className="button button--secondary button--sm"
            disabled={loading || busy || !pathInput.trim()}
          >
            {t("sftp.go")}
          </button>
        </form>
        <div className="sftp-actions">
          <button
            type="button"
            className="button button--ghost button--sm"
            disabled={loading || busy || directory?.path === "/"}
            onClick={() => directory && void open(parentPath(directory.path))}
          >
            <FolderIcon size={13} />
            {t("sftp.up")}
          </button>
          <button
            type="button"
            className="button button--ghost button--sm"
            disabled={loading || busy || !directory}
            onClick={() => directory && void open(directory.path)}
          >
            <RefreshIcon size={13} />
            {t("sftp.refresh")}
          </button>
          <button
            type="button"
            className="button button--ghost button--sm"
            disabled={loading || busy || !directory}
            onClick={createFolder}
          >
            <PlusIcon size={13} />
            {t("sftp.newFolder")}
          </button>
          <button
            type="button"
            className="button button--primary button--sm"
            disabled={loading || busy || !directory}
            onClick={() => uploadRef.current?.click()}
          >
            <ImportIcon size={13} />
            {t("sftp.upload")}
          </button>
          <input
            ref={uploadRef}
            className="sr-only"
            type="file"
            aria-label={t("sftp.upload")}
            onChange={(event) => void upload(event.currentTarget.files?.[0])}
          />
        </div>
      </header>

      <div className="sftp-limit">{t("sftp.limit")}</div>

      {problem && (
        <div className="sftp-problem">
          <Callout tone="warn" title={t("sftp.problem")}>
            {problem}
          </Callout>
        </div>
      )}

      <div className="sftp-table-wrap">
        {loading ? (
          <div className="sftp-state">{t("sftp.loading")}</div>
        ) : directory && directory.entries.length === 0 ? (
          <div className="sftp-state">{t("sftp.empty")}</div>
        ) : (
          <table className="sftp-table">
            <thead>
              <tr>
                <th>{t("sftp.column.name")}</th>
                <th>{t("sftp.column.size")}</th>
                <th>{t("sftp.column.modified")}</th>
                <th>{t("sftp.column.permissions")}</th>
                <th className="sftp-table__actions">{t("sftp.column.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {directory?.entries.map((entry) => (
                <tr key={entry.path}>
                  <td>
                    <button
                      type="button"
                      className="sftp-entry"
                      disabled={busy}
                      onClick={() =>
                        entry.kind === "directory"
                          ? void open(entry.path)
                          : void download(entry)
                      }
                    >
                      {entry.kind === "directory" ? (
                        <FolderIcon size={15} />
                      ) : (
                        <ExportIcon size={15} />
                      )}
                      <span>{entry.name}</span>
                    </button>
                  </td>
                  <td className="mono">{size(entry)}</td>
                  <td>{modified(entry)}</td>
                  <td className="mono">{entry.permissions}</td>
                  <td>
                    <div className="sftp-row-actions">
                      {entry.kind !== "directory" && (
                        <button
                          type="button"
                          className="icon-button icon-button--sm"
                          disabled={busy}
                          onClick={() => void download(entry)}
                          aria-label={t("sftp.download")}
                          data-tooltip={t("sftp.download")}
                        >
                          <ExportIcon size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-button icon-button--sm"
                        disabled={busy}
                        onClick={() => rename(entry)}
                        aria-label={t("sftp.rename")}
                        data-tooltip={t("sftp.rename")}
                      >
                        <EditIcon size={12} />
                      </button>
                      <button
                        type="button"
                        className="icon-button icon-button--sm"
                        disabled={busy}
                        onClick={() => remove(entry)}
                        aria-label={t("sftp.delete")}
                        data-tooltip={t("sftp.delete")}
                      >
                        <TrashIcon size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

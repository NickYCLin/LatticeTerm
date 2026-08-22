import { describe, expect, it } from "vitest";
import {
  decodeSftpPayload,
  dismissSftpTransfer,
  encodeSftpPayload,
  reconcileSftpTransferSnapshot,
  SFTP_MAX_TRANSFER_BYTES,
  streamSftpUpload,
  type SftpTransfer,
} from "./useSftpSessions";

function transfer(
  transferId: string,
  state: SftpTransfer["state"],
  bytesDone: number,
): SftpTransfer {
  return {
    transferId,
    sessionId: "session-1",
    kind: "download",
    name: `${transferId}.bin`,
    remotePath: `/${transferId}.bin`,
    localPath: null,
    bytesDone,
    totalBytes: 100,
    state,
    detail: null,
  };
}

describe("SFTP IPC payloads", () => {
  it("round-trips arbitrary bytes without text decoding", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
    expect(decodeSftpPayload(encodeSftpPayload(bytes))).toEqual(bytes);
  });

  it("keeps the documented transfer boundary at 32 MiB", () => {
    expect(SFTP_MAX_TRANSFER_BYTES).toBe(32 * 1024 * 1024);
  });

  it("cancels the backend transfer when a chunk cannot be delivered", async () => {
    const commands: string[] = [];
    const invoke = async (command: string) => {
      commands.push(command);
      if (command === "sftp_upload_chunk") {
        throw new Error("transport stopped");
      }
    };

    await expect(
      streamSftpUpload(
        new Blob([new Uint8Array([1, 2, 3])]),
        "transfer-7",
        invoke,
      ),
    ).rejects.toThrow("transport stopped");
    expect(commands).toEqual([
      "sftp_upload_chunk",
      "sftp_transfer_cancel",
    ]);
  });

  it("treats an acknowledged user cancellation as a clean stop", async () => {
    const commands: string[] = [];
    const invoke = async (command: string) => {
      commands.push(command);
      if (command === "sftp_upload_chunk") {
        throw new Error("cancelled");
      }
    };

    await expect(
      streamSftpUpload(
        new Blob([new Uint8Array([4, 5, 6])]),
        "transfer-8",
        invoke,
      ),
    ).resolves.toBeUndefined();
    expect(commands).toEqual([
      "sftp_upload_chunk",
      "sftp_transfer_cancel",
    ]);
  });
});

describe("SFTP transfer state reconciliation", () => {
  it("keeps newer event progress and restores snapshot-only transfers", () => {
    const result = reconcileSftpTransferSnapshot(
      { shared: transfer("shared", "running", 80) },
      [
        transfer("snapshot", "running", 10),
        transfer("shared", "running", 20),
      ],
    );

    expect(result).toEqual({
      snapshot: transfer("snapshot", "running", 10),
      shared: transfer("shared", "running", 80),
    });
  });

  it("does not restore a transfer dismissed while hydration was running", () => {
    const result = reconcileSftpTransferSnapshot(
      { dismissed: transfer("dismissed", "done", 100) },
      [transfer("dismissed", "done", 100)],
      new Set(["dismissed"]),
    );

    expect(result).toEqual({});
  });

  it("keeps the row when the backend refuses to dismiss it", async () => {
    const removed: string[] = [];
    await expect(
      dismissSftpTransfer(
        "running",
        async () => {
          throw new Error("the transfer is still running");
        },
        (transferId) => removed.push(transferId),
      ),
    ).rejects.toThrow("still running");
    expect(removed).toEqual([]);
  });

  it("removes the row after the backend acknowledges dismissal", async () => {
    const commands: string[] = [];
    const removed: string[] = [];
    await dismissSftpTransfer(
      "done",
      async (command) => {
        commands.push(command);
      },
      (transferId) => removed.push(transferId),
    );

    expect(commands).toEqual(["sftp_transfer_dismiss"]);
    expect(removed).toEqual(["done"]);
  });
});

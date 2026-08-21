import { describe, expect, it } from "vitest";
import {
  decodeSftpPayload,
  encodeSftpPayload,
  SFTP_MAX_TRANSFER_BYTES,
  streamSftpUpload,
} from "./useSftpSessions";

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

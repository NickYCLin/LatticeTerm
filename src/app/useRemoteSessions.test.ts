import { describe, expect, it } from "vitest";
import {
  reconcileRemoteFileTransfer,
  streamRemoteFileUpload,
  type RemoteFileTransfer,
} from "./useRemoteSessions";

function transfer(
  state: RemoteFileTransfer["state"],
  bytesDone: number,
): RemoteFileTransfer {
  return {
    transferId: "remote-file-1",
    sessionId: "remote-1",
    kind: "upload",
    name: "data.bin",
    remotePath: "/data.bin",
    localPath: null,
    bytesDone,
    totalBytes: 100,
    state,
    detail: null,
  };
}

describe("Lattice Remote file uploads", () => {
  it("splits browser streams at the encrypted protocol boundary", async () => {
    const commands: Array<{ command: string; data?: string }> = [];
    const bytes = new Uint8Array(48 * 1024 + 7).fill(0x5a);
    await streamRemoteFileUpload(
      new Blob([bytes]),
      "remote-1",
      "remote-file-1",
      async (command, args) => {
        commands.push({ command, data: args?.data as string | undefined });
      },
    );

    expect(commands.map(({ command }) => command)).toEqual([
      "remote_file_upload_chunk",
      "remote_file_upload_chunk",
      "remote_file_upload_finish",
    ]);
    expect(atob(commands[0].data!).length).toBe(48 * 1024);
    expect(atob(commands[1].data!).length).toBe(7);
  });

  it("cancels the remote staging file when streaming fails", async () => {
    const commands: string[] = [];
    await expect(
      streamRemoteFileUpload(
        new Blob([new Uint8Array([1, 2, 3])]),
        "remote-1",
        "remote-file-2",
        async (command) => {
          commands.push(command);
          if (command === "remote_file_upload_chunk") {
            throw new Error("connection closed");
          }
        },
      ),
    ).rejects.toThrow("connection closed");
    expect(commands).toEqual([
      "remote_file_upload_chunk",
      "remote_file_transfer_cancel",
    ]);
  });
});

describe("Lattice Remote transfer event reconciliation", () => {
  it("keeps completed state over a late initial response", () => {
    const completed = transfer("done", 100);
    expect(reconcileRemoteFileTransfer(completed, transfer("running", 0))).toBe(
      completed,
    );
  });

  it("keeps the furthest running byte count", () => {
    const newer = transfer("running", 80);
    expect(reconcileRemoteFileTransfer(newer, transfer("running", 20))).toBe(
      newer,
    );
  });
});

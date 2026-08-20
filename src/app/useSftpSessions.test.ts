import { describe, expect, it } from "vitest";
import {
  decodeSftpPayload,
  encodeSftpPayload,
  SFTP_MAX_TRANSFER_BYTES,
} from "./useSftpSessions";

describe("SFTP IPC payloads", () => {
  it("round-trips arbitrary bytes without text decoding", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
    expect(decodeSftpPayload(encodeSftpPayload(bytes))).toEqual(bytes);
  });

  it("keeps the documented transfer boundary at 32 MiB", () => {
    expect(SFTP_MAX_TRANSFER_BYTES).toBe(32 * 1024 * 1024);
  });
});

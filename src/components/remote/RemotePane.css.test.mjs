import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const remoteStyles = readFileSync(
  new URL("../../styles/remote.css", import.meta.url),
  "utf8",
);

describe("Lattice Remote canvas styles", () => {
  it("keeps the mouse and touch interaction contract", () => {
    expect(remoteStyles).toMatch(
      /\.remote-frame-canvas--interactive\s*\{[^}]*pointer-events:\s*auto;[^}]*touch-action:\s*none;/s,
    );
    expect(remoteStyles).toMatch(
      /\.remote-frame-canvas--view-only\s*\{[^}]*pointer-events:\s*none;/s,
    );
  });

  it("gives the mobile file browser the full workspace", () => {
    expect(remoteStyles).toMatch(
      /@media \(max-width: 48rem\)[\s\S]*?\.remote-workspace--files\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(remoteStyles).toMatch(
      /\.remote-workspace--files > \.remote-canvas,[\s\S]*?\.remote-workspace--files > \.remote-terminal\s*\{[^}]*display:\s*none;/,
    );
    expect(remoteStyles).toMatch(
      /@media \(max-width: 48rem\)[\s\S]*?\.remote-files-actions\s*\{[^}]*flex-wrap:\s*wrap;/,
    );
  });

  it("exposes a software-keyboard toggle only on touch/mobile layouts", () => {
    expect(remoteStyles).toMatch(
      /\.canvas-soft-keyboard__toggle\s*\{[^}]*display:\s*none;/,
    );
    expect(remoteStyles).toMatch(
      /\.app--mobile \.canvas-soft-keyboard__toggle\s*\{[^}]*display:\s*inline-flex;/,
    );
  });
});

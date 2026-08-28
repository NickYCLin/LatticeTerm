import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FileEntryIcon } from "./FileEntryIcon";

describe("file entry icon", () => {
  it("uses a translucent folder presentation for hidden directories", () => {
    const markup = renderToStaticMarkup(
      <FileEntryIcon name=".config" kind="directory" size={15} />,
    );
    expect(markup).toContain("file-entry-icon--folder is-hidden");
  });

  it("uses built-in file type icons instead of transfer action icons", () => {
    expect(
      renderToStaticMarkup(
        <FileEntryIcon name="index.html" kind="file" size={15} />,
      ),
    ).toContain("file-entry-icon--code");
    expect(
      renderToStaticMarkup(
        <FileEntryIcon name="cover.png" kind="file" size={15} />,
      ),
    ).toContain("file-entry-icon--image");
  });
});

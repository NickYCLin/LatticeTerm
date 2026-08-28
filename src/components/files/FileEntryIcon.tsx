import {
  ArchiveFileIcon,
  CodeFileIcon,
  DatabaseIcon,
  DocumentFileIcon,
  FileIcon,
  FolderIcon,
  ImageFileIcon,
  LinkFileIcon,
  TerminalIcon,
  type IconProps,
} from "../icons";
import {
  fileEntryIconKind,
  isHiddenEntryName,
  type FileEntryKind,
} from "../../app/fileEntryPresentation";

const icons = {
  folder: FolderIcon,
  code: CodeFileIcon,
  image: ImageFileIcon,
  archive: ArchiveFileIcon,
  document: DocumentFileIcon,
  database: DatabaseIcon,
  terminal: TerminalIcon,
  link: LinkFileIcon,
  file: FileIcon,
};

export function FileEntryIcon({
  name,
  kind,
  ...props
}: IconProps & { name: string; kind: FileEntryKind }) {
  const iconKind = fileEntryIconKind(name, kind);
  const Glyph = icons[iconKind];
  return (
    <span
      className={`file-entry-icon file-entry-icon--${iconKind}${
        isHiddenEntryName(name) ? " is-hidden" : ""
      }`}
      aria-hidden="true"
    >
      <Glyph {...props} />
    </span>
  );
}

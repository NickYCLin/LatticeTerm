"""Check that reused simulator artifacts cannot bypass source/integrity checks."""
import copy
import hashlib
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("reuse", Path(__file__).with_name("reuse-ios-simulator.py"))
reuse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reuse)


class ReuseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.run = {"repository": {"full_name": "owner/repo"}, "head_branch": "main",
                    "event": "push", "path": ".github/workflows/ios-verify.yml",
                    "head_sha": "a" * 40, "id": 42, "run_attempt": 1}

    def archive(self, entries):
        path = self.root / "ios-simulator.tar.gz"
        with tarfile.open(path, "w:gz") as archive:
            for name, content, kind in entries:
                member = tarfile.TarInfo(name)
                member.type = kind
                member.mode = 0o755
                if kind == tarfile.REGTYPE:
                    member.size = len(content)
                    archive.addfile(member, io.BytesIO(content))
                else:
                    member.linkname = "../../outside"
                    archive.addfile(member)
        return path

    def test_only_the_expected_main_branch_workflow_is_accepted(self):
        reuse.verify_source(self.run, "owner/repo")
        for key, value in (("repository", {"full_name": "fork/repo"}),
                           ("head_branch", "other"), ("event", "pull_request"),
                           ("path", ".github/workflows/other.yml"), ("head_sha", "not-a-sha")):
            run = copy.deepcopy(self.run)
            run[key] = value
            with self.assertRaises(ValueError):
                reuse.verify_source(run, "owner/repo")

    def test_matching_version_does_not_allow_changed_app_inputs(self):
        reuse.verify_changed_paths(["docs/IOS_RELEASE.zh-TW.md", "scripts/ios-simulator-smoke.py"])
        for path in ("src/App.tsx", "package-lock.json", "src-tauri/src/lib.rs",
                     "scripts/build-ios.mjs", ".github/workflows/ios-verify.yml"):
            with self.assertRaises(ValueError):
                reuse.verify_changed_paths([path])

    def test_archive_hash_run_attempt_and_architecture_must_match(self):
        archive = self.archive([("LatticeTerm.app/Info.plist", b"fixture", tarfile.REGTYPE)])
        provenance = {"commit": self.run["head_sha"], "runId": "42", "runAttempt": "1",
                      "simulatorArchitecture": "arm64",
                      "sha256": {archive.name: hashlib.sha256(archive.read_bytes()).hexdigest()}}
        metadata = self.root / "provenance.json"
        metadata.write_text(json.dumps(provenance))
        reuse.verify_archive(self.root, self.run, "arm64")
        for key, value in (("commit", "b" * 40), ("runId", "99"), ("runAttempt", "2"),
                           ("simulatorArchitecture", "x86_64"), ("sha256", {archive.name: "0" * 64})):
            changed = copy.deepcopy(provenance)
            changed[key] = value
            metadata.write_text(json.dumps(changed))
            with self.assertRaises(ValueError):
                reuse.verify_archive(self.root, self.run, "arm64")

    def test_regular_app_files_preserve_executability(self):
        archive = self.archive([("LatticeTerm.app/Info.plist", b"fixture", tarfile.REGTYPE),
                                ("LatticeTerm.app/LatticeTerm", b"executable fixture", tarfile.REGTYPE)])
        app = reuse.extract_app(archive, self.root / "output")
        self.assertEqual((app / "LatticeTerm").read_bytes(), b"executable fixture")
        self.assertEqual((app / "LatticeTerm").stat().st_mode & 0o777, 0o755)

    def test_traversal_links_and_special_files_never_escape(self):
        entries = [("LatticeTerm.app/../../outside", b"bad", tarfile.REGTYPE),
                   ("/outside", b"bad", tarfile.REGTYPE),
                   ("LatticeTerm.app/evil", b"", tarfile.SYMTYPE),
                   ("LatticeTerm.app/evil", b"", tarfile.LNKTYPE),
                   ("LatticeTerm.app/evil", b"", tarfile.FIFOTYPE)]
        for index, entry in enumerate(entries):
            with self.subTest(entry=entry[0]):
                with self.assertRaises(ValueError):
                    reuse.extract_app(self.archive([entry]), self.root / f"output-{index}")
                self.assertFalse((self.root / "outside").exists())

    def test_duplicate_files_and_existing_destinations_are_rejected(self):
        entry = ("LatticeTerm.app/Info.plist", b"fixture", tarfile.REGTYPE)
        archive = self.archive([entry, entry])
        with self.assertRaises(ValueError):
            reuse.extract_app(archive, self.root / "duplicates")
        existing = self.root / "existing"
        existing.mkdir()
        (existing / "keep.txt").write_text("original")
        with self.assertRaises(FileExistsError):
            reuse.extract_app(archive, existing)
        self.assertEqual((existing / "keep.txt").read_text(), "original")


if __name__ == "__main__":
    unittest.main()

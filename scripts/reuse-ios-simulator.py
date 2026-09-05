"""Verify and unpack a main-branch simulator artifact for an independent CI run."""
import argparse
import hashlib
import json
import os
import platform
import re
import subprocess
import tarfile
from pathlib import Path, PurePosixPath


def command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=180).stdout


def verify_source(run, repository):
    if (run.get("repository", {}).get("full_name") != repository or
            run.get("head_branch") != "main" or
            run.get("event") not in ("push", "workflow_dispatch") or
            run.get("path") != ".github/workflows/ios-verify.yml" or
            not re.fullmatch(r"[0-9a-f]{40}", run.get("head_sha", ""))):
        raise ValueError("只能重用同一 repo 主分支 iOS verification 工作的產物")


def verify_changed_paths(paths):
    # These files cannot affect the packaged app. All other differences,
    # including build scripts, lockfiles and the original build workflow,
    # require a fresh build. Never infer equivalence from matching versions.
    allowed = {
        ".github/workflows/ios-smoke-existing.yml",
        "scripts/reuse-ios-simulator.py", "scripts/test_reuse_ios_simulator.py",
        "scripts/ios-simulator-smoke.py", "scripts/test_ios_simulator_smoke.py",
        "scripts/ios-screen-text.swift",
    }
    if any(path and not path.startswith("docs/") and path not in allowed for path in paths):
        raise ValueError("App 建置輸入已變更，必須重新封裝")


def verify_archive(package, run, architecture):
    provenance = json.loads((package / "provenance.json").read_text())
    if (provenance.get("commit") != run["head_sha"] or
            str(provenance.get("runId")) != str(run["id"]) or
            str(provenance.get("runAttempt")) != str(run["run_attempt"]) or
            provenance.get("simulatorArchitecture") != architecture):
        raise ValueError("封裝來源、執行次數或模擬器架構不符")
    archive = package / "ios-simulator.tar.gz"
    digest = hashlib.sha256()
    with archive.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != provenance.get("sha256", {}).get(archive.name):
        raise ValueError("模擬器封裝 SHA-256 不符")
    return archive, provenance


def extract_app(archive, destination):
    # A fresh output directory and regular files/directories only prevent
    # traversal, link redirection and accidental overwrite of prior data.
    destination.mkdir(exist_ok=False)
    seen = set()
    total = 0
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or ".." in path.parts or not path.parts or
                    path.parts[0] != "LatticeTerm.app" or
                    "\\" in member.name or ":" in member.name or
                    not (member.isfile() or member.isdir()) or
                    member.name in seen):
                raise ValueError("封裝包含不安全或重複的路徑")
            seen.add(member.name)
            total += member.size
            if len(seen) > 20000 or member.size < 0 or total > 512 * 1024 * 1024:
                raise ValueError("模擬器封裝超過解壓縮限制")
            target = destination.joinpath(*path.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as output, source.extractfile(member) as data:
                    while chunk := data.read(1024 * 1024):
                        output.write(chunk)
                # Keep executability, never archive ownership or special bits.
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
    app = destination / "LatticeTerm.app"
    if not (app / "Info.plist").is_file():
        raise ValueError("封裝缺少 Simulator App")
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if os.environ.get("CI") != "true" or not re.fullmatch(r"[0-9]+", args.run_id):
        parser.error("僅供 CI 使用，需提供數字工作編號")
    repository = os.environ["GITHUB_REPOSITORY"]
    run = json.loads(command("gh", "api", f"repos/{repository}/actions/runs/{args.run_id}"))
    verify_source(run, repository)
    command("git", "merge-base", "--is-ancestor", run["head_sha"], "HEAD")
    changes = command("git", "diff", "--name-only", "--no-renames", run["head_sha"], "HEAD", "--")
    verify_changed_paths(changes.splitlines())
    args.output.mkdir(exist_ok=False)
    package = args.output / "package"
    command("gh", "run", "download", args.run_id, "--repo", repository,
            "--name", f"ios-unsigned-release-{run['head_sha']}", "--dir", str(package))
    archive, provenance = verify_archive(package, run, platform.machine())
    app = extract_app(archive, args.output / "extracted")
    report = {"source": provenance, "verificationCommit": os.environ["GITHUB_SHA"],
              "changedPaths": changes.splitlines(), "app": str(app),
              "note": "來源與雜湊檢查通過；仍須完成 bundle、啟動及畫面驗證"}
    (args.output / "reuse-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()

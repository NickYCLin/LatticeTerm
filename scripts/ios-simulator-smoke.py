"""Boot the Release app on disposable iPhone and iPad simulators in CI."""
import argparse
import json
import os
import re
import subprocess
import time
from pathlib import Path

BUNDLE_ID = "io.github.nickyclin.latticeterm"


def simctl(*args, timeout=60):
    return subprocess.run(
        ["xcrun", "simctl", *map(str, args)],
        check=True, capture_output=True, text=True, timeout=timeout,
    ).stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if os.environ.get("CI") != "true":
        parser.error("此測試只在 CI 執行，不操作個人模擬器")
    if not (args.app / "Info.plist").is_file():
        parser.error("找不到已建置的 Simulator App")
    args.output.mkdir(parents=True, exist_ok=True)
    inventory = json.loads(simctl("list", "devices", "available", "--json"))["devices"]
    runtimes = []
    for name, devices in inventory.items():
        match = re.fullmatch(r"com\.apple\.CoreSimulator\.SimRuntime\.iOS-(\d+)-(\d+)(?:-(\d+))?", name)
        if match and int(match[1]) >= 26 and devices:
            runtimes.append((tuple(int(part or 0) for part in match.groups()), name, devices))
    if not runtimes:
        raise RuntimeError("CI 未安裝可用的 iOS 26 以上模擬器 runtime")
    _, runtime, devices = max(runtimes, key=lambda item: item[0])
    report = []
    for family in ("iPhone", "iPad"):
        model = next((device for device in devices if device["name"].startswith(family) and device.get("deviceTypeIdentifier")), None)
        if model is None:
            raise RuntimeError(f"Runtime {runtime} 缺少 {family} 機型")
        # Create clean devices so no existing profiles, secrets or simulator
        # data are read, modified or included in the screenshots.
        device_id = simctl("create", f"LatticeTerm CI {family}", model["deviceTypeIdentifier"], runtime)
        try:
            simctl("boot", device_id)
            simctl("bootstatus", device_id, "-b", timeout=180)
            simctl("install", device_id, args.app.resolve(), timeout=120)
            output = simctl("launch", device_id, BUNDLE_ID)
            match = re.search(r": (\d+)\s*$", output)
            if match is None:
                raise RuntimeError(f"無法讀取 App PID：{output}")
            pid = int(match[1])
            time.sleep(8)
            # Simulator app PIDs are host PIDs. A successful launch command
            # alone does not prove the app survived startup.
            os.kill(pid, 0)
            screenshot = args.output / f"{family}.png"
            simctl("io", device_id, "screenshot", screenshot.resolve())
            report.append({"family": family, "model": model["name"], "runtime": runtime, "survivedStartup": True, "screenshot": screenshot.name})
            (args.output / "launch-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
            print(f"{family}: 啟動後仍在執行，已保存 {screenshot}", flush=True)
        finally:
            # Cleanup is limited to this invocation's newly created device.
            try:
                simctl("shutdown", device_id)
            finally:
                simctl("delete", device_id)


if __name__ == "__main__":
    main()

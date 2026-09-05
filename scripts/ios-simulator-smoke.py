"""Boot the Release app on disposable iPhone and iPad simulators in CI."""
import argparse
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

BUNDLE_ID = "io.github.nickyclin.latticeterm"


def store_model(devices, family):
    # Keep the ordinary phone check as well: a Pro Max capture does not replace
    # coverage of the narrower initial device. Apple accepts these native sizes.
    names = (
        ("iPhone 17 Pro Max", "iPhone 16 Pro Max", "iPhone 15 Pro Max", "iPhone 14 Pro Max")
        if family == "iPhone" else
        ("iPad Pro 13-inch (M5)", "iPad Pro 13-inch (M4)", "iPad Pro (12.9-inch) (6th generation)")
    )
    for name in names:
        match = next((device for device in devices if device["name"] == name and device.get("deviceTypeIdentifier")), None)
        if match:
            return match
    raise RuntimeError(f"Runtime 缺少符合 App Store 截圖尺寸的 {family} 機型")


def store_image_metadata(output, family):
    fields = dict(re.findall(r"^\s+(pixelWidth|pixelHeight|hasAlpha|format):\s*(\S+)\s*$", output, re.MULTILINE))
    try:
        size = (int(fields["pixelWidth"]), int(fields["pixelHeight"]))
    except (KeyError, ValueError) as error:
        raise RuntimeError("無法確認 App Store 截圖尺寸") from error
    accepted = (
        {(1260, 2736), (1290, 2796), (1320, 2868)} if family == "iPhone" else
        {(2064, 2752), (2048, 2732)}
    )
    if size not in accepted or fields.get("format") != "jpeg" or fields.get("hasAlpha") != "no":
        raise RuntimeError(f"App Store 截圖必須是符合 {family} 尺寸、不含 Alpha 的原始 JPEG：{fields}")
    return {"width": size[0], "height": size[1], "format": "jpeg", "hasAlpha": False}


def capture_store_image(device_id, family, output):
    directory = output / "app-store"
    directory.mkdir(exist_ok=True)
    screenshot = directory / ("iPhone-6.9.jpg" if family == "iPhone" else "iPad-13.jpg")
    # Capture JPEG directly from the simulator. No resize, UI reconstruction or
    # image conversion: ordinary simctl PNG captures have an alpha channel.
    simctl("io", device_id, "screenshot", "--type=jpeg", screenshot.resolve())
    metadata = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha", "-g", "format", str(screenshot.resolve())],
        check=True, capture_output=True, text=True, timeout=20,
        env={**os.environ, "LC_ALL": "C"},
    ).stdout
    return {"screenshot": str(screenshot.relative_to(output)), **store_image_metadata(metadata, family)}


def frontend_is_visible(texts):
    # A live process, status bar or loading spinner is not a usable WebView.
    # Match both independent pieces of the fresh connection page, in either
    # supported language. Ignore OCR whitespace, not missing UI content.
    normalized = ["".join(text.split()).casefold() for text in texts]
    empty_page = ("還沒有任何連線", "noconnectionsyet")
    add_action = ("新增連線", "addconnection")
    return all(
        any(label in text for label in labels for text in normalized)
        for labels in (empty_page, add_action)
    )


def wait_for_frontend(device_id, pid, screenshot, reader, timeout=90):
    started = time.monotonic()
    deadline = started + timeout
    texts = []
    while time.monotonic() < deadline:
        os.kill(pid, 0)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        simctl("io", device_id, "screenshot", screenshot.resolve(), timeout=min(20, remaining))
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        result = subprocess.run(
            [str(reader), str(screenshot.resolve())],
            check=True, capture_output=True, text=True, timeout=min(45, remaining),
        )
        texts = json.loads(result.stdout)
        if not isinstance(texts, list) or not all(isinstance(text, str) for text in texts):
            raise RuntimeError("Invalid screenshot recognition result")
        if frontend_is_visible(texts):
            os.kill(pid, 0)
            return {"renderedStartup": True, "renderWaitSeconds": round(time.monotonic() - started, 1)}
        time.sleep(min(3, max(0, deadline - time.monotonic())))
    # Keep the last screenshot and recognized text, so a spinner or render
    # failure is reviewable even when the job fails.
    screenshot.with_suffix(".ocr.json").write_text(json.dumps(texts, ensure_ascii=False) + "\n")
    raise RuntimeError(f"{device_id}: 連線頁在 {timeout} 秒內未顯示，已保存 {screenshot}")


def simctl(*args, timeout=60):
    return subprocess.run(
        ["xcrun", "simctl", *map(str, args)],
        check=True, capture_output=True, text=True, timeout=timeout,
    ).stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--store-screenshots", action="store_true", help="另產生符合商店尺寸且不含 Alpha 的原始截圖候選素材")
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
    with tempfile.TemporaryDirectory(prefix="latticeterm-screen-reader-") as directory:
        reader = Path(directory) / "ios-screen-text"
        subprocess.run(
            ["xcrun", "swiftc", str(Path(__file__).with_name("ios-screen-text.swift")), "-o", str(reader)],
            check=True, capture_output=True, text=True, timeout=180,
        )
        check_simulators(args, runtime, devices, reader)


def check_simulators(args, runtime, devices, reader):
    report = []
    targets = []
    for family in ("iPhone", "iPad"):
        model = (store_model(devices, family) if args.store_screenshots and family == "iPad" else
                 next((device for device in devices if device["name"].startswith(family) and device.get("deviceTypeIdentifier")), None))
        if model is None:
            raise RuntimeError(f"Runtime {runtime} 缺少 {family} 機型")
        targets.append((family, family, model, args.store_screenshots and family == "iPad"))
    if args.store_screenshots:
        targets.append(("iPhone-AppStore", "iPhone", store_model(devices, "iPhone"), True))
    for label, family, model, capture_store in targets:
        # Create clean devices so no existing profiles, secrets or simulator
        # data are read, modified or included in the screenshots.
        device_id = simctl("create", f"LatticeTerm CI {label}", model["deviceTypeIdentifier"], runtime)
        try:
            simctl("boot", device_id)
            simctl("bootstatus", device_id, "-b", timeout=180)
            simctl("install", device_id, args.app.resolve(), timeout=120)
            output = simctl("launch", device_id, BUNDLE_ID)
            match = re.search(r": (\d+)\s*$", output)
            if match is None:
                raise RuntimeError(f"無法讀取 App PID：{output}")
            pid = int(match[1])
            screenshot = args.output / f"{label}.png"
            visible = wait_for_frontend(device_id, pid, screenshot, reader)
            entry = {"family": family, "model": model["name"], "runtime": runtime, "survivedStartup": True, **visible, "screenshot": screenshot.name}
            if capture_store:
                entry["appStoreCandidate"] = capture_store_image(device_id, family, args.output)
            report.append(entry)
            (args.output / "launch-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
            print(f"{label}: 已辨識連線頁內容，程序仍在執行，已保存 {screenshot}", flush=True)
        finally:
            # Cleanup is limited to this invocation's newly created device.
            try:
                simctl("shutdown", device_id)
            finally:
                simctl("delete", device_id)


if __name__ == "__main__":
    main()

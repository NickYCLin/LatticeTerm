"""Regression checks for a live iPad process whose WebView is still blank."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "ios_simulator_smoke", Path(__file__).with_name("ios-simulator-smoke.py")
)
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class FrontendVisibilityTests(unittest.TestCase):
    def test_status_bar_and_spinner_are_not_a_ready_app(self):
        self.assertFalse(smoke.frontend_is_visible(["1:54 PM", "Sat Sep 5", "100% "]))
        self.assertFalse(smoke.frontend_is_visible([]))

    def test_partial_page_without_add_action_is_not_ready(self):
        self.assertFalse(smoke.frontend_is_visible(["我的連線", "還沒有任何連線"]))
        self.assertFalse(smoke.frontend_is_visible(["Connections", "Add connection"]))

    def test_traditional_chinese_page_is_visible(self):
        self.assertTrue(smoke.frontend_is_visible([
            "我的連線", "還沒有任何連線", "+ 新增連線", "載入範例",
        ]))

    def test_english_page_is_visible(self):
        self.assertTrue(smoke.frontend_is_visible([
            "Connections", "No connections yet", "+ Add connection", "Load samples",
        ]))

    def test_ocr_spacing_does_not_hide_present_controls(self):
        self.assertTrue(smoke.frontend_is_visible(["還 沒有 任 何 連線", "新 增 連 線"]))


class StoreScreenshotTests(unittest.TestCase):
    def test_store_model_does_not_take_the_first_narrow_phone(self):
        devices = [{"name": name, "deviceTypeIdentifier": name} for name in (
            "iPhone 17 Pro", "iPhone 16 Pro Max", "iPhone 17 Pro Max",
        )]
        self.assertEqual(smoke.store_model(devices, "iPhone")["name"], "iPhone 17 Pro Max")

    def test_store_model_requires_a_supported_phone_and_large_ipad(self):
        devices = [{"name": name, "deviceTypeIdentifier": name} for name in (
            "iPhone 17 Pro", "iPad Pro 11-inch (M5)", "iPad Pro 13-inch (M5)",
        )]
        with self.assertRaises(RuntimeError):
            smoke.store_model(devices, "iPhone")
        self.assertEqual(smoke.store_model(devices, "iPad")["name"], "iPad Pro 13-inch (M5)")

    def test_only_native_store_sizes_without_alpha_are_accepted(self):
        def metadata(width, height, alpha="no", format="jpeg"):
            return f"/tmp/capture.jpg\n  pixelWidth: {width}\n  pixelHeight: {height}\n  hasAlpha: {alpha}\n  format: {format}\n"
        self.assertEqual(smoke.store_image_metadata(metadata(1320, 2868), "iPhone")["width"], 1320)
        self.assertEqual(smoke.store_image_metadata(metadata(2064, 2752), "iPad")["height"], 2752)
        for text in (metadata(1206, 2622), metadata(1320, 2868, "yes"), metadata(1320, 2868, format="png"), "missing"):
            with self.assertRaises(RuntimeError):
                smoke.store_image_metadata(text, "iPhone")


class FailureEvidenceTests(unittest.TestCase):
    def test_launch_timeout_is_preserved_when_capture_also_fails(self):
        commands = []
        original = subprocess.TimeoutExpired(["xcrun", "simctl", "launch"], 60)

        def simctl(*args, **kwargs):
            commands.append((args, kwargs))
            if args[0] == "create":
                return "owned-device"
            if args[0] == "launch":
                raise original
            if args[0] == "io":
                raise RuntimeError("simulator unavailable")
            return ""

        with tempfile.TemporaryDirectory() as directory, patch.object(smoke, "simctl", side_effect=simctl):
            output = Path(directory)
            args = Namespace(app=output / "App.app", output=output, store_screenshots=False)
            devices = [{"name": name, "deviceTypeIdentifier": name} for name in ("iPhone", "iPad")]
            with self.assertRaises(subprocess.TimeoutExpired) as raised:
                smoke.check_simulators(args, "runtime", devices, output / "reader")
            self.assertIs(raised.exception, original)
            report = json.loads((output / "iPhone.failure.json").read_text())
            self.assertEqual(report["stage"], "launch")
            self.assertEqual(report["errorType"], "TimeoutExpired")
            self.assertIn("simulator unavailable", report["captureError"])
            self.assertFalse((output / "launch-report.json").exists())
        self.assertEqual(commands[-2][0], ("shutdown", "owned-device"))
        self.assertEqual(commands[-1][0], ("delete", "owned-device"))
        self.assertEqual(next(kwargs["timeout"] for args, kwargs in commands if args[0] == "io"), 15)
        self.assertFalse(any(args[0] == "create" and "iPad" in args[1] for args, _ in commands))


if __name__ == "__main__":
    unittest.main()

"""Regression checks for a live iPad process whose WebView is still blank."""
import importlib.util
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()

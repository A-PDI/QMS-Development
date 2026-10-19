"""
Tests for the e-sign field detector.

    python -m unittest discover -s tests           # fast tests (no model)
    DETECTOR_TEST_ML=1 python -m unittest discover -s tests   # + model test

The model test downloads the FFDNet weights on first run.
"""

import os
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
os.environ.setdefault("DETECTOR_WARMUP", "false")

from detection import (  # noqa: E402
    DetectionError, MLDetector, detect_fields, display_to_user, non_max_suppression,
    norm_box_to_user, parse_field_name, plausible_ml_box, type_from_label, PageInfo,
)

FIXTURES = HERE / "fixtures"


def fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


class GeometryTests(unittest.TestCase):
    CROP = (20.0, 30.0, 590.0, 770.0)

    def test_unrotated_corners(self):
        self.assertEqual(display_to_user(0, 0, self.CROP, 0), (20.0, 770.0))
        self.assertEqual(display_to_user(1, 1, self.CROP, 0), (590.0, 30.0))

    def test_rotated_corners(self):
        # Display top-left is the page's bottom-left at 90°, top-right at 270°.
        self.assertEqual(display_to_user(0, 0, self.CROP, 90), (20.0, 30.0))
        self.assertEqual(display_to_user(0, 0, self.CROP, 180), (590.0, 30.0))
        self.assertEqual(display_to_user(0, 0, self.CROP, 270), (590.0, 770.0))

    def test_box_is_normalized(self):
        x, y, w, h = norm_box_to_user((0.1, 0.2, 0.3, 0.25), (0, 0, 600, 800), 0)
        self.assertAlmostEqual(x, 60)
        self.assertAlmostEqual(y, 600)
        self.assertAlmostEqual(w, 120)
        self.assertAlmostEqual(h, 40)


class NamingAndLabelTests(unittest.TestCase):
    def test_field_names(self):
        self.assertEqual(parse_field_name("sig_customer"), ("signature", "customer"))
        self.assertEqual(parse_field_name("Date-PDI"), ("date", "pdi"))
        self.assertEqual(parse_field_name("print_name_supplier"), ("name", "supplier"))
        self.assertEqual(parse_field_name("Text3"), (None, None))

    def test_label_types(self):
        self.assertEqual(type_from_label("Date Signed:"), "date")
        self.assertEqual(type_from_label("Signed:"), "signature")
        self.assertEqual(type_from_label("Initials"), "initials")
        self.assertEqual(type_from_label("Print Name:"), "name")
        self.assertEqual(type_from_label("Title:"), "title")
        self.assertIsNone(type_from_label("Quantity"))

    def test_nms_keeps_most_confident(self):
        a = {"page": 0, "x": 10, "y": 10, "width": 100, "height": 20, "confidence": 0.4}
        b = {"page": 0, "x": 12, "y": 11, "width": 100, "height": 20, "confidence": 0.6}
        c = {"page": 0, "x": 10, "y": 100, "width": 100, "height": 20, "confidence": 0.2}
        kept = non_max_suppression([a, b, c])
        self.assertEqual(len(kept), 2)
        self.assertIn(b, kept)
        self.assertIn(c, kept)

    def test_implausible_boxes_rejected(self):
        page = PageInfo(index=0, width=612, height=792, rotation=0, crop=(0, 0, 612, 792))
        self.assertTrue(plausible_ml_box({"width": 200, "height": 20}, page))
        self.assertFalse(plausible_ml_box({"width": 480, "height": 600}, page))
        self.assertFalse(plausible_ml_box({"width": 3, "height": 20}, page))


class DocumentTests(unittest.TestCase):
    def test_tags(self):
        result = detect_fields(fixture("tagged.pdf"), None, use_ml=False)
        fields = result["fields"]
        self.assertEqual(result["counts"]["tag"], 4)
        sig1 = [f for f in fields if f["type"] == "signature" and f["recipient_index"] == 1]
        self.assertEqual(len(sig1), 1)
        self.assertEqual(sig1[0]["role_hint"], "buyer")
        init2 = [f for f in fields if f["type"] == "initials"][0]
        self.assertEqual(init2["recipient_index"], 2)
        self.assertFalse(init2["required"])
        self.assertTrue(all(f["source"] == "tag" for f in fields))

    def test_acroform_fields(self):
        result = detect_fields(fixture("acro.pdf"), None, use_ml=False)
        by_name = {f["name"]: f for f in result["fields"]}
        self.assertEqual(by_name["sig_supplier"]["type"], "signature")
        self.assertEqual(by_name["sig_supplier"]["role_hint"], "supplier")
        self.assertEqual(by_name["name_supplier"]["type"], "name")
        # No naming convention → typed from the printed label, role from it too.
        self.assertEqual(by_name["Text3"]["type"], "text")
        self.assertEqual(by_name["Text3"]["role_hint"], "pdi")
        self.assertEqual(by_name["agree"]["type"], "checkbox")
        self.assertEqual(by_name["sig_supplier"]["x"], 200.0)
        self.assertEqual(result["pages"][0]["width"], 612.0)

    def test_rejects_non_pdf(self):
        with self.assertRaises(DetectionError) as ctx:
            detect_fields(b"hello", None)
        self.assertEqual(ctx.exception.code, "BAD_PDF")

    def test_page_limit(self):
        with self.assertRaises(DetectionError) as ctx:
            detect_fields(fixture("tagged.pdf"), None, max_pages=0, use_ml=False)
        self.assertEqual(ctx.exception.status, 413)


class AppTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        import app as service
        self.service = service
        self.client = TestClient(service.app)

    def test_health(self):
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertIn(r.json()["status"], ("ok", "loading", "error"))

    def test_detect_without_ml(self):
        r = self.client.post("/detect?ml=false",
                             files={"file": ("t.pdf", fixture("tagged.pdf"), "application/pdf")})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(len(body["fields"]), 4)
        self.assertFalse(body["ml_used"])

    def test_bad_file(self):
        r = self.client.post("/detect?ml=false", files={"file": ("t.pdf", b"nope", "application/pdf")})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "BAD_PDF")

    def test_api_key(self):
        old = self.service.API_KEY
        self.service.API_KEY = "secret"
        try:
            r = self.client.post("/detect?ml=false",
                                 files={"file": ("t.pdf", fixture("tagged.pdf"), "application/pdf")})
            self.assertEqual(r.status_code, 401)
            r = self.client.post("/detect?ml=false", headers={"X-Api-Key": "secret"},
                                 files={"file": ("t.pdf", fixture("tagged.pdf"), "application/pdf")})
            self.assertEqual(r.status_code, 200)
        finally:
            self.service.API_KEY = old


@unittest.skipUnless(os.environ.get("DETECTOR_TEST_ML") == "1", "set DETECTOR_TEST_ML=1 to run the model")
class ModelTests(unittest.TestCase):
    def test_underscore_lines(self):
        ml = MLDetector()
        result = detect_fields(fixture("lines.pdf"), ml)
        types = sorted(f["type"] for f in result["fields"])
        self.assertEqual(types, ["date", "name", "signature"], result["fields"])
        sig = [f for f in result["fields"] if f["type"] == "signature"][0]
        self.assertEqual(sig["role_hint"], "supplier")


if __name__ == "__main__":
    unittest.main()

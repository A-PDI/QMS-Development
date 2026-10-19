"""
Signature-field detection for the e-sign module.

Given a PDF, return the boxes a sender will most likely want signers to fill,
in PDF user-space points (origin bottom-left, the same space pdf-lib and
pdf.js use). Three sources, in order of trust:

  1. acroform — fillable fields already in the PDF (e.g. made with Acrobat's
     Prepare Form). Field names like "sig_customer" or "date_pdi" set the
     field type and a signer-role hint.
  2. tag      — hidden text tags such as {{sig:1}}, {{date:2}}, {{init:1:opt}}
     typed into a Word template. The number is the signer (1-based).
  3. ml       — boxes predicted by the CommonForms FFDNet model on the page
     image, for plain PDFs with no fields or tags.

Every box then gets a type (signature, initials, date, name, title, company,
email, text, checkbox) from the text printed next to it ("Signed:",
"Date:", "Print Name") and, when the label names a party ("Supplier
Signature", "PDI Representative"), a role hint the UI can match to a
recipient. ML boxes that overlap an acroform or tag field are dropped.
"""

from __future__ import annotations

import io
import logging
import re
import threading
from dataclasses import dataclass, field
from typing import Optional

import pypdfium2 as pdfium
from pypdf import PdfReader

log = logging.getLogger("esign-detector")

# ── Field typing ──────────────────────────────────────────────────────────────

FIELD_TYPES = (
    "signature", "initials", "date", "name", "title",
    "company", "email", "text", "checkbox",
)

# Name / tag aliases → field type.
TYPE_ALIASES = {
    "sig": "signature", "sign": "signature", "signature": "signature", "signed": "signature",
    "init": "initials", "initial": "initials", "initials": "initials",
    "date": "date", "datesigned": "date",
    "name": "name", "printname": "name", "fullname": "name",
    "title": "title", "position": "title",
    "company": "company", "org": "company", "organization": "company",
    "email": "email",
    "text": "text", "txt": "text",
    "check": "checkbox", "chk": "checkbox", "checkbox": "checkbox",
}

# Label text → field type. Order matters: "Date Signed" is a date, not a
# signature; "Initials" before the generic "sign" rule.
LABEL_RULES = [
    ("date", re.compile(r"\bdate\b|\bdated\b", re.I)),
    ("initials", re.compile(r"\binitial(s|ed)?\b", re.I)),
    ("signature", re.compile(r"\bsign(ed|ature|er)?\b|\bby\s*:", re.I)),
    ("name", re.compile(r"\bname\b", re.I)),
    ("title", re.compile(r"\btitle\b|\bposition\b|\bdesignation\b", re.I)),
    ("company", re.compile(r"\bcompany\b|\borgani[sz]ation\b|\bvendor\b|\bfirm\b|\bentity\b", re.I)),
    ("email", re.compile(r"\be-?mail\b", re.I)),
]

# Words that identify which party a field belongs to.
ROLE_WORDS = re.compile(
    r"\b(pdi|performance\s+diesel|customer|supplier|vendor|buyer|seller|"
    r"contractor|client|company|witness|employee|manager|representative|"
    r"recipient|disclos(ing|er)|receiv(ing|er))\b",
    re.I,
)

TAG_RE = re.compile(
    r"\{\{\s*([a-z]+)\s*(?::\s*(\d+))?\s*(?::\s*(req|opt))?\s*\}\}", re.I
)

# Default box size (points) for tag fields, by type.
TAG_SIZES = {
    "signature": (180, 30), "initials": (60, 26), "date": (100, 18),
    "name": (180, 18), "title": (160, 18), "company": (200, 18),
    "email": (200, 18), "text": (160, 18), "checkbox": (14, 14),
}

ML_CLASS_TO_TYPE = {"TextBox": "text", "ChoiceButton": "checkbox", "Signature": "signature"}


@dataclass
class Word:
    text: str
    left: float
    bottom: float
    right: float
    top: float

    @property
    def cy(self) -> float:
        return (self.bottom + self.top) / 2


@dataclass
class PageInfo:
    index: int
    width: float
    height: float
    rotation: int
    crop: tuple  # (left, bottom, right, top) in user space
    words: list = field(default_factory=list)


class DetectionError(Exception):
    """A PDF the detector cannot process (bad file, encrypted, too large)."""

    def __init__(self, message: str, status: int = 400, code: str = "BAD_PDF"):
        super().__init__(message)
        self.status = status
        self.code = code


# ── Geometry ──────────────────────────────────────────────────────────────────

def display_to_user(u: float, v: float, crop: tuple, rotation: int) -> tuple:
    """
    Map a normalized point on the rendered (rotated) page image — u across,
    v down, both 0..1 from the top-left — to PDF user space.
    """
    left, bottom, right, top = crop
    w, h = right - left, top - bottom
    r = rotation % 360
    if r == 90:
        return left + v * w, bottom + u * h
    if r == 180:
        return right - u * w, bottom + v * h
    if r == 270:
        return right - v * w, top - u * h
    return left + u * w, top - v * h


def norm_box_to_user(box: tuple, crop: tuple, rotation: int) -> tuple:
    """(u0, v0, u1, v1) normalized display box → (x, y, width, height) user space."""
    u0, v0, u1, v1 = box
    xa, ya = display_to_user(u0, v0, crop, rotation)
    xb, yb = display_to_user(u1, v1, crop, rotation)
    x0, x1 = sorted((xa, xb))
    y0, y1 = sorted((ya, yb))
    return x0, y0, x1 - x0, y1 - y0


def iou(a: dict, b: dict) -> float:
    ix = max(0.0, min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"]))
    iy = max(0.0, min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"]))
    inter = ix * iy
    union = a["width"] * a["height"] + b["width"] * b["height"] - inter
    return inter / union if union > 0 else 0.0


def non_max_suppression(boxes: list, threshold: float = 0.3) -> list:
    """
    Keep the most confident box from each cluster of overlapping detections.
    The CPU (ONNX) model path returns raw, un-suppressed boxes — often ten
    copies of the same field.
    """
    kept: list = []
    for b in sorted(boxes, key=lambda f: f.get("confidence") or 0, reverse=True):
        if all(k["page"] != b["page"] or (iou(k, b) <= threshold and overlap_ratio(k, b) <= 0.7)
               for k in kept):
            kept.append(b)
    return kept


def overlap_ratio(a: dict, b: dict) -> float:
    """Intersection area over the smaller box's area (0..1)."""
    ix = max(0.0, min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"]))
    iy = max(0.0, min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"]))
    inter = ix * iy
    smaller = min(a["width"] * a["height"], b["width"] * b["height"]) or 1.0
    return inter / smaller


# ── Text extraction ───────────────────────────────────────────────────────────

def extract_words(textpage) -> list:
    """Words with user-space boxes, built from pdfium's per-character boxes."""
    words: list = []
    count = textpage.count_chars()
    buf, box = [], None

    def flush():
        nonlocal buf, box
        if buf and box:
            words.append(Word("".join(buf), *box))
        buf, box = [], None

    for i in range(count):
        ch = textpage.get_text_range(i, 1)
        if not ch or ch.isspace():
            flush()
            continue
        try:
            left, bottom, right, top = textpage.get_charbox(i)
        except Exception:  # generated chars (e.g. inserted spaces) have no box
            flush()
            continue
        if box is not None:
            # A jump backwards or a wide gap starts a new word even without a space.
            gap = left - box[2]
            height = max(box[3] - box[1], 1.0)
            same_line = abs(((bottom + top) / 2) - ((box[1] + box[3]) / 2)) < height * 0.6
            if not same_line or gap > height * 0.8 or gap < -height:
                flush()
        buf.append(ch)
        box = (left, bottom, right, top) if box is None else (
            min(box[0], left), min(box[1], bottom), max(box[2], right), max(box[3], top))
    flush()
    return words


def label_for_box(fld: dict, words: list) -> str:
    """
    Text printed next to a field: on the same line to the left (most forms),
    just to the right ("____ (“Company”)"), or directly below/above the line
    ("Signature" printed under a signature line).
    """
    x0, y0 = fld["x"], fld["y"]
    x1, y1 = x0 + fld["width"], y0 + fld["height"]
    cy = (y0 + y1) / 2
    tol = max(fld["height"] * 0.75, 8)

    def is_fill(w):  # underscores / dots are the blank itself, not a label
        return bool(re.fullmatch(r"[_.\-…]+", w.text))

    left_words = [w for w in words if not is_fill(w) and w.right <= x0 + 6
                  and x0 - w.right < 220 and abs(w.cy - cy) <= tol]
    left_words.sort(key=lambda w: w.left)
    # Keep the trailing words nearest the box (a label, not the whole sentence).
    left_text = " ".join(w.text for w in left_words[-4:])

    right_words = [w for w in words if not is_fill(w) and w.left >= x1 - 6
                   and w.left - x1 < 40 and abs(w.cy - cy) <= tol]
    right_words.sort(key=lambda w: w.left)
    right_text = " ".join(w.text for w in right_words[:2])

    def h_overlap(w):
        return min(w.right, x1) - max(w.left, x0) > 0

    below = [w for w in words if not is_fill(w) and h_overlap(w) and w.top <= y0 + 2 and y0 - w.top < 16]
    above = [w for w in words if not is_fill(w) and h_overlap(w) and w.bottom >= y1 - 2 and w.bottom - y1 < 12]
    below.sort(key=lambda w: w.left)
    above.sort(key=lambda w: w.left)
    below_text = " ".join(w.text for w in below[:5])
    above_text = " ".join(w.text for w in above[:5])

    for candidate in (left_text, below_text, right_text, above_text):
        if candidate and any(rule.search(candidate) for _, rule in LABEL_RULES):
            return candidate.strip()
    return (left_text or below_text or right_text or above_text).strip()


def type_from_label(label: str) -> Optional[str]:
    for ftype, rule in LABEL_RULES:
        if label and rule.search(label):
            return ftype
    return None


def role_from_text(text: str) -> Optional[str]:
    if not text:
        return None
    m = ROLE_WORDS.search(text)
    return m.group(0).strip().lower() if m else None


def parse_field_name(name: str) -> tuple:
    """'sig_customer' → ('signature', 'customer'); unknown → (None, None)."""
    tokens = [t for t in re.split(r"[_\-\s.\[\]]+", (name or "").strip().lower()) if t]
    if not tokens:
        return None, None
    ftype = TYPE_ALIASES.get(tokens[0])
    if not ftype and len(tokens) > 1:
        ftype = TYPE_ALIASES.get(tokens[0] + tokens[1])
        if ftype:
            tokens = [tokens[0] + tokens[1]] + tokens[2:]
    if not ftype:
        return None, None
    role = " ".join(t for t in tokens[1:] if not t.isdigit()) or None
    return ftype, role


# ── Sources ───────────────────────────────────────────────────────────────────

def load_pages(pdf_bytes: bytes, max_pages: int) -> tuple:
    try:
        doc = pdfium.PdfDocument(pdf_bytes)
    except pdfium.PdfiumError as err:
        msg = str(err).lower()
        if "password" in msg or "security" in msg:
            raise DetectionError("The PDF is password-protected.", 422, "ENCRYPTED_PDF")
        raise DetectionError("The file is not a readable PDF.", 400, "BAD_PDF")
    if len(doc) == 0:
        raise DetectionError("The PDF has no pages.", 400, "BAD_PDF")
    if len(doc) > max_pages:
        raise DetectionError(f"The PDF has {len(doc)} pages; the limit is {max_pages}.", 413, "TOO_MANY_PAGES")
    pages = []
    for i in range(len(doc)):
        page = doc[i]
        crop = tuple(page.get_cropbox())
        textpage = page.get_textpage()
        pages.append(PageInfo(
            index=i,
            width=crop[2] - crop[0],
            height=crop[3] - crop[1],
            rotation=page.get_rotation() % 360,
            crop=crop,
            words=extract_words(textpage),
        ))
    return doc, pages


def acroform_fields(pdf_bytes: bytes, pages: list) -> list:
    """Existing fillable fields (widget annotations) on each page."""
    out = []
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as err:  # pypdf can fail on PDFs pdfium opens fine
        log.warning("pypdf could not read the PDF for form fields: %s", err)
        return out
    for i, page in enumerate(reader.pages):
        if i >= len(pages):
            break
        annots = page.get("/Annots")
        if not annots:
            continue
        for ref in annots:
            try:
                a = ref.get_object()
                if a.get("/Subtype") != "/Widget":
                    continue
                parent = a.get("/Parent")
                parent = parent.get_object() if parent is not None else None
                name = a.get("/T") or (parent.get("/T") if parent is not None else None)
                ft = a.get("/FT") or (parent.get("/FT") if parent is not None else None)
                rect = [float(v) for v in a["/Rect"]]
            except Exception:
                continue
            x0, x1 = sorted((rect[0], rect[2]))
            y0, y1 = sorted((rect[1], rect[3]))
            if x1 - x0 < 2 or y1 - y0 < 2:
                continue  # hidden / zero-size widgets
            name = str(name) if name is not None else None
            out.append({
                "page": i, "x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0,
                "source": "acroform", "name": name,
                "detected_class": {"/Sig": "signature", "/Btn": "checkbox", "/Tx": "text", "/Ch": "text"}.get(str(ft)),
                "confidence": None,
            })
    return out


def tag_fields(pages: list) -> list:
    """{{type:signer:req|opt}} tags typed into the document."""
    out = []
    for p in pages:
        for w in p.words:
            for m in TAG_RE.finditer(w.text):
                ftype = TYPE_ALIASES.get(m.group(1).lower())
                if not ftype:
                    continue
                tw, th = TAG_SIZES[ftype]
                out.append({
                    "page": p.index, "x": w.left, "y": w.bottom,
                    "width": max(tw, w.right - w.left), "height": th,
                    "source": "tag", "name": m.group(0), "type": ftype,
                    "recipient_index": int(m.group(2)) if m.group(2) else 1,
                    "required": (m.group(3) or "req").lower() != "opt",
                    "detected_class": None, "confidence": None,
                })
    return out


class MLDetector:
    """
    Wraps CommonForms' FFDNet detector so the model loads once and serves many
    requests. Inference is serialized with a lock — the YOLO model is not
    thread-safe.
    """

    def __init__(self, model: str = "FFDNet-L", device: str = "cpu",
                 confidence: float = 0.1, image_size: int = 1600, fast: bool = True):
        self.model_name = model
        self.device = device
        self.confidence = confidence
        self.image_size = image_size
        self.fast = fast
        self._detector = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._detector is not None

    def load(self):
        if self._detector is None:
            from commonforms.inference import FFDNetDetector  # heavy import
            log.info("Loading %s (fast=%s) on %s", self.model_name, self.fast, self.device)
            self._detector = FFDNetDetector(self.model_name, device=self.device, fast=self.fast)
        return self._detector

    def detect(self, doc, pages: list, confidence: Optional[float] = None) -> list:
        conf = self.confidence if confidence is None else confidence
        detector = self.load()
        images = []
        for p in pages:
            # Same resolution CommonForms renders at (144 dpi = scale 2).
            images.append(doc[p.index].render(scale=2).to_pil().convert("RGB"))
        out = []
        with self._lock:
            for p, image in zip(pages, images):
                if self.fast:
                    results = detector.model.predict(image, iou=1, conf=conf, augment=False,
                                                     imgsz=1216, verbose=False)
                else:
                    results = detector.model.predict(image, iou=0.1, conf=conf, augment=True,
                                                     imgsz=self.image_size, device=self.device,
                                                     verbose=False)
                result = results[0] if results else None
                if result is None or result.boxes is None:
                    continue
                for box in result.boxes.cpu().numpy():
                    cx, cy, bw, bh = (float(v) for v in box.xywhn[0])
                    cls = detector.id_to_cls[int(box.cls.item())]
                    x, y, w, h = norm_box_to_user(
                        (cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2), p.crop, p.rotation)
                    out.append({
                        "page": p.index, "x": x, "y": y, "width": w, "height": h,
                        "source": "ml", "name": None,
                        "detected_class": ML_CLASS_TO_TYPE.get(cls, "text"),
                        "confidence": round(float(box.conf.item()), 3),
                    })
        return non_max_suppression(out)


# ── Orchestration ─────────────────────────────────────────────────────────────

# Signing fields are single lines or small boxes. Anything taller, or covering
# a large share of the page, is the model latching onto a table or a block of
# text — not something a signer fills in.
MAX_ML_HEIGHT = 72.0
MAX_ML_PAGE_SHARE = 0.12
MIN_ML_SIZE = 6.0


def plausible_ml_box(f: dict, page: PageInfo) -> bool:
    if f["width"] < MIN_ML_SIZE or f["height"] < MIN_ML_SIZE:
        return False
    if f["height"] > MAX_ML_HEIGHT:
        return False
    page_area = max(page.width * page.height, 1.0)
    return (f["width"] * f["height"]) / page_area <= MAX_ML_PAGE_SHARE


def classify(fld: dict, page: PageInfo) -> dict:
    label = label_for_box(fld, page.words)
    name_type, name_role = parse_field_name(fld.get("name")) if fld["source"] == "acroform" else (None, None)
    label_type = type_from_label(label)
    detected = fld.get("detected_class")

    if fld["source"] == "tag":
        ftype = fld["type"]
    elif name_type:
        ftype = name_type
    elif detected == "checkbox":
        ftype = "checkbox"  # a box is a box, whatever the label says
    elif detected == "signature" and label_type in (None, "name", "title", "company"):
        # The model saw a signature line; a nearby "Name" heading rarely overrides that.
        ftype = "signature"
    else:
        ftype = label_type or detected or "text"

    fld["type"] = ftype
    fld["label"] = label or None
    fld["role_hint"] = name_role or role_from_text(label)
    fld.setdefault("required", ftype != "checkbox")
    fld.setdefault("recipient_index", None)
    return fld


def detect_fields(pdf_bytes: bytes, ml: Optional[MLDetector], *, max_pages: int = 50,
                  confidence: Optional[float] = None, use_ml: bool = True) -> dict:
    if not pdf_bytes or not pdf_bytes.lstrip()[:5].startswith(b"%PDF"):
        raise DetectionError("The file is not a PDF.", 400, "BAD_PDF")

    doc, pages = load_pages(pdf_bytes, max_pages)
    try:
        existing = acroform_fields(pdf_bytes, pages)
        tags = tag_fields(pages)
        ml_fields = []
        if use_ml and ml is not None:
            ml_fields = ml.detect(doc, pages, confidence)
    finally:
        doc.close()

    anchored = existing + tags
    kept_ml = [f for f in ml_fields
               if plausible_ml_box(f, pages[f["page"]])
               and not any(a["page"] == f["page"] and overlap_ratio(a, f) > 0.4 for a in anchored)]

    fields = []
    for f in anchored + kept_ml:
        page = pages[f["page"]]
        fields.append(classify(f, page))

    fields.sort(key=lambda f: (f["page"], -round(f["y"] + f["height"], 0), f["x"]))
    for n, f in enumerate(fields):
        f["id"] = f"det-{f['page']}-{n}"
        for k in ("x", "y", "width", "height"):
            f[k] = round(f[k], 2)

    return {
        "pages": [{"index": p.index, "width": round(p.width, 2), "height": round(p.height, 2),
                   "rotation": p.rotation, "crop": [round(v, 2) for v in p.crop]} for p in pages],
        "fields": fields,
        "counts": {"acroform": len(existing), "tag": len(tags), "ml": len(kept_ml)},
    }

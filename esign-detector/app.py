"""
HTTP service for e-sign field detection.

Runs next to the Node server (localhost only by default). The Node e-sign
module posts an uploaded PDF to POST /detect and gets back suggested signing
fields; see detection.py for how they are found.

    python app.py                     # reads settings from the environment
    GET  /health                      # {"status": "ok" | "loading", ...}
    POST /detect  (multipart "file")  # → {"pages": [...], "fields": [...]}

Environment (all optional):
    DETECTOR_HOST         127.0.0.1
    DETECTOR_PORT         8765
    DETECTOR_API_KEY      shared secret; when set, requests need X-Api-Key
    DETECTOR_MODEL        FFDNet-L   (or FFDNet-S, or a path to weights)
    DETECTOR_FAST         true       ONNX CPU model (~4 s for 2 pages vs ~20 s)
    DETECTOR_CONFIDENCE   0.1
    DETECTOR_IMAGE_SIZE   1600       (ignored when DETECTOR_FAST=true)
    DETECTOR_DEVICE       cpu        (e.g. cuda, 0)
    DETECTOR_MAX_PAGES    50
    DETECTOR_MAX_MB       25
    DETECTOR_WARMUP       true       load the model at startup
    HF_HOME               where the model weights are cached (downloaded on
                          first use from huggingface.co)
"""

from __future__ import annotations

import logging
import os
import secrets
import threading
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, Header, Query, UploadFile
from fastapi.responses import JSONResponse

from detection import DetectionError, MLDetector, detect_fields

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("esign-detector")


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        log.warning("%s is not a number; using %s", name, default)
        return default


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        log.warning("%s is not an integer; using %s", name, default)
        return default


API_KEY = os.environ.get("DETECTOR_API_KEY", "").strip()
MAX_PAGES = env_int("DETECTOR_MAX_PAGES", 50)
MAX_BYTES = env_int("DETECTOR_MAX_MB", 25) * 1024 * 1024

ml = MLDetector(
    model=os.environ.get("DETECTOR_MODEL", "FFDNet-L"),
    device=os.environ.get("DETECTOR_DEVICE", "cpu"),
    confidence=env_float("DETECTOR_CONFIDENCE", 0.1),
    image_size=env_int("DETECTOR_IMAGE_SIZE", 1600),
    fast=env_bool("DETECTOR_FAST", True),
)
_load_error: Optional[str] = None


def _warmup():
    global _load_error
    try:
        started = time.time()
        ml.load()
        log.info("Model ready in %.1fs", time.time() - started)
    except Exception as err:  # keep serving acroform/tag detection without ML
        _load_error = f"{type(err).__name__}: {err}"
        log.exception("Model failed to load; ML detection disabled until restart")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if env_bool("DETECTOR_WARMUP", True):
        threading.Thread(target=_warmup, name="model-warmup", daemon=True).start()
    yield


app = FastAPI(title="PDI e-sign field detector", version="1.0.0", lifespan=lifespan)


def error(status: int, message: str, code: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": message, "code": code})


def authorized(x_api_key: Optional[str]) -> bool:
    return not API_KEY or (x_api_key is not None and secrets.compare_digest(x_api_key, API_KEY))


@app.get("/health")
def health():
    return {
        "status": "ok" if ml.loaded else ("error" if _load_error else "loading"),
        "model": ml.model_name,
        "fast": ml.fast,
        "model_loaded": ml.loaded,
        "model_error": _load_error,
    }


@app.post("/detect")
def detect(
    file: UploadFile = File(...),
    confidence: Optional[float] = Query(None, ge=0.01, le=0.95),
    ml_enabled: bool = Query(True, alias="ml"),
    x_api_key: Optional[str] = Header(None),
):
    # A sync endpoint: FastAPI runs it in a worker thread, so model inference
    # does not block the event loop (inference itself is serialized by a lock).
    if not authorized(x_api_key):
        return error(401, "Missing or invalid X-Api-Key", "UNAUTHORIZED")

    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        return error(413, f"PDF is larger than {MAX_BYTES // (1024 * 1024)} MB", "FILE_TOO_LARGE")

    use_ml = ml_enabled and _load_error is None
    started = time.time()
    try:
        result = detect_fields(data, ml if use_ml else None, max_pages=MAX_PAGES,
                               confidence=confidence, use_ml=use_ml)
    except DetectionError as err:
        return error(err.status, str(err), err.code)
    except Exception as err:
        log.exception("Detection failed")
        return error(500, f"Detection failed: {type(err).__name__}", "DETECTION_FAILED")

    result["ml_used"] = use_ml
    result["ml_error"] = _load_error
    result["elapsed_ms"] = int((time.time() - started) * 1000)
    return result


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.environ.get("DETECTOR_HOST", "127.0.0.1"),
        port=env_int("DETECTOR_PORT", 8765),
        log_level="info",
    )

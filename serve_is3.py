"""
Flask server: serves frames from IS3 thermal videos + FAN landmark prediction.

Endpoints:
  POST /upload?session=PRE          → multipart file upload, returns session info
  GET  /info?session=PRE            → {ready, total_frames, width, height, fps}
  GET  /frame?session=PRE&frame=0   → JPEG image
  GET  /predict?session=PRE&frame=0 → {landmarks, width, height, face_count}

Run locally:
  python emotion_picks/serve_is3.py

Deploy (Docker):
  docker compose up -d
  Then upload IS3 files via the browser UI.
"""

import os
import sys

# torch.compile on Windows requires MSVC (cl.exe); disable it to fall back to
# plain eager mode when running locally without Visual Studio installed.
if sys.platform == "win32":
    os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")

import numpy as np
import cv2
from pathlib import Path
from flask import Flask, request, Response, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app)
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024  # 500 MB

# Where uploaded IS3 files are persisted (Docker named volume keeps them across restarts)
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/data/uploads"))

# Optional fallback: pre-mounted IS3 files (used if no upload exists for a session)
_default_base = Path(__file__).parent.parent / "NEEMA_Day1-001" / "NEEMA_Day1" / "THERMAL"
_BASE = Path(os.environ.get("THERMAL_BASE", str(_default_base)))
_FALLBACK_PATHS = {
    "PRE":  _BASE / "PRE"  / "IR_01678.IS3",
    "POST": _BASE / "POST" / "IR_01679.IS3",
}

_caps: dict[str, cv2.VideoCapture] = {}
_fa = None  # FAN model — lazy-loaded on first /predict call


# ── helpers ───────────────────────────────────────────────────────────────────

def _uploaded_path(session: str) -> Path | None:
    """Return the user-uploaded IS3 path if it exists, else None."""
    p = UPLOAD_DIR / f"{session}.IS3"
    return p if p.exists() else None


def _is3_path(session: str) -> Path | None:
    """Uploaded file takes priority; fall back to pre-mounted volume."""
    return _uploaded_path(session) or (
        _FALLBACK_PATHS.get(session) if _FALLBACK_PATHS.get(session, Path()).exists() else None
    )


def _cap(session: str) -> cv2.VideoCapture | None:
    if session not in _caps or not _caps[session].isOpened():
        path = _is3_path(session)
        if path is None:
            return None
        _caps[session] = cv2.VideoCapture(str(path))
    return _caps[session]


def _release(session: str) -> None:
    if session in _caps:
        _caps[session].release()
        del _caps[session]


def _read_frame(session: str, frame_idx: int) -> np.ndarray | None:
    cap = _cap(session)
    if cap is None:
        return None
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ret, img = cap.read()
    return img if ret else None


def _enhance_for_fan(bgr: np.ndarray) -> np.ndarray:
    """CLAHE contrast on L channel so FAN works on HOT-colormap thermal frames."""
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    lab[:, :, 0] = clahe.apply(lab[:, :, 0])
    return cv2.cvtColor(cv2.cvtColor(lab, cv2.COLOR_LAB2BGR), cv2.COLOR_BGR2RGB)


def _get_fa():
    global _fa
    if _fa is None:
        import face_alignment
        _fa = face_alignment.FaceAlignment(
            face_alignment.LandmarksType.TWO_D,
            flip_input=False,
            device="cpu",
        )
    return _fa


def _session_info(session: str) -> dict:
    cap = _cap(session)
    if cap is None:
        return {"ready": False, "total_frames": 0, "width": 0, "height": 0, "fps": 0}
    return {
        "ready":        True,
        "total_frames": int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
        "width":        int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height":       int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        "fps":          cap.get(cv2.CAP_PROP_FPS),
    }


# ── routes ────────────────────────────────────────────────────────────────────

@app.post("/upload")
def upload():
    session = request.args.get("session", "PRE").upper()
    if session not in ("PRE", "POST"):
        return jsonify({"error": "session must be PRE or POST"}), 400
    if "file" not in request.files:
        return jsonify({"error": "no file field in request"}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "empty filename"}), 400

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    dest = UPLOAD_DIR / f"{session}.IS3"

    f.save(str(dest))
    _release(session)   # close old VideoCapture so _cap() re-opens the new file

    info = _session_info(session)
    if not info["ready"]:
        dest.unlink(missing_ok=True)
        return jsonify({"error": "uploaded file could not be opened as a video"}), 422

    return jsonify({"ok": True, **info})


@app.get("/info")
def info():
    session = request.args.get("session", "PRE").upper()
    return jsonify(_session_info(session))


@app.get("/frame")
def frame():
    session   = request.args.get("session", "PRE").upper()
    frame_idx = int(request.args.get("frame", 0))
    img = _read_frame(session, frame_idx)
    if img is None:
        return Response("frame not readable", status=404)
    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return Response(buf.tobytes(), mimetype="image/jpeg",
                    headers={"Cache-Control": "no-store"})


@app.get("/predict")
def predict():
    session   = request.args.get("session", "PRE").upper()
    frame_idx = int(request.args.get("frame", 0))

    img = _read_frame(session, frame_idx)
    if img is None:
        return jsonify({"error": "frame not readable"}), 404

    h, w = img.shape[:2]
    detected = _get_fa().get_landmarks(_enhance_for_fan(img))

    if not detected:
        return jsonify({"landmarks": None, "face_count": 0, "width": w, "height": h})

    lms = detected[0]  # (68, 2) — 0-indexed, matching point IDs 36-59
    landmarks = {
        str(i): {"x": max(0.0, min(float(w), float(lms[i][0]))),
                 "y": max(0.0, min(float(h), float(lms[i][1])))}
        for i in range(36, 60)
    }
    return jsonify({"landmarks": landmarks, "face_count": len(detected), "width": w, "height": h})


# ── main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    host = os.environ.get("HOST", "localhost")
    port = int(os.environ.get("PORT", 5174))
    print(f"IS3 frame server  →  http://{host}:{port}")
    print(f"  Upload dir : {UPLOAD_DIR}")
    for s in ("PRE", "POST"):
        p = _is3_path(s)
        print(f"  {s}: {'✓ ' + str(p) if p else '— waiting for upload'}")
    print("  FAN model loaded lazily on first /predict call")
    app.run(host=host, port=port, debug=False, threaded=True)

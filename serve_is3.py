"""
Flask server: serves frames from IS3 thermal videos + FAN landmark prediction.

Endpoints:
  GET /info?session=PRE            → {total_frames, width, height, fps}
  GET /frame?session=PRE&frame=0   → JPEG image
  GET /predict?session=PRE&frame=0 → {landmarks: {id: {x,y}}, width, height}
                                      x,y are pixel coords; id is FAN 0-based (36-59)

Run locally:
  python emotion_picks/serve_is3.py

Deploy (Docker):
  THERMAL_BASE=/data/thermal docker compose up -d
"""

import os
import sys

# torch.compile on Windows requires MSVC (cl.exe); disable it to fall back to
# plain eager mode when running locally without Visual Studio installed.
# On Linux (Docker/Hetzner) GCC is present so this has no effect.
if sys.platform == "win32":
    os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")

import numpy as np
import cv2
from pathlib import Path
from flask import Flask, request, Response, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# In Docker: set THERMAL_BASE=/data/thermal (volume-mounted IS3 files)
_default = Path(__file__).parent.parent / "NEEMA_Day1-001" / "NEEMA_Day1" / "THERMAL"
_BASE    = Path(os.environ.get("THERMAL_BASE", str(_default)))

IS3_PATHS = {
    "PRE":  _BASE / "PRE"  / "IR_01678.IS3",
    "POST": _BASE / "POST" / "IR_01679.IS3",
}

_caps: dict[str, cv2.VideoCapture] = {}
_fa = None  # face_alignment model — loaded lazily on first /predict call


# ── helpers ───────────────────────────────────────────────────────────────────

def _cap(session: str) -> cv2.VideoCapture | None:
    if session not in _caps or not _caps[session].isOpened():
        path = IS3_PATHS.get(session)
        if path is None or not path.exists():
            return None
        _caps[session] = cv2.VideoCapture(str(path))
    return _caps[session]


def _read_frame(session: str, frame_idx: int) -> np.ndarray | None:
    cap = _cap(session)
    if cap is None:
        return None
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ret, img = cap.read()
    return img if ret else None


def _enhance_for_fan(bgr: np.ndarray) -> np.ndarray:
    """
    CLAHE-equalize each channel of the HOT-colormap thermal frame so FAN
    (trained on regular RGB faces) has better contrast gradients to work with.
    """
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    lab[:, :, 0] = clahe.apply(lab[:, :, 0])
    enhanced_bgr = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    return cv2.cvtColor(enhanced_bgr, cv2.COLOR_BGR2RGB)


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


# ── routes ────────────────────────────────────────────────────────────────────

@app.get("/info")
def info():
    session = request.args.get("session", "PRE").upper()
    cap = _cap(session)
    if cap is None:
        return jsonify({"error": "session not found"}), 404
    return jsonify({
        "total_frames": int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
        "width":        int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "height":       int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        "fps":          cap.get(cv2.CAP_PROP_FPS),
    })


@app.get("/frame")
def frame():
    session   = request.args.get("session", "PRE").upper()
    frame_idx = int(request.args.get("frame", 0))
    img = _read_frame(session, frame_idx)
    if img is None:
        return Response(f"frame {frame_idx} not readable", status=404)
    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return Response(buf.tobytes(), mimetype="image/jpeg",
                    headers={"Cache-Control": "no-store"})


@app.get("/predict")
def predict():
    """
    Run FAN on one frame and return the subset of 68-point landmarks
    that the picker uses (indices 36-59: eyes + outer mouth).

    Response:
      {
        "landmarks": { "36": {"x": 123.4, "y": 56.7}, ... },  // pixel coords
        "width": 640,
        "height": 480,
        "face_count": 1
      }
    On no detection:
      { "landmarks": null, "face_count": 0 }
    """
    session   = request.args.get("session", "PRE").upper()
    frame_idx = int(request.args.get("frame", 0))

    img = _read_frame(session, frame_idx)
    if img is None:
        return jsonify({"error": "frame not readable"}), 404

    h, w = img.shape[:2]
    rgb  = _enhance_for_fan(img)

    fa   = _get_fa()
    detected = fa.get_landmarks(rgb)   # list of (68,2) arrays, one per face

    if not detected:
        return jsonify({"landmarks": None, "face_count": 0, "width": w, "height": h})

    # Use first (largest) detected face; face_alignment returns closest to centre
    lms = detected[0]  # shape (68, 2)  — 0-indexed, matching our point IDs 36-59

    landmarks = {}
    for pt_id in range(36, 60):
        x, y = float(lms[pt_id][0]), float(lms[pt_id][1])
        # Clamp to frame bounds
        landmarks[str(pt_id)] = {
            "x": max(0.0, min(float(w), x)),
            "y": max(0.0, min(float(h), y)),
        }

    return jsonify({
        "landmarks":  landmarks,
        "face_count": len(detected),
        "width":  w,
        "height": h,
    })


# ── main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    host = os.environ.get("HOST", "localhost")
    port = int(os.environ.get("PORT", 5174))
    print(f"IS3 frame server  →  http://{host}:{port}")
    for s, p in IS3_PATHS.items():
        print(f"  {s}: {'✓' if p.exists() else '✗ NOT FOUND'}  {p}")
    print("  FAN model loaded lazily on first /predict call")
    app.run(host=host, port=port, debug=False, threaded=True)

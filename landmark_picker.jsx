import { useState, useRef, useEffect } from "react";

const SERVER   = "";
const SESSIONS = ["PRE", "POST"];
const MAX_HIST = 30;

// ── color palettes (per landmark group) ──────────────────────────────────────
const PALETTES = [
  { no: "#C97FDB", re: "#D85A30", le: "#378ADD", mo: "#1D9E75" },  // default
  { no: "#A8E6CF", re: "#FF6B6B", le: "#4ECDC4", mo: "#FFD93D" },  // pastel
  { no: "#8BC34A", re: "#FF6B00", le: "#0EA5E9", mo: "#E91E63" },  // vivid
  { no: "#FBBF24", re: "#F43F5E", le: "#38BDF8", mo: "#34D399" },  // neon
];

// ── UI themes ─────────────────────────────────────────────────────────────────
const THEMES = {
  dark: {
    bg: "#0d0d12", panel: "rgba(255,255,255,.06)", border: "rgba(128,128,128,.22)",
    text: "#e8e8e8", muted: "rgba(255,255,255,.4)", accent: "#5B3FE8", btn: "rgba(255,255,255,.09)",
  },
  light: {
    bg: "#f0f0f8", panel: "rgba(0,0,0,.05)", border: "rgba(0,0,0,.14)",
    text: "#1a1a2e", muted: "rgba(0,0,0,.45)", accent: "#4433cc", btn: "rgba(0,0,0,.07)",
  },
};

// ── landmark definitions ──────────────────────────────────────────────────────
const POINTS = [
  // Nose (FAN indices 31-35)
  { id: 31, g: "no", label: "Left alar base"  },
  { id: 32, g: "no", label: "Left nostril"    },
  { id: 33, g: "no", label: "Nose tip"        },
  { id: 34, g: "no", label: "Right nostril"   },
  { id: 35, g: "no", label: "Right alar base" },
  // Right eye (36-41)
  { id: 36, g: "re", label: "Lateral canthus" },
  { id: 37, g: "re", label: "Upper outer lid" },
  { id: 38, g: "re", label: "Upper inner lid" },
  { id: 39, g: "re", label: "Medial canthus"  },
  { id: 40, g: "re", label: "Lower inner lid" },
  { id: 41, g: "re", label: "Lower outer lid" },
  // Left eye (42-47)
  { id: 42, g: "le", label: "Medial canthus"  },
  { id: 43, g: "le", label: "Upper inner lid" },
  { id: 44, g: "le", label: "Upper outer lid" },
  { id: 45, g: "le", label: "Lateral canthus" },
  { id: 46, g: "le", label: "Lower outer lid" },
  { id: 47, g: "le", label: "Lower inner lid" },
  // Outer mouth (48-59)
  { id: 48, g: "mo", label: "Left corner"       },
  { id: 49, g: "mo", label: "Upper left outer"  },
  { id: 50, g: "mo", label: "Upper left"        },
  { id: 51, g: "mo", label: "Cupid bow left"    },
  { id: 52, g: "mo", label: "Cupid bow right"   },
  { id: 53, g: "mo", label: "Upper right"       },
  { id: 54, g: "mo", label: "Right corner"      },
  { id: 55, g: "mo", label: "Lower right outer" },
  { id: 56, g: "mo", label: "Lower right"       },
  { id: 57, g: "mo", label: "Lower center"      },
  { id: 58, g: "mo", label: "Lower left"        },
  { id: 59, g: "mo", label: "Lower left outer"  },
];

// poly: false → no connecting polygon drawn for that group
const GROUPS = [
  { id: "no", name: "Nose",        poly: false },
  { id: "re", name: "Right eye",   poly: true  },
  { id: "le", name: "Left eye",    poly: true  },
  { id: "mo", name: "Outer mouth", poly: true  },
];

const TOTAL      = POINTS.length;  // 29
const storageKey = (session, frame) => `lm24pts_${session}_${frame}`;

function uploadIS3(session, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
    };
    xhr.onload  = () => { try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("Bad response")); } };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.open("POST", `${SERVER}/upload?session=${session}`);
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

// ── component ─────────────────────────────────────────────────────────────────
export default function App() {
  // session / frame
  const [session,      setSession]  = useState("PRE");
  const [frameIdx,     setFrameIdx] = useState(0);
  const [totalFrames,  setTotal]    = useState(0);
  const [imgNatW,      setImgNatW]  = useState(640);
  const [imgNatH,      setImgNatH]  = useState(480);
  const [imgSrc,       setImgSrc]   = useState("");
  const [sessionReady, setReady]    = useState(false);

  // landmarks
  const [coords,    setCoords] = useState({});
  const [sel,       setSel]    = useState(POINTS[0].id);
  const [histLen,   setHistLen]= useState(0);

  // image rendering
  const [imgLoaded, setLoaded]  = useState(false);
  const [wrapSize,  setWrapSize]= useState({ w: 0, h: 0 });
  const [copied,    setCopied]  = useState(false);

  // FAN
  const [autoDetect, setAutoDetect] = useState(true);
  const [detecting,  setDetecting]  = useState(false);
  const [fanMsg,     setFanMsg]     = useState("");

  // upload
  const [uploadState, setUploadState] = useState({ PRE: null, POST: null });
  const [dragOver,    setDragOver]    = useState(false);

  // CSV auto-save
  const [csvRows, setCsvRows] = useState(0);

  // view
  const [zoom, setZoom] = useState(1);
  const [pan,  setPan]  = useState({ x: 0, y: 0 });

  // appearance (persisted)
  const [theme,      setTheme]      = useState(() => localStorage.getItem("lm_theme") || "dark");
  const [paletteIdx, setPaletteIdx] = useState(() => parseInt(localStorage.getItem("lm_pal") || "0"));

  useEffect(() => { localStorage.setItem("lm_theme", theme); },      [theme]);
  useEffect(() => { localStorage.setItem("lm_pal",   paletteIdx); }, [paletteIdx]);

  // refs
  const fileInputRef = useRef(null);
  const imgRef       = useRef(null);
  const wrapRef      = useRef(null);
  const histRef      = useRef([]);
  const saveToCsvRef = useRef(null);
  const zoomRef      = useRef(1);
  const panRef       = useRef({ x: 0, y: 0 });
  const dragRef      = useRef({ active: false, moved: false, startX: 0, startY: 0, startPan: { x: 0, y: 0 } });

  // keep refs in sync (wheel handler reads from refs to avoid stale closures)
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current  = pan;  }, [pan]);

  // ── derived ──────────────────────────────────────────────────────────────────
  const T       = THEMES[theme];
  const palette = PALETTES[paletteIdx];
  const placed  = Object.keys(coords).length;
  const selPt   = POINTS.find(p => p.id === sel);
  const sx      = nx => nx * wrapSize.w;
  const sy      = ny => ny * wrapSize.h;
  const upState = uploadState[session];

  // ── CSV auto-save (fire-and-forget; also updates row counter) ────────────────
  const saveToCsv = (c, sess = session, fi = frameIdx) => {
    const lms = {};
    POINTS.forEach(p => { if (c[p.id]) lms[p.id] = c[p.id]; });
    fetch(`${SERVER}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: sess, frame: fi, landmarks: lms }),
    })
      .then(r => r.json())
      .then(d => { if (typeof d.total_frames_saved === "number") setCsvRows(d.total_frames_saved); })
      .catch(() => {});
  };
  saveToCsvRef.current = saveToCsv;

  // ── view helpers ─────────────────────────────────────────────────────────────
  const resetView = () => {
    setZoom(1); zoomRef.current = 1;
    setPan({ x: 0, y: 0 }); panRef.current = { x: 0, y: 0 };
  };

  const changeZoom = newZ => {
    newZ = Math.min(Math.max(newZ, 1), 6);
    if (newZ <= 1.01) { resetView(); return; }
    setZoom(newZ); zoomRef.current = newZ;
  };

  // ── history helpers ───────────────────────────────────────────────────────────
  const applyCoords = (next, sess = session, fi = frameIdx) => {
    histRef.current = [...histRef.current.slice(-(MAX_HIST - 1)), coords];
    setHistLen(histRef.current.length);
    setCoords(next);
    try { localStorage.setItem(storageKey(sess, fi), JSON.stringify(next)); } catch {}
    saveToCsv(next, sess, fi);
  };

  const undo = () => {
    if (!histRef.current.length) return;
    const prev = histRef.current.at(-1);
    histRef.current = histRef.current.slice(0, -1);
    setHistLen(histRef.current.length);
    setCoords(prev);
    try { localStorage.setItem(storageKey(session, frameIdx), JSON.stringify(prev)); } catch {}
    saveToCsv(prev);
  };

  // ── session info ──────────────────────────────────────────────────────────────
  const fetchInfo = sess => {
    fetch(`${SERVER}/info?session=${sess}`)
      .then(r => r.json())
      .then(d => {
        setReady(!!d.ready);
        setTotal(d.total_frames || 0);
        if (d.width)  setImgNatW(d.width);
        if (d.height) setImgNatH(d.height);
      })
      .catch(() => setReady(false));
  };

  useEffect(() => { fetchInfo(session); }, [session]);

  // ── image URL ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionReady) return;
    setLoaded(false);
    setImgSrc(`${SERVER}/frame?session=${session}&frame=${frameIdx}&_t=${Date.now()}`);
  }, [session, frameIdx, sessionReady]);

  // ── load stored coords on frame/session switch ────────────────────────────────
  useEffect(() => {
    histRef.current = [];
    setHistLen(0);
    setFanMsg("");
    try {
      const saved = localStorage.getItem(storageKey(session, frameIdx));
      setCoords(saved ? JSON.parse(saved) : {});
    } catch { setCoords({}); }
  }, [session, frameIdx]);

  // ── auto-detect on load (if no saved coords) ──────────────────────────────────
  useEffect(() => {
    if (!autoDetect || !imgLoaded) return;
    if (!localStorage.getItem(storageKey(session, frameIdx))) detectFace();
  }, [imgLoaded]); // eslint-disable-line

  // ── resize observer ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!wrapRef.current || !imgLoaded) return;
    const ro = new ResizeObserver(() => {
      if (imgRef.current)
        setWrapSize({ w: imgRef.current.offsetWidth, h: imgRef.current.offsetHeight });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [imgLoaded]);

  // ── keyboard: arrows + Ctrl-Z ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      if (e.target.tagName === "INPUT") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (!histRef.current.length) return;
        const prev = histRef.current.at(-1);
        histRef.current = histRef.current.slice(0, -1);
        setHistLen(histRef.current.length);
        setCoords(prev);
        try { localStorage.setItem(storageKey(session, frameIdx), JSON.stringify(prev)); } catch {}
        saveToCsvRef.current?.(prev, session, frameIdx);
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowRight") setFrameIdx(f => Math.min(f + step, totalFrames - 1));
      if (e.key === "ArrowLeft")  setFrameIdx(f => Math.max(f - step, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [totalFrames, session, frameIdx]);

  // ── scroll-to-zoom (non-passive, registered once, reads from refs) ────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const handler = e => {
      e.preventDefault();
      const z = zoomRef.current, p = panRef.current;
      const rect = el.getBoundingClientRect();
      const cx = (e.clientX - rect.left)  - rect.width  / 2;
      const cy = (e.clientY - rect.top)   - rect.height / 2;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newZ = Math.min(Math.max(z * factor, 1), 6);
      if (newZ <= 1.01) {
        setZoom(1); zoomRef.current = 1;
        setPan({ x: 0, y: 0 }); panRef.current = { x: 0, y: 0 };
        return;
      }
      const newP = {
        x: cx - newZ * (cx - p.x) / z,
        y: cy - newZ * (cy - p.y) / z,
      };
      setZoom(newZ); zoomRef.current = newZ;
      setPan(newP);  panRef.current  = newP;
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []); // runs once — reads via refs

  // ── FAN detection ─────────────────────────────────────────────────────────────
  const detectFace = async () => {
    setDetecting(true); setFanMsg("Detecting…");
    try {
      const d = await fetch(`${SERVER}/predict?session=${session}&frame=${frameIdx}`).then(r => r.json());
      if (!d.landmarks) { setFanMsg("No face detected — place points manually"); return; }
      const norm = {};
      Object.entries(d.landmarks).forEach(([id, { x, y }]) => {
        norm[parseInt(id)] = { x: x / d.width, y: y / d.height };
      });
      // push current coords to history before overwriting
      histRef.current = [...histRef.current.slice(-(MAX_HIST - 1)), coords];
      setHistLen(histRef.current.length);
      setCoords(norm);
      try { localStorage.setItem(storageKey(session, frameIdx), JSON.stringify(norm)); } catch {}
      saveToCsv(norm);
      setSel(POINTS[0].id);
      setFanMsg(`FAN placed ${Object.keys(norm).length} pts — click any to correct`);
    } catch {
      setFanMsg("Detection error");
    } finally {
      setDetecting(false);
    }
  };

  // ── upload ────────────────────────────────────────────────────────────────────
  const handleUpload = async (sess, file) => {
    if (!file) return;
    setUploadState(s => ({ ...s, [sess]: 0 }));
    try {
      const d = await uploadIS3(sess, file, pct => setUploadState(s => ({ ...s, [sess]: pct })));
      if (d.ok) {
        setUploadState(s => ({ ...s, [sess]: null }));
        setReady(true); setTotal(d.total_frames);
        setImgNatW(d.width); setImgNatH(d.height); setFrameIdx(0);
      } else {
        setUploadState(s => ({ ...s, [sess]: "error" }));
      }
    } catch { setUploadState(s => ({ ...s, [sess]: "error" })); }
  };

  const onFileInput = e => { handleUpload(session, e.target.files?.[0]); e.target.value = ""; };
  const onDrop = e => { e.preventDefault(); setDragOver(false); handleUpload(session, e.dataTransfer.files?.[0]); };

  // ── pan drag ──────────────────────────────────────────────────────────────────
  const onMouseDown = e => {
    if (e.button !== 0) return;
    dragRef.current = { active: true, moved: false,
      startX: e.clientX, startY: e.clientY, startPan: { ...panRef.current } };
  };
  const onMouseMove = e => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (!dragRef.current.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3))
      dragRef.current.moved = true;
    if (dragRef.current.moved && zoomRef.current > 1) {
      const newP = { x: dragRef.current.startPan.x + dx, y: dragRef.current.startPan.y + dy };
      setPan(newP); panRef.current = newP;
    }
  };
  const onMouseUp = () => { dragRef.current.active = false; };

  // ── landmark placement ────────────────────────────────────────────────────────
  const handleClick = e => {
    if (dragRef.current.moved) { dragRef.current.moved = false; return; }
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top)  / rect.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    const next = { ...coords, [sel]: { x: nx, y: ny } };
    applyCoords(next);
    const idx = POINTS.findIndex(p => p.id === sel);
    for (let i = 1; i <= POINTS.length; i++) {
      const p = POINTS[(idx + i) % POINTS.length];
      if (!next[p.id]) { setSel(p.id); return; }
    }
  };

  const del = (id, e) => {
    e?.stopPropagation();
    const next = { ...coords }; delete next[id];
    applyCoords(next); setSel(id);
  };

  const reset = () => { applyCoords({}); setSel(POINTS[0].id); setFanMsg(""); };

  // ── export ────────────────────────────────────────────────────────────────────
  const exportJSON = () => {
    const grpName = g => GROUPS.find(x => x.id === g)?.name || g;
    const out = {};
    POINTS.forEach(p => {
      if (coords[p.id]) out[p.id] = {
        label: p.label, group: grpName(p.g),
        x: Math.round(coords[p.id].x * imgNatW),
        y: Math.round(coords[p.id].y * imgNatH),
      };
    });
    const str = JSON.stringify({ session, frame: frameIdx, landmarks: out }, null, 2);
    navigator.clipboard?.writeText(str)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => {});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([str], { type: "application/json" }));
    a.download = `landmarks_${session}_f${String(frameIdx).padStart(4, "0")}.json`;
    a.click();
  };

  // ── group polygon ─────────────────────────────────────────────────────────────
  const groupPoly = gid => {
    const g = GROUPS.find(x => x.id === gid);
    if (!g?.poly) return null;
    const pts = POINTS.filter(p => p.g === gid && coords[p.id]);
    return pts.length < 2
      ? null
      : pts.map(p => `${sx(coords[p.id].x)},${sy(coords[p.id].y)}`).join(" ");
  };

  // ── shared button style ───────────────────────────────────────────────────────
  const btnStyle = (extra = {}) => ({
    fontSize: 12, padding: "3px 10px", borderRadius: 6, cursor: "pointer",
    background: T.btn, border: `1px solid ${T.border}`, color: T.text, ...extra,
  });

  // ── upload zone ───────────────────────────────────────────────────────────────
  const UploadZone = (
    <div
      onDrop={onDrop}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onClick={() => upState === null && fileInputRef.current?.click()}
      style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: 280, borderRadius: 10,
        border: `2px dashed ${dragOver ? T.accent : T.border}`,
        background: dragOver ? T.accent + "12" : T.panel,
        cursor: upState === null ? "pointer" : "default", gap: 12,
      }}>
      {upState === null && <>
        <div style={{ fontSize: 36 }}>⬆</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>Upload {session} IS3 file</div>
        <div style={{ fontSize: 12, color: T.muted, textAlign: "center", maxWidth: 240 }}>
          Click or drag your FLIR .IS3 thermal video here
        </div>
      </>}
      {typeof upState === "number" && <>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Uploading {session}… {upState}%</div>
        <div style={{ width: 220, height: 5, background: T.border, borderRadius: 3 }}>
          <div style={{ width: `${upState}%`, height: "100%", background: T.accent,
            borderRadius: 3, transition: "width .1s" }} />
        </div>
        <div style={{ fontSize: 11, color: T.muted }}>Do not close this page</div>
      </>}
      {upState === "error" && <>
        <div style={{ fontSize: 13, color: "#e55", fontWeight: 600 }}>Upload failed</div>
        <button onClick={e => { e.stopPropagation(); setUploadState(s => ({ ...s, [session]: null })); }}
          style={btnStyle()}>Try again</button>
      </>}
      <input ref={fileInputRef} type="file" accept=".IS3,.is3"
        style={{ display: "none" }} onChange={onFileInput} />
    </div>
  );

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "system-ui,sans-serif", color: T.text, backgroundColor: T.bg,
                  padding: "12px 16px", minHeight: "100vh", userSelect: "none" }}>

      {/* ── session tabs + appearance controls ───────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {SESSIONS.map(s => (
          <button key={s} onClick={() => { setSession(s); setFrameIdx(0); }}
            style={{ fontSize: 12, fontWeight: 600, padding: "4px 16px", borderRadius: 6,
              background: session === s ? T.accent : T.btn, color: session === s ? "#fff" : T.text,
              border: `1px solid ${T.border}`, cursor: "pointer" }}>
            {s}
          </button>
        ))}
        {sessionReady && (
          <span style={{ fontSize: 11, color: T.muted, marginLeft: 4 }}>
            {imgNatW}×{imgNatH} · {totalFrames} frames
          </span>
        )}

        {/* palette + theme, pushed to right */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: T.muted }}>palette</span>
          {PALETTES.map((p, i) => (
            <button key={i} onClick={() => setPaletteIdx(i)} title={`Palette ${i + 1}`}
              style={{ width: 16, height: 16, borderRadius: "50%", padding: 0, cursor: "pointer",
                background: `linear-gradient(135deg, ${p.re} 0%, ${p.le} 50%, ${p.mo} 100%)`,
                border: i === paletteIdx ? `2px solid ${T.text}` : `2px solid transparent`,
                outline: "none" }} />
          ))}
          <button onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
            title="Toggle theme"
            style={{ ...btnStyle(), marginLeft: 4, fontSize: 13, padding: "2px 7px" }}>
            {theme === "dark" ? "☀" : "☽"}
          </button>
        </div>

        {sessionReady && (
          <>
            <button onClick={() => fileInputRef.current?.click()} style={{ ...btnStyle(), opacity: .55 }}>
              ↩ Replace file
            </button>
            <input ref={fileInputRef} type="file" accept=".IS3,.is3"
              style={{ display: "none" }} onChange={onFileInput} />
          </>
        )}
      </div>

      {!sessionReady ? (
        <div style={{ display: "flex", gap: 10 }}>
          {UploadZone}
          <div style={{ width: 180, flexShrink: 0 }} />
        </div>
      ) : (
        <>
          {/* ── frame slider ─────────────────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <button onClick={() => setFrameIdx(f => Math.max(f - 1, 0))} style={btnStyle({ padding: "2px 8px" })}>◀</button>
            <input type="range" min={0} max={Math.max(0, totalFrames - 1)} value={frameIdx}
              onChange={e => setFrameIdx(Number(e.target.value))} style={{ flex: 1, accentColor: T.accent }} />
            <button onClick={() => setFrameIdx(f => Math.min(f + 1, totalFrames - 1))} style={btnStyle({ padding: "2px 8px" })}>▶</button>
            <span style={{ fontSize: 12, fontFamily: "monospace", minWidth: 82,
              textAlign: "right", color: T.muted }}>
              {frameIdx} / {totalFrames - 1}
            </span>
          </div>

          {/* ── FAN + zoom toolbar ────────────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10,
            padding: "7px 12px", background: T.panel, borderRadius: 8,
            border: `1px solid ${T.border}`, flexWrap: "wrap" }}>

            {/* FAN */}
            <button onClick={detectFace} disabled={detecting}
              style={{ ...btnStyle(), fontWeight: 600, padding: "4px 14px",
                background: detecting ? T.btn : T.accent, color: "#fff",
                border: "none", minWidth: 110, cursor: detecting ? "default" : "pointer" }}>
              {detecting ? "Detecting…" : "⚡ Re-detect"}
            </button>

            <label style={{ display: "flex", alignItems: "center", gap: 5,
              fontSize: 11, cursor: "pointer", color: T.muted }}>
              <input type="checkbox" checked={autoDetect}
                onChange={e => setAutoDetect(e.target.checked)}
                style={{ accentColor: T.accent }} />
              auto on new frames
            </label>

            {fanMsg && <span style={{ fontSize: 11, color: T.muted }}>{fanMsg}</span>}

            {/* zoom controls */}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
              <button onClick={() => changeZoom(zoom / 1.4)} style={btnStyle({ padding: "2px 8px", fontWeight: 700 })}>−</button>
              <span style={{ fontSize: 11, minWidth: 40, textAlign: "center",
                fontFamily: "monospace", color: T.muted }}>
                {Math.round(zoom * 100)}%
              </span>
              <button onClick={() => changeZoom(zoom * 1.4)} style={btnStyle({ padding: "2px 8px", fontWeight: 700 })}>+</button>
              <button onClick={resetView} disabled={zoom === 1}
                style={{ ...btnStyle({ padding: "2px 8px", fontSize: 10 }), opacity: zoom === 1 ? .3 : .7 }}>
                1:1
              </button>
            </div>
          </div>

          {/* ── header: title + undo / reset / export ────────────────────────── */}
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "center", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Landmark picker</span>
              <span style={{
                background: placed === TOTAL ? "#1D9E75" : T.panel,
                color: placed === TOTAL ? "#fff" : T.text,
                fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 500 }}>
                {placed}/{TOTAL}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button onClick={undo} disabled={histLen === 0}
                style={{ ...btnStyle(), opacity: histLen === 0 ? .3 : 1 }}
                title="Ctrl+Z">
                ↩ Undo
              </button>
              <button onClick={reset} style={btnStyle()}>Reset</button>
              <button onClick={exportJSON} disabled={placed === 0} style={btnStyle()}>
                {copied ? "Copied ✓" : "Export JSON ↓"}
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 4,
                borderLeft: `1px solid ${T.border}`, paddingLeft: 10 }}>
                {csvRows > 0 && (
                  <span style={{ fontSize: 10, color: T.muted }}>
                    {csvRows} row{csvRows !== 1 ? "s" : ""} saved
                  </span>
                )}
                <button
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = `${SERVER}/export?session=${session}`;
                    a.download = `${session}_landmarks.csv`;
                    a.click();
                  }}
                  disabled={csvRows === 0}
                  title="Download all saved landmarks as CSV"
                  style={{ ...btnStyle({ fontWeight: 600 }),
                    background: csvRows > 0 ? T.accent : T.btn,
                    color: csvRows > 0 ? "#fff" : T.muted,
                    border: "none", opacity: csvRows === 0 ? .4 : 1 }}>
                  ⏹ End & CSV
                </button>
              </div>
            </div>
          </div>

          {/* progress bar */}
          <div style={{ height: 3, background: T.border, borderRadius: 2, marginBottom: 10 }}>
            <div style={{ height: "100%", width: `${(placed / TOTAL) * 100}%`,
              background: selPt ? palette[selPt.g] : T.accent,
              borderRadius: 2, transition: "width .25s" }} />
          </div>

          {/* active point hint */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px",
            background: T.panel, borderRadius: 8, marginBottom: 10, fontSize: 12,
            border: `1.5px solid ${selPt ? palette[selPt.g] + "40" : T.border}` }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%",
              background: selPt ? palette[selPt.g] : T.muted, flexShrink: 0,
              boxShadow: selPt ? `0 0 0 3px ${palette[selPt.g]}30` : "none" }} />
            <span style={{ color: T.muted }}>Select point → click image to correct</span>
            {selPt && (
              <span style={{ fontWeight: 600, color: palette[selPt.g] }}>
                pt {sel} · {selPt.label}
              </span>
            )}
            {selPt && coords[sel] && (
              <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 11, color: T.muted }}>
                ({Math.round(coords[sel].x * imgNatW)}, {Math.round(coords[sel].y * imgNatH)})
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>

            {/* ── image canvas ────────────────────────────────────────────────── */}
            <div ref={wrapRef}
              style={{ flex: 1, position: "relative", overflow: "hidden",
                cursor: zoom > 1 ? "grab" : "crosshair",
                borderRadius: 8, background: "#111" }}
              onMouseDown={onMouseDown} onMouseMove={onMouseMove}
              onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
              onClick={handleClick}>

              {/* zoom + pan transform wrapper */}
              <div style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "50% 50%",
                lineHeight: 0,
              }}>
                {imgSrc && (
                  <img ref={imgRef} src={imgSrc} alt={`${session} frame ${frameIdx}`}
                    style={{ width: "100%", display: "block" }} draggable={false}
                    onLoad={() => {
                      setLoaded(true);
                      setWrapSize({ w: imgRef.current.offsetWidth, h: imgRef.current.offsetHeight });
                    }} />
                )}

                {/* detecting overlay */}
                {detecting && (
                  <div style={{ position: "absolute", inset: 0, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    background: "rgba(0,0,0,.5)", borderRadius: 8 }}>
                    <span style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>⚡ Detecting face…</span>
                  </div>
                )}

                {/* SVG overlay */}
                {imgLoaded && wrapSize.w > 0 && !detecting && (
                  <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
                    pointerEvents: "none" }}>

                    {GROUPS.map(g => {
                      const poly = groupPoly(g.id);
                      return poly ? (
                        <polygon key={g.id} points={poly}
                          fill={palette[g.id] + "18"} stroke={palette[g.id]}
                          strokeWidth="1.5" strokeLinejoin="round" />
                      ) : null;
                    })}

                    {POINTS.map(pt => {
                      if (!coords[pt.id]) return null;
                      const cx = sx(coords[pt.id].x), cy = sy(coords[pt.id].y);
                      const isSel = pt.id === sel;
                      const col   = palette[pt.g];
                      return (
                        <g key={pt.id}>
                          {isSel && (
                            <circle cx={cx} cy={cy} r="13" fill="none" stroke={col}
                              strokeWidth="1.5" strokeDasharray="3,2" opacity=".9" />
                          )}
                          <circle cx={cx} cy={cy} r={isSel ? 7 : 5} fill={col}
                            stroke="rgba(255,255,255,.85)" strokeWidth="1.5" />
                          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                            style={{ fontSize: "8px", fill: "#fff", fontWeight: 700,
                              fontFamily: "monospace", pointerEvents: "none" }}>
                            {pt.id}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                )}
              </div>
            </div>

            {/* ── sidebar ─────────────────────────────────────────────────────── */}
            <div style={{ width: 180, flexShrink: 0, overflowY: "auto", maxHeight: 540 }}>
              {GROUPS.map(g => {
                const gpts = POINTS.filter(p => p.g === g.id);
                const gp   = gpts.filter(p => coords[p.id]).length;
                return (
                  <div key={g.id} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: palette[g.id],
                      padding: "3px 4px", display: "flex", justifyContent: "space-between",
                      letterSpacing: .3 }}>
                      <span>{g.name}</span>
                      <span style={{ opacity: .7 }}>{gp}/{gpts.length}</span>
                    </div>
                    {gpts.map(pt => {
                      const isConf = !!coords[pt.id];
                      const isSel  = sel === pt.id;
                      const col    = palette[pt.g];
                      return (
                        <div key={pt.id} onClick={() => setSel(pt.id)}
                          style={{ display: "flex", alignItems: "center", gap: 5,
                            padding: "3px 6px", borderRadius: 5, cursor: "pointer", marginBottom: 1,
                            background: isSel ? col + "20" : "transparent",
                            border: `1px solid ${isSel ? col + "80" : "transparent"}`,
                            fontSize: 11 }}>
                          <span style={{ width: 7, height: 7, borderRadius: "50%",
                            background: isConf ? col : T.border, flexShrink: 0 }} />
                          <span style={{ color: isConf ? col : T.muted, fontWeight: 600, minWidth: 22 }}>
                            {pt.id}
                          </span>
                          <span style={{ color: T.muted, fontSize: 10, flex: 1,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {pt.label}
                          </span>
                          {isConf && (
                            <span onClick={e => del(pt.id, e)}
                              style={{ color: T.muted, cursor: "pointer", fontSize: 14,
                                padding: "0 2px", lineHeight: 1 }}>×</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <div style={{ marginTop: 8, padding: "6px 8px", background: T.panel,
                borderRadius: 6, fontSize: 10, color: T.muted, lineHeight: 1.7 }}>
                FAN auto-places all {TOTAL} pts.<br />
                Scroll to zoom · drag to pan.<br />
                Ctrl+Z undo · ← → navigate<br />
                Shift+← → jump ±10 frames
              </div>
            </div>
          </div>

          {/* ── coord table ─────────────────────────────────────────────────────── */}
          {placed > 0 && (
            <div style={{ marginTop: 10, padding: "8px 12px", background: T.panel,
              borderRadius: 8, fontSize: 11 }}>
              <div style={{ fontWeight: 600, marginBottom: 5, color: T.muted,
                fontSize: 10, letterSpacing: .3 }}>
                {session} · frame {frameIdx} · {imgNatW}×{imgNatH}px
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 12px" }}>
                {POINTS.filter(p => coords[p.id]).map(p => (
                  <span key={p.id} style={{ fontFamily: "monospace", color: palette[p.g], fontSize: 10 }}>
                    {p.id}: ({Math.round(coords[p.id].x * imgNatW)}, {Math.round(coords[p.id].y * imgNatH)})
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

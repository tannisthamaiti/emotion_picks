import { useState, useRef, useEffect, useCallback } from "react";

const SERVER   = "";          // relative — Nginx proxies /frame /info /predict to Flask
const SESSIONS = ["PRE", "POST"];

const POINTS = [
  { id: 36, g: "re", label: "Lateral canthus",  color: "#D85A30", gname: "Right eye" },
  { id: 37, g: "re", label: "Upper outer lid",   color: "#D85A30", gname: "Right eye" },
  { id: 38, g: "re", label: "Upper inner lid",   color: "#D85A30", gname: "Right eye" },
  { id: 39, g: "re", label: "Medial canthus",    color: "#D85A30", gname: "Right eye" },
  { id: 40, g: "re", label: "Lower inner lid",   color: "#D85A30", gname: "Right eye" },
  { id: 41, g: "re", label: "Lower outer lid",   color: "#D85A30", gname: "Right eye" },
  { id: 42, g: "le", label: "Medial canthus",    color: "#378ADD", gname: "Left eye" },
  { id: 43, g: "le", label: "Upper inner lid",   color: "#378ADD", gname: "Left eye" },
  { id: 44, g: "le", label: "Upper outer lid",   color: "#378ADD", gname: "Left eye" },
  { id: 45, g: "le", label: "Lateral canthus",   color: "#378ADD", gname: "Left eye" },
  { id: 46, g: "le", label: "Lower outer lid",   color: "#378ADD", gname: "Left eye" },
  { id: 47, g: "le", label: "Lower inner lid",   color: "#378ADD", gname: "Left eye" },
  { id: 48, g: "mo", label: "Left corner",        color: "#1D9E75", gname: "Outer mouth" },
  { id: 49, g: "mo", label: "Upper left outer",   color: "#1D9E75", gname: "Outer mouth" },
  { id: 50, g: "mo", label: "Upper left",          color: "#1D9E75", gname: "Outer mouth" },
  { id: 51, g: "mo", label: "Cupid bow left",      color: "#1D9E75", gname: "Outer mouth" },
  { id: 52, g: "mo", label: "Cupid bow right",     color: "#1D9E75", gname: "Outer mouth" },
  { id: 53, g: "mo", label: "Upper right",          color: "#1D9E75", gname: "Outer mouth" },
  { id: 54, g: "mo", label: "Right corner",         color: "#1D9E75", gname: "Outer mouth" },
  { id: 55, g: "mo", label: "Lower right outer",   color: "#1D9E75", gname: "Outer mouth" },
  { id: 56, g: "mo", label: "Lower right",          color: "#1D9E75", gname: "Outer mouth" },
  { id: 57, g: "mo", label: "Lower center",         color: "#1D9E75", gname: "Outer mouth" },
  { id: 58, g: "mo", label: "Lower left",           color: "#1D9E75", gname: "Outer mouth" },
  { id: 59, g: "mo", label: "Lower left outer",    color: "#1D9E75", gname: "Outer mouth" },
];

const GROUPS = [
  { id: "re", name: "Right eye",   color: "#D85A30" },
  { id: "le", name: "Left eye",    color: "#378ADD" },
  { id: "mo", name: "Outer mouth", color: "#1D9E75" },
];

const storageKey = (session, frame) => `lm24pts_${session}_${frame}`;

export default function App() {
  // ── session / frame ──────────────────────────────────────────────────────
  const [session,     setSession]   = useState("PRE");
  const [frameIdx,    setFrameIdx]  = useState(0);
  const [totalFrames, setTotal]     = useState(1);
  const [imgNatW,     setImgNatW]   = useState(640);
  const [imgNatH,     setImgNatH]   = useState(480);
  const [imgSrc,      setImgSrc]    = useState("");

  // ── landmark state ───────────────────────────────────────────────────────
  const [coords,      setCoords]    = useState({});   // confirmed picks  {id: {x,y} normalised}
  const [suggestions, setSugg]      = useState({});   // FAN predictions  {id: {x,y} normalised}
  const [sel,         setSel]       = useState(36);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [imgLoaded,   setLoaded]    = useState(false);
  const [wrapSize,    setWrapSize]  = useState({ w: 0, h: 0 });
  const [copied,      setCopied]    = useState(false);
  const [serverErr,   setServerErr] = useState(false);
  const [detecting,   setDetecting] = useState(false);
  const [fanMsg,      setFanMsg]    = useState("");   // "3 faces" | "no face" | ""
  const [autoDetect,  setAutoDetect]= useState(false);

  const imgRef  = useRef(null);
  const wrapRef = useRef(null);

  // ── fetch session info ────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${SERVER}/info?session=${session}`)
      .then(r => r.json())
      .then(d => { setTotal(d.total_frames); setImgNatW(d.width); setImgNatH(d.height); setServerErr(false); })
      .catch(() => setServerErr(true));
  }, [session]);

  // ── build image URL ───────────────────────────────────────────────────────
  useEffect(() => {
    setLoaded(false);
    setImgSrc(`${SERVER}/frame?session=${session}&frame=${frameIdx}&_t=${Date.now()}`);
  }, [session, frameIdx]);

  // ── load stored coords + clear suggestions on frame/session switch ────────
  useEffect(() => {
    setSugg({});
    setFanMsg("");
    const key = storageKey(session, frameIdx);
    try {
      const saved = localStorage.getItem(key);
      setCoords(saved ? JSON.parse(saved) : {});
    } catch { setCoords({}); }
  }, [session, frameIdx]);

  // ── auto-detect when flag is on ───────────────────────────────────────────
  useEffect(() => {
    if (autoDetect && imgLoaded) detectFace();
  }, [imgLoaded, autoDetect]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!wrapRef.current || !imgLoaded) return;
    const ro = new ResizeObserver(() => {
      if (imgRef.current)
        setWrapSize({ w: imgRef.current.offsetWidth, h: imgRef.current.offsetHeight });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [imgLoaded]);

  // ── keyboard: arrow keys for frame navigation ─────────────────────────────
  useEffect(() => {
    const onKey = e => {
      if (e.target.tagName === "INPUT") return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowRight") setFrameIdx(f => Math.min(f + step, totalFrames - 1));
      if (e.key === "ArrowLeft")  setFrameIdx(f => Math.max(f - step, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [totalFrames]);

  // ── persistence ───────────────────────────────────────────────────────────
  const persist = useCallback((c, sess = session, fi = frameIdx) => {
    try { localStorage.setItem(storageKey(sess, fi), JSON.stringify(c)); } catch {}
  }, [session, frameIdx]);

  // ── FAN detection ─────────────────────────────────────────────────────────
  const detectFace = async () => {
    setDetecting(true);
    setFanMsg("");
    try {
      const r = await fetch(`${SERVER}/predict?session=${session}&frame=${frameIdx}`);
      const d = await r.json();
      if (!d.landmarks) {
        setSugg({});
        setFanMsg("No face detected");
        return;
      }
      const norm = {};
      Object.entries(d.landmarks).forEach(([id, { x, y }]) => {
        norm[parseInt(id)] = { x: x / d.width, y: y / d.height };
      });
      setSugg(norm);
      setFanMsg(`${d.face_count} face${d.face_count !== 1 ? "s" : ""} detected — ${Object.keys(norm).length} pts suggested`);
      setServerErr(false);
    } catch {
      setServerErr(true);
    } finally {
      setDetecting(false);
    }
  };

  // Accept all unconfirmed suggestions
  const acceptAll = () => {
    const next = { ...coords };
    Object.entries(suggestions).forEach(([id, pos]) => {
      if (!next[parseInt(id)]) next[parseInt(id)] = pos;
    });
    setCoords(next); persist(next); setSugg({});
  };

  // Accept one suggestion by pt id
  const acceptOne = id => {
    if (!suggestions[id]) return;
    const next = { ...coords, [id]: suggestions[id] };
    setCoords(next); persist(next);
    setSugg(s => { const n = { ...s }; delete n[id]; return n; });
  };

  // ── landmark placement ────────────────────────────────────────────────────
  const handleClick = e => {
    const rect = imgRef.current.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top)  / rect.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    const next = { ...coords, [sel]: { x: nx, y: ny } };
    setCoords(next); persist(next);
    // advance to next unplaced point
    const idx = POINTS.findIndex(p => p.id === sel);
    for (let i = 1; i <= POINTS.length; i++) {
      const p = POINTS[(idx + i) % POINTS.length];
      if (!next[p.id]) { setSel(p.id); return; }
    }
  };

  const del = (id, e) => {
    e?.stopPropagation();
    const next = { ...coords }; delete next[id];
    setCoords(next); persist(next); setSel(id);
  };

  const reset = () => { setCoords({}); persist({}); setSugg({}); setSel(36); };

  // ── export ────────────────────────────────────────────────────────────────
  const exportJSON = () => {
    const out = {};
    POINTS.forEach(p => {
      if (coords[p.id]) out[p.id] = {
        label: p.label, group: p.gname,
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

  // ── derived ───────────────────────────────────────────────────────────────
  const placed   = Object.keys(coords).length;
  const pending  = Object.keys(suggestions).filter(id => !coords[parseInt(id)]).length;
  const selPt    = POINTS.find(p => p.id === sel);
  const sx = nx => nx * wrapSize.w;
  const sy = ny => ny * wrapSize.h;

  const groupPoly = g => {
    const pts = POINTS.filter(p => p.g === g && coords[p.id]);
    return pts.length < 2
      ? null
      : pts.map(p => `${sx(coords[p.id].x)},${sy(coords[p.id].y)}`).join(" ");
  };

  const Z = { fontFamily: "system-ui,sans-serif", color: "var(--color-text-primary,#e8e8e8)", userSelect: "none" };

  return (
    <div style={{ ...Z, padding: "12px 0" }}>

      {/* ── session tabs ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        {SESSIONS.map(s => (
          <button key={s} onClick={() => { setSession(s); setFrameIdx(0); }}
            style={{ fontSize: 12, fontWeight: 600, padding: "3px 14px", borderRadius: 6,
              background: session === s ? "#378ADD" : "rgba(128,128,128,.12)",
              color: session === s ? "#fff" : "inherit", border: "none", cursor: "pointer" }}>
            {s}
          </button>
        ))}
        <span style={{ fontSize: 11, opacity: .45, marginLeft: 4 }}>
          {imgNatW}×{imgNatH} · {totalFrames} frames · 9 fps
        </span>
        {serverErr && (
          <span style={{ fontSize: 11, color: "#e55", marginLeft: "auto" }}>
            ⚠ Server not reachable
          </span>
        )}
      </div>

      {/* ── frame slider ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <button onClick={() => setFrameIdx(f => Math.max(f - 1, 0))}
          style={{ fontSize: 12, padding: "2px 8px" }}>◀</button>
        <input type="range" min={0} max={Math.max(0, totalFrames - 1)} value={frameIdx}
          onChange={e => setFrameIdx(Number(e.target.value))} style={{ flex: 1 }} />
        <button onClick={() => setFrameIdx(f => Math.min(f + 1, totalFrames - 1))}
          style={{ fontSize: 12, padding: "2px 8px" }}>▶</button>
        <span style={{ fontSize: 12, fontFamily: "monospace", minWidth: 82, textAlign: "right", opacity: .5 }}>
          {frameIdx} / {totalFrames - 1}
        </span>
      </div>

      {/* ── FAN detect bar ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
        padding: "7px 12px", background: "rgba(128,128,128,.07)", borderRadius: 8,
        border: "1px solid rgba(128,128,128,.15)" }}>

        <button onClick={detectFace} disabled={detecting || serverErr}
          style={{ fontSize: 12, fontWeight: 600, padding: "4px 14px", borderRadius: 6,
            background: detecting ? "rgba(128,128,128,.2)" : "#5B3FE8",
            color: "#fff", border: "none", cursor: detecting ? "default" : "pointer", minWidth: 100 }}>
          {detecting ? "Detecting…" : "⚡ Detect face"}
        </button>

        {/* auto-detect toggle */}
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11,
          cursor: "pointer", opacity: .7 }}>
          <input type="checkbox" checked={autoDetect}
            onChange={e => setAutoDetect(e.target.checked)} style={{ accentColor: "#5B3FE8" }} />
          auto on each frame
        </label>

        {/* FAN message */}
        {fanMsg && (
          <span style={{ fontSize: 11, opacity: .7, marginLeft: 4 }}>{fanMsg}</span>
        )}

        {/* Accept / dismiss suggestions */}
        {pending > 0 && (
          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            <span style={{ fontSize: 11, opacity: .5, alignSelf: "center" }}>
              {pending} unaccepted
            </span>
            <button onClick={acceptAll}
              style={{ fontSize: 11, padding: "3px 10px", borderRadius: 5,
                background: "#1D9E75", color: "#fff", border: "none", cursor: "pointer" }}>
              Accept all
            </button>
            <button onClick={() => { setSugg({}); setFanMsg(""); }}
              style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5,
                background: "rgba(128,128,128,.15)", border: "none", cursor: "pointer" }}>
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* ── header row ───────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Landmark picker</span>
          <span style={{
            background: placed === 24 ? "#1D9E75" : "rgba(128,128,128,.12)",
            color: placed === 24 ? "#fff" : "inherit",
            fontSize: 11, padding: "2px 8px", borderRadius: 10, fontWeight: 500 }}>
            {placed}/24
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={reset} style={{ fontSize: 12 }}>Reset</button>
          <button onClick={exportJSON} disabled={placed === 0} style={{ fontSize: 12 }}>
            {copied ? "Copied ✓" : "Export JSON ↓"}
          </button>
        </div>
      </div>

      {/* progress bar */}
      <div style={{ height: 3, background: "rgba(128,128,128,.15)", borderRadius: 2, marginBottom: 10 }}>
        <div style={{ height: "100%", width: `${(placed / 24) * 100}%`,
          background: selPt?.color || "#1D9E75", borderRadius: 2, transition: "width .25s" }} />
      </div>

      {/* active point hint */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px",
        background: "rgba(128,128,128,.07)", borderRadius: 8, marginBottom: 10, fontSize: 12,
        border: `1.5px solid ${selPt?.color}40` }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: selPt?.color,
          flexShrink: 0, boxShadow: `0 0 0 3px ${selPt?.color}30` }} />
        <span style={{ opacity: .5 }}>Click image →</span>
        <span style={{ fontWeight: 600, color: selPt?.color }}>pt {sel} · {selPt?.label}</span>
        <span style={{ opacity: .35, fontSize: 11 }}>({selPt?.gname})</span>
        {coords[sel] && (
          <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 11, opacity: .4 }}>
            ({Math.round(coords[sel].x * imgNatW)}, {Math.round(coords[sel].y * imgNatH)})
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>

        {/* ── image canvas ─────────────────────────────────────────────── */}
        <div ref={wrapRef} style={{ flex: 1, position: "relative", cursor: "crosshair",
          lineHeight: 0, borderRadius: 8, overflow: "hidden", background: "#111" }}
          onClick={handleClick}>

          {imgSrc && (
            <img ref={imgRef} src={imgSrc} alt={`${session} frame ${frameIdx}`}
              style={{ width: "100%", display: "block" }} draggable={false}
              onLoad={() => {
                setLoaded(true);
                setWrapSize({ w: imgRef.current.offsetWidth, h: imgRef.current.offsetHeight });
              }}
              onError={() => setServerErr(true)} />
          )}

          {imgLoaded && wrapSize.w > 0 && (
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>

              {/* Polygon outlines for confirmed groups */}
              {GROUPS.map(g => {
                const poly = groupPoly(g.id);
                return poly
                  ? <polygon key={g.id} points={poly} fill={g.color + "18"}
                      stroke={g.color} strokeWidth="1.5" strokeLinejoin="round" />
                  : null;
              })}

              {/* Ghost suggestions — shown only for unconfirmed points */}
              {POINTS.map(pt => {
                const sug = suggestions[pt.id];
                if (!sug || coords[pt.id]) return null;
                const cx = sx(sug.x), cy = sy(sug.y);
                return (
                  <g key={`sug-${pt.id}`}>
                    {/* outer pulse ring */}
                    <circle cx={cx} cy={cy} r="11" fill="none"
                      stroke={pt.color} strokeWidth="1" strokeDasharray="3,3" opacity=".5" />
                    {/* filled ghost dot */}
                    <circle cx={cx} cy={cy} r="5" fill={pt.color + "55"}
                      stroke={pt.color} strokeWidth="1.5" opacity=".8" />
                    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                      style={{ fontSize: "7px", fill: pt.color, fontWeight: 700,
                        fontFamily: "monospace", opacity: .7 }}>{pt.id}</text>
                  </g>
                );
              })}

              {/* Confirmed landmarks */}
              {POINTS.map(pt => {
                if (!coords[pt.id]) return null;
                const cx = sx(coords[pt.id].x), cy = sy(coords[pt.id].y), isSel = pt.id === sel;
                return (
                  <g key={pt.id}>
                    {isSel && <circle cx={cx} cy={cy} r="13" fill="none" stroke={pt.color}
                      strokeWidth="1.5" strokeDasharray="3,2" opacity=".9" />}
                    <circle cx={cx} cy={cy} r={isSel ? 7 : 5} fill={pt.color}
                      stroke="rgba(255,255,255,.85)" strokeWidth="1.5" />
                    <text x={cx} cy={cy} textAnchor="middle" dominantBaseline="central"
                      style={{ fontSize: "8px", fill: "#fff", fontWeight: 700, fontFamily: "monospace" }}>
                      {pt.id}
                    </text>
                  </g>
                );
              })}

            </svg>
          )}
        </div>

        {/* ── sidebar ──────────────────────────────────────────────────── */}
        <div style={{ width: 170, flexShrink: 0, overflowY: "auto", maxHeight: 520 }}>
          {GROUPS.map(g => {
            const gpts = POINTS.filter(p => p.g === g.id);
            const gp   = gpts.filter(p => coords[p.id]).length;
            const gsg  = gpts.filter(p => suggestions[p.id] && !coords[p.id]).length;
            return (
              <div key={g.id} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: g.color, padding: "3px 4px",
                  display: "flex", justifyContent: "space-between", letterSpacing: .3 }}>
                  <span>{g.name}</span>
                  <span style={{ opacity: .7 }}>
                    {gp}/{gpts.length}
                    {gsg > 0 && <span style={{ color: "#aaa", marginLeft: 4 }}>+{gsg}✦</span>}
                  </span>
                </div>

                {gpts.map(pt => {
                  const hasSug  = !!suggestions[pt.id] && !coords[pt.id];
                  const isConf  = !!coords[pt.id];
                  return (
                    <div key={pt.id} onClick={() => { setSel(pt.id); if (hasSug) acceptOne(pt.id); }}
                      title={hasSug ? "Click to accept suggestion" : ""}
                      style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 6px",
                        borderRadius: 5, cursor: "pointer", marginBottom: 1,
                        background: sel === pt.id
                          ? g.color + "20"
                          : hasSug ? g.color + "0D" : "transparent",
                        border: `1px solid ${
                          sel === pt.id ? g.color + "80"
                          : hasSug ? g.color + "40"
                          : "transparent"}`,
                        fontSize: 11 }}>

                      {/* state dot */}
                      <span style={{ width: 7, height: 7, borderRadius: "50%",
                        background: isConf ? g.color : hasSug ? "transparent" : "rgba(128,128,128,.2)",
                        border: hasSug ? `1.5px dashed ${g.color}` : "none",
                        flexShrink: 0 }} />

                      <span style={{ color: isConf ? g.color : hasSug ? g.color + "bb" : "rgba(128,128,128,.5)",
                        fontWeight: 600, minWidth: 22 }}>{pt.id}</span>
                      <span style={{ opacity: .45, fontSize: 10, flex: 1, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pt.label}</span>

                      {hasSug && (
                        <span style={{ fontSize: 10, color: g.color, opacity: .7 }} title="accept">✦</span>
                      )}
                      {isConf && (
                        <span onClick={e => del(pt.id, e)}
                          style={{ opacity: .3, cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }}>×</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Legend */}
          <div style={{ marginTop: 8, padding: "6px 8px", background: "rgba(128,128,128,.08)",
            borderRadius: 6, fontSize: 10, opacity: .5, lineHeight: 1.6 }}>
            ● confirmed &nbsp;◌ suggested<br />
            click ✦ to accept one<br />
            ← → frame &nbsp; Shift±10
          </div>
        </div>
      </div>

      {/* ── coord table ──────────────────────────────────────────────────── */}
      {placed > 0 && (
        <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(128,128,128,.06)",
          borderRadius: 8, fontSize: 11 }}>
          <div style={{ fontWeight: 600, marginBottom: 5, opacity: .4, fontSize: 10, letterSpacing: .3 }}>
            CONFIRMED — {session} frame {frameIdx} — px ({imgNatW}×{imgNatH}, top-left origin)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 12px" }}>
            {POINTS.filter(p => coords[p.id]).map(p => (
              <span key={p.id} style={{ fontFamily: "monospace", color: p.color, fontSize: 10 }}>
                {p.id}: ({Math.round(coords[p.id].x * imgNatW)}, {Math.round(coords[p.id].y * imgNatH)})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

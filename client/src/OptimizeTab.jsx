import { useEffect, useRef, useState } from "react";

const PRESETS = {
  small: { label: "Small file", mode: "quality", quality: "small", height: "720" },
  balanced: { label: "Balanced", mode: "quality", quality: "balanced", height: "1080" },
  high: { label: "High quality", mode: "quality", quality: "high", height: "" },
  discord: { label: "Discord (≤10 MB)", mode: "target", targetMB: "9.5", height: "720" },
  custom: { label: "Custom" },
};

const DEFAULTS = {
  mode: "quality", quality: "balanced", targetMB: "25", height: "1080", fps: "",
  format: "mp4", codec: "h264", removeAudio: false, start: "", end: "",
};

export const fmtSize = (b) => {
  if (!b && b !== 0) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
};

export default function OptimizeTab() {
  const [file, setFile] = useState(null);
  const [preset, setPreset] = useState("balanced");
  const [opts, setOpts] = useState({ ...DEFAULTS, ...PRESETS.balanced });
  const [job, setJob] = useState(null);
  const [upload, setUpload] = useState(null); // 0..1 while uploading
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const xhrRef = useRef(null);
  const inputRef = useRef(null);

  const set = (k, v) => { setOpts((o) => ({ ...o, [k]: v })); setPreset("custom"); };
  const choosePreset = (p) => {
    setPreset(p);
    if (p !== "custom") setOpts((o) => ({ ...o, ...DEFAULTS, ...PRESETS[p] }));
  };

  // Poll the job while ffmpeg is working
  useEffect(() => {
    if (!job || job.status !== "processing") return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/jobs/${job.id}`);
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setJob(data);
        if (data.status === "error") setError(data.error);
      } catch (e) {
        setError(e.message);
        setJob(null);
      }
    }, 500);
    return () => clearInterval(t);
  }, [job?.id, job?.status]);

  const pickFile = (f) => {
    if (!f) return;
    if (!f.type.startsWith("video/") && !/\.(mp4|mov|mkv|avi|webm|m4v|wmv|flv|3gp|ts|mts)$/i.test(f.name)) {
      setError("Please choose a video file.");
      return;
    }
    setError(""); setJob(null); setFile(f);
  };

  const start = () => {
    setError(""); setJob(null); setUpload(0);
    const qs = new URLSearchParams({
      mode: opts.mode, quality: opts.quality, targetMB: opts.targetMB,
      height: opts.height, fps: opts.fps, format: opts.format, codec: opts.codec,
      removeAudio: opts.removeAudio ? "1" : "0", start: opts.start, end: opts.end,
    });
    // XHR (not fetch) so we can show upload progress for big files
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", `/api/optimize?${qs}`);
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && setUpload(e.loaded / e.total);
    xhr.onload = () => {
      setUpload(null);
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status !== 200) return setError(data.error || "Upload failed.");
      setJob(data);
    };
    xhr.onerror = () => { setUpload(null); setError("Upload failed. Is the server running?"); };
    xhr.onabort = () => setUpload(null);
    xhr.send(file);
  };

  const cancel = async () => {
    xhrRef.current?.abort();
    if (job) await fetch(`/api/jobs/${job.id}`, { method: "DELETE" }).catch(() => {});
    setJob(null); setUpload(null);
  };

  const busy = upload !== null || job?.status === "processing";
  const out = job?.status === "done" ? job.files[0] : null;
  const saved = out ? 1 - out.size / job.inputSize : 0;

  return (
    <>
      <div
        className={`drop ${dragging ? "over" : ""}`}
        onClick={() => !busy && inputRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) pickFile(e.dataTransfer.files[0]); }}
      >
        <input ref={inputRef} type="file" accept="video/*" hidden onChange={(e) => pickFile(e.target.files[0])} />
        {file ? (
          <><strong>{file.name}</strong><span>{fmtSize(file.size)} · click to change</span></>
        ) : (
          <><strong>Drop a video here</strong><span>or click to choose a file</span></>
        )}
      </div>

      <div className="presets">
        {Object.entries(PRESETS).map(([k, p]) => (
          <button key={k} className={preset === k ? "chip active" : "chip"} onClick={() => choosePreset(k)} disabled={busy}>
            {p.label}
          </button>
        ))}
      </div>

      <fieldset className="grid" disabled={busy}>
        <label>Size control
          <select value={opts.mode} onChange={(e) => set("mode", e.target.value)}>
            <option value="quality">By quality</option>
            <option value="target">By target file size</option>
          </select>
        </label>
        {opts.mode === "quality" ? (
          <label>Quality
            <select value={opts.quality} onChange={(e) => set("quality", e.target.value)}>
              <option value="small">Smaller file</option>
              <option value="balanced">Balanced</option>
              <option value="high">Higher quality</option>
            </select>
          </label>
        ) : (
          <label>Target size (MB)
            <input type="number" min="1" step="0.5" value={opts.targetMB} onChange={(e) => set("targetMB", e.target.value)} />
          </label>
        )}
        <label>Resolution
          <select value={opts.height} onChange={(e) => set("height", e.target.value)}>
            <option value="">Keep original</option>
            {["2160", "1440", "1080", "720", "480", "360"].map((h) => (
              <option key={h} value={h}>{h === "2160" ? "4K (2160p)" : `${h}p`}</option>
            ))}
          </select>
        </label>
        <label>Frame rate
          <select value={opts.fps} onChange={(e) => set("fps", e.target.value)}>
            <option value="">Keep original</option>
            <option value="60">Max 60 fps</option>
            <option value="30">Max 30 fps</option>
            <option value="24">Max 24 fps</option>
          </select>
        </label>
        <label>Format
          <select value={opts.format} onChange={(e) => set("format", e.target.value)}>
            <option value="mp4">MP4 (plays everywhere)</option>
            <option value="webm">WebM (for websites)</option>
          </select>
        </label>
        {opts.format === "mp4" && (
          <label>Codec
            <select value={opts.codec} onChange={(e) => set("codec", e.target.value)}>
              <option value="h264">H.264 (most compatible)</option>
              <option value="h265">H.265 (smaller, slower)</option>
            </select>
          </label>
        )}
        <label>Trim start
          <input placeholder="e.g. 0:15" value={opts.start} onChange={(e) => set("start", e.target.value)} />
        </label>
        <label>Trim end
          <input placeholder="e.g. 1:30" value={opts.end} onChange={(e) => set("end", e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.removeAudio} onChange={(e) => set("removeAudio", e.target.checked)} />
          Remove audio
        </label>
      </fieldset>

      <div className="row">
        {busy ? (
          <button className="secondary" onClick={cancel}>Cancel</button>
        ) : (
          <button onClick={start} disabled={!file}>Optimize</button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {busy && (
        <div className="progress">
          <div className="label">
            {upload !== null ? "Uploading…" : "Optimizing…"}{" "}
            {Math.round((upload ?? job?.progress ?? 0) * 100)}%
          </div>
          <div className="bar"><div style={{ width: `${(upload ?? job?.progress ?? 0) * 100}%` }} /></div>
        </div>
      )}

      {job?.status === "done" && (
        <section className="card result">
          <div className="meta">
            <h2>{out.name}</h2>
            <p>
              {fmtSize(job.inputSize)} → <strong>{fmtSize(out.size)}</strong>{" "}
              {saved > 0 ? <span className="good">({Math.round(saved * 100)}% smaller)</span>
                : <span className="error">(larger than the original; try a smaller preset)</span>}
            </p>
            <a className="button" href={`/api/jobs/${job.id}/files/0`} download={job.files[0].name}>
              Download
            </a>
          </div>
        </section>
      )}
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { fmtSize } from "./OptimizeTab.jsx";

const QUICK = [10, 15, 20, 30, 60];

const fmtTime = (s) => {
  if (!Number.isFinite(s)) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return (h ? `${h}:${String(m).padStart(2, "0")}` : m) + `:${String(sec).padStart(2, "0")}`;
};

// "20", "1:30", "1:02:03" -> seconds
const parseTime = (v) => {
  const parts = String(v).trim().split(":").map(Number);
  if (!String(v).trim() || parts.some((n) => !Number.isFinite(n) || n < 0) || parts.length > 3) return NaN;
  return parts.reduce((a, n) => a * 60 + n, 0);
};

export default function SplitTab() {
  const [file, setFile] = useState(null);
  const [duration, setDuration] = useState(null);
  const [every, setEvery] = useState("20");
  const [mode, setMode] = useState("exact");
  const [job, setJob] = useState(null);
  const [upload, setUpload] = useState(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const xhrRef = useRef(null);
  const inputRef = useRef(null);

  const seconds = parseTime(every);
  const valid = seconds >= 1;
  const count = valid && duration ? Math.ceil(duration / seconds) : null;
  const last = count && duration - (count - 1) * seconds;

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
    setError(""); setJob(null); setFile(f); setDuration(null);
    // Read the length in the browser so we can preview how many parts there will be
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { setDuration(Number.isFinite(v.duration) ? v.duration : null); URL.revokeObjectURL(v.src); };
    v.onerror = () => URL.revokeObjectURL(v.src);
    v.src = URL.createObjectURL(f);
  };

  const start = () => {
    setError(""); setJob(null); setUpload(0);
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", `/api/split?${new URLSearchParams({ every: String(seconds), mode })}`);
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
  const pct = upload ?? job?.progress ?? 0;
  const done = job?.status === "done";

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
          <>
            <strong>{file.name}</strong>
            <span>{fmtSize(file.size)}{duration ? ` · ${fmtTime(duration)} long` : ""} · click to change</span>
          </>
        ) : (
          <><strong>Drop a long video here</strong><span>or click to choose a file</span></>
        )}
      </div>

      <fieldset className="split-opts" disabled={busy}>
        <label className="lbl">Cut every</label>
        <div className="presets">
          {QUICK.map((s) => (
            <button key={s} className={seconds === s ? "chip active" : "chip"} onClick={() => setEvery(String(s))}>
              {s < 60 ? `${s} sec` : `${s / 60} min`}
            </button>
          ))}
          <input
            className="custom-time"
            value={every}
            onChange={(e) => setEvery(e.target.value)}
            placeholder="seconds or m:ss"
            aria-label="Custom segment length"
          />
        </div>
        {!valid && every.trim() && <p className="error">Enter seconds (e.g. 45) or minutes:seconds (e.g. 1:30).</p>}

        <div className="grid">
          <label>Cutting mode
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="exact">Exact (slower)</option>
              <option value="fast">Fast (lengths vary a little)</option>
            </select>
          </label>
        </div>
      </fieldset>

      {count && valid && (
        <p className="hint">
          This makes <strong>{count} {count === 1 ? "part" : "parts"}</strong>
          {count > 1 && <> of {fmtTime(seconds)}{Math.abs(last - seconds) > 0.5 && <>, plus a last part of {fmtTime(last)}</>}</>}.
        </p>
      )}

      <div className="row">
        {busy ? (
          <button className="secondary" onClick={cancel}>Cancel</button>
        ) : (
          <button onClick={start} disabled={!file || !valid}>Split video</button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {busy && (
        <div className="progress">
          <div className="label">{upload !== null ? "Uploading…" : "Splitting…"} {Math.round(pct * 100)}%</div>
          <div className="bar"><div style={{ width: `${pct * 100}%` }} /></div>
        </div>
      )}

      {done && (
        <section className="card result">
          <div className="meta">
            <div className="result-head">
              <h2>{job.files.length} segments ready</h2>
              <a className="button" href={`/api/jobs/${job.id}/zip`}>Download all (ZIP)</a>
            </div>
            <ul className="segments">
              {job.files.map((f, i) => (
                <li key={f.name}>
                  <span className="seg-name">{f.name}</span>
                  <span className="seg-meta">{fmtTime(f.duration)} · {fmtSize(f.size)}</span>
                  <a href={`/api/jobs/${job.id}/files/${i}`} download={f.name}>Download</a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}

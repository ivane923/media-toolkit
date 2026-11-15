import { useEffect, useRef, useState } from "react";
import { fmtSize } from "./OptimizeTab.jsx";
import { makeZip } from "./zip.js";

// Everything here runs in the browser (canvas), so nothing is uploaded.
const PRESETS = {
  web: { label: "Web (WebP)", format: "webp", quality: 80, maxSide: "1920" },
  email: { label: "Email (JPEG)", format: "jpeg", quality: 75, maxSide: "1280" },
  thumb: { label: "Thumbnail", format: "webp", quality: 75, maxSide: "640" },
  light: { label: "Light touch", format: "same", quality: 85, maxSide: "" },
  custom: { label: "Custom" },
};

const FORMATS = {
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  webp: { mime: "image/webp", ext: "webp" },
  png: { mime: "image/png", ext: "png" },
};

const SIZES = ["3840", "2560", "1920", "1600", "1280", "1024", "800", "640"];
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|tiff?|ico)$/i;

let nextId = 1;

// Pick the output format. "Same as original" keeps JPEG/PNG/WebP; anything else becomes WebP.
function outputFormat(file, format) {
  if (format !== "same") return format;
  return { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[file.type] || "webp";
}

const toBlob = (canvas, mime, quality) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the image."))), mime, quality)
  );

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

async function optimizeImage(file, opts) {
  let bmp;
  try {
    // "from-image" applies the EXIF rotation, so phone photos stay upright
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Can't read this image (format not supported here).");
  }

  const { width: w, height: h } = bmp;
  const max = Number(opts.maxSide) || 0;
  const scale = max && Math.max(w, h) > max ? max / Math.max(w, h) : 1; // never upscale
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  const fmt = outputFormat(file, opts.format);
  const { mime, ext } = FORMATS[fmt];

  // Big reductions look sharper when halved in steps instead of all at once
  let src = bmp, sw = w, sh = h;
  while (sw / 2 > tw && sh / 2 > th) {
    const step = makeCanvas(Math.round(sw / 2), Math.round(sh / 2));
    const sctx = step.getContext("2d");
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(src, 0, 0, step.width, step.height);
    src = step; sw = step.width; sh = step.height;
  }

  const canvas = makeCanvas(tw, th);
  const ctx = canvas.getContext("2d");
  if (fmt === "jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, tw, th); } // JPEG has no transparency
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, tw, th);
  bmp.close();

  let blob = await toBlob(canvas, mime, opts.quality / 100);
  if (blob.type !== mime) throw new Error(`This browser can't save ${ext.toUpperCase()} images.`);

  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  let name = `${base}-optimized.${ext}`;
  let keptOriginal = false;
  // Same format and size but no smaller: the original was already well compressed
  if (blob.size >= file.size && file.type === mime && scale === 1) {
    blob = file; name = file.name; keptOriginal = true;
  }

  return { blob, name, keptOriginal, width: tw, height: th, srcWidth: w, srcHeight: h, size: blob.size };
}

// ZIP entries must have unique names
function uniqueNames(items) {
  const seen = new Map();
  return items.map(({ name, blob }) => {
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    return { blob, name: n ? name.replace(/(\.[^.]+)?$/, ` (${n})$1`) : name };
  });
}

export default function ImageTab() {
  const [items, setItems] = useState([]);
  const [preset, setPreset] = useState("web");
  const [opts, setOpts] = useState({ ...PRESETS.web });
  const [busy, setBusy] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const cancelRef = useRef(false);
  const urlsRef = useRef(new Set());

  const set = (k, v) => { setOpts((o) => ({ ...o, [k]: v })); setPreset("custom"); };
  const choosePreset = (p) => {
    setPreset(p);
    if (p !== "custom") setOpts({ ...PRESETS[p] });
  };

  const track = (url) => { urlsRef.current.add(url); return url; };
  const release = (url) => { if (url) { URL.revokeObjectURL(url); urlsRef.current.delete(url); } };
  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const update = (id, patch) => setItems((all) => all.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const addFiles = (list) => {
    const files = [...(list || [])];
    const images = files.filter((f) => f.type.startsWith("image/") || IMAGE_EXT.test(f.name));
    setError(images.length < files.length ? "Some files were skipped because they aren't images." : "");
    if (!images.length) return;
    setItems((all) => [
      ...all,
      ...images.map((file) => ({ id: nextId++, file, status: "pending", preview: track(URL.createObjectURL(file)) })),
    ]);
  };

  const remove = (id) => setItems((all) => all.filter((it) => {
    if (it.id !== id) return true;
    release(it.preview); release(it.out?.url);
    return false;
  }));

  const clear = () => {
    items.forEach((it) => { release(it.preview); release(it.out?.url); });
    setItems([]); setError("");
  };

  // Process one at a time so dozens of big photos don't exhaust memory
  const run = async () => {
    setBusy(true); setError(""); cancelRef.current = false;
    const queue = items.map((it) => it.id);
    for (const id of queue) {
      if (cancelRef.current) break;
      const it = items.find((x) => x.id === id);
      release(it.out?.url);
      update(id, { status: "working", out: null, error: "" });
      try {
        const out = await optimizeImage(it.file, opts);
        out.url = track(URL.createObjectURL(out.blob));
        update(id, { status: "done", out });
      } catch (e) {
        update(id, { status: "error", error: e.message });
      }
    }
    if (cancelRef.current) {
      setItems((all) => all.map((it) => (it.status === "working" ? { ...it, status: "pending" } : it)));
    }
    setBusy(false);
  };

  const downloadAll = async () => {
    setZipping(true);
    try {
      const zip = await makeZip(uniqueNames(done.map((it) => it.out)));
      const url = URL.createObjectURL(zip);
      const a = document.createElement("a");
      a.href = url; a.download = "optimized-images.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(`Couldn't build the ZIP: ${e.message}`);
    } finally {
      setZipping(false);
    }
  };

  const done = items.filter((it) => it.status === "done");
  const finished = items.filter((it) => it.status === "done" || it.status === "error").length;
  const before = done.reduce((n, it) => n + it.file.size, 0);
  const after = done.reduce((n, it) => n + it.out.size, 0);
  const saved = before ? 1 - after / before : 0;
  const lossless = opts.format === "png";

  return (
    <>
      <div
        className={`drop ${dragging ? "over" : ""}`}
        onClick={() => !busy && inputRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) addFiles(e.dataTransfer.files); }}
      >
        <input
          ref={inputRef} type="file" accept="image/*" multiple hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
        />
        {items.length ? (
          <><strong>{items.length} {items.length === 1 ? "image" : "images"} added</strong><span>click or drop to add more</span></>
        ) : (
          <><strong>Drop images here</strong><span>JPEG, PNG, WebP, GIF and more · several at once is fine</span></>
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
        <label>Format
          <select value={opts.format} onChange={(e) => set("format", e.target.value)}>
            <option value="same">Same as original</option>
            <option value="webp">WebP (smallest)</option>
            <option value="jpeg">JPEG (plays everywhere)</option>
            <option value="png">PNG (lossless)</option>
          </select>
        </label>
        <label>Max width / height
          <select value={opts.maxSide} onChange={(e) => set("maxSide", e.target.value)}>
            <option value="">Keep original</option>
            {SIZES.map((s) => <option key={s} value={s}>{s} px</option>)}
          </select>
        </label>
        <label>Quality: {lossless ? "lossless" : opts.quality}
          <input
            type="range" min="10" max="100" step="5" disabled={lossless}
            value={opts.quality} onChange={(e) => set("quality", Number(e.target.value))}
          />
        </label>
      </fieldset>
      <p className="hint">
        Images are processed on this computer and never uploaded. Location and camera info (EXIF) is removed.
        {opts.format === "same" && " GIF, BMP and other formats are saved as WebP."}
      </p>

      <div className="row">
        {busy ? (
          <button className="secondary" onClick={() => (cancelRef.current = true)}>Cancel</button>
        ) : (
          <>
            <button onClick={run} disabled={!items.length}>Optimize {items.length > 1 ? `${items.length} images` : ""}</button>
            {items.length > 0 && <button className="secondary" onClick={clear}>Clear</button>}
          </>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {busy && (
        <div className="progress">
          <div className="label">Optimizing… {finished} of {items.length}</div>
          <div className="bar"><div style={{ width: `${(finished / items.length) * 100}%` }} /></div>
        </div>
      )}

      {items.length > 0 && (
        <section className="card result">
          <div className="meta">
            {done.length > 0 && (
              <div className="result-head">
                <div>
                  <h2>{done.length} {done.length === 1 ? "image" : "images"} ready</h2>
                  <p className="totals">
                    {fmtSize(before)} → <strong>{fmtSize(after)}</strong>{" "}
                    {saved > 0 && <span className="good">({Math.round(saved * 100)}% smaller)</span>}
                  </p>
                </div>
                {done.length > 1 && (
                  <button onClick={downloadAll} disabled={busy || zipping}>
                    {zipping ? "Zipping…" : "Download all (ZIP)"}
                  </button>
                )}
              </div>
            )}
            <ul className="segments images">
              {items.map((it) => {
                const o = it.out;
                const pct = o ? Math.round((1 - o.size / it.file.size) * 100) : 0;
                return (
                  <li key={it.id}>
                    <img className="thumb" src={o?.url || it.preview} alt="" />
                    <div className="img-info">
                      <span className="seg-name">{o?.name || it.file.name}</span>
                      <span className="seg-meta">
                        {it.status === "pending" && fmtSize(it.file.size)}
                        {it.status === "working" && "Optimizing…"}
                        {it.status === "error" && <span className="error">{it.error}</span>}
                        {o && (
                          <>
                            {fmtSize(it.file.size)} → {fmtSize(o.size)}{" "}
                            {o.keptOriginal ? "· already optimized, kept original"
                              : pct > 0 ? <span className="good">−{pct}%</span>
                              : <span className="error">+{-pct}%</span>}
                            {" · "}{o.width}×{o.height}
                            {o.width !== o.srcWidth && <> (was {o.srcWidth}×{o.srcHeight})</>}
                          </>
                        )}
                      </span>
                    </div>
                    {o && <a href={o.url} download={o.name}>Download</a>}
                    {!busy && (
                      <button className="link" onClick={() => remove(it.id)} aria-label={`Remove ${it.file.name}`}>✕</button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}

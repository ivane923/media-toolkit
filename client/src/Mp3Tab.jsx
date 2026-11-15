import { useState } from "react";

const fmtTime = (s) => {
  if (!s) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return (h ? `${h}:${String(m).padStart(2, "0")}` : m) + `:${String(sec).padStart(2, "0")}`;
};

export default function Mp3Tab() {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState(null);
  const [bitrate, setBitrate] = useState("192");
  const [status, setStatus] = useState("idle"); // idle | loading | ready | converting
  const [error, setError] = useState("");

  const fetchInfo = async (e) => {
    e.preventDefault();
    setError(""); setInfo(null); setStatus("loading");
    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(url.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInfo(data); setStatus("ready");
    } catch (err) {
      setError(err.message || "Something went wrong."); setStatus("idle");
    }
  };

  const convert = async () => {
    setError(""); setStatus("converting");
    try {
      const qs = new URLSearchParams({ url: url.trim(), bitrate, title: info.title });
      const res = await fetch(`/api/convert?${qs}`);
      if (!res.ok) throw new Error((await res.json()).error);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${info.title.replace(/[\\/:*?"<>|]+/g, "")}.mp3`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err.message || "Conversion failed.");
    }
    setStatus("ready");
  };

  return (
    <>
      <form onSubmit={fetchInfo} className="row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a YouTube link…"
          autoFocus
        />
        <button disabled={!url.trim() || status === "loading" || status === "converting"}>
          {status === "loading" ? "Loading…" : "Fetch"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {info && (
        <section className="card">
          {info.thumbnail && <img src={info.thumbnail} alt="" />}
          <div className="meta">
            <h2>{info.title}</h2>
            <p>{info.uploader} · {fmtTime(info.duration)}</p>
            <div className="row">
              <select value={bitrate} onChange={(e) => setBitrate(e.target.value)}>
                {["128", "192", "256", "320"].map((b) => (
                  <option key={b} value={b}>{b} kbps</option>
                ))}
              </select>
              <button onClick={convert} disabled={status === "converting"}>
                {status === "converting" ? "Converting…" : "Download MP3"}
              </button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

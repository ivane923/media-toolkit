import { useState } from "react";
import Mp3Tab from "./Mp3Tab.jsx";
import OptimizeTab from "./OptimizeTab.jsx";
import SplitTab from "./SplitTab.jsx";
import ImageTab from "./ImageTab.jsx";

const TABS = [
  { id: "mp3", label: "YouTube → MP3" },
  { id: "optimize", label: "Optimize Video" },
  { id: "split", label: "Split Video" },
  { id: "image", label: "Optimize Images" },
];

export default function App() {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem("tab") || "mp3"; } catch { return "mp3"; }
  });
  const pick = (id) => {
    setTab(id);
    try { localStorage.setItem("tab", id); } catch {}
  };

  return (
    <main className="wrap">
      <h1>Media Toolkit</h1>
      <p className="sub">Personal tools. Everything runs on your own computer.</p>
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => pick(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {/* Keep all mounted so switching tabs doesn't lose a running job */}
      <div hidden={tab !== "mp3"}><Mp3Tab /></div>
      <div hidden={tab !== "optimize"}><OptimizeTab /></div>
      <div hidden={tab !== "split"}><SplitTab /></div>
      <div hidden={tab !== "image"}><ImageTab /></div>
    </main>
  );
}

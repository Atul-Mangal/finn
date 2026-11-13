"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { spokenSeconds } from "@/lib/speak";

const noop = () => () => {};

/** Reads the brief aloud with the device's own speech engine. Hidden where unsupported. */
export function Listen({ lines }: { lines: string[] }) {
  const supported = useSyncExternalStore(noop, () => "speechSynthesis" in window && "SpeechSynthesisUtterance" in window, () => false);
  const [on, setOn] = useState(false);
  useEffect(() => () => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);
  if (!supported || !lines.length) return null;

  const toggle = () => {
    const synth = window.speechSynthesis;
    synth.cancel();
    if (on) {
      setOn(false);
      return;
    }
    const voices = synth.getVoices();
    const voice = voices.find((v) => v.lang === "en-IN") || voices.find((v) => v.lang.startsWith("en-GB")) || voices.find((v) => v.lang.startsWith("en"));
    lines.forEach((text, i) => {
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = voice?.lang || "en-IN";
      u.rate = 1.03;
      if (i === lines.length - 1) u.onend = () => setOn(false);
      u.onerror = () => setOn(false);
      synth.speak(u);
    });
    setOn(true);
  };

  return (
    <button onClick={toggle} aria-pressed={on}
      className={`mt-3 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] ${on ? "bg-ink text-stone" : "bg-paper text-ink"}`}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden fill="currentColor">
        {on ? <rect x="3" y="3" width="10" height="10" rx="1.5" /> : <path d="M4 2.5v11l9-5.5z" />}
      </svg>
      {on ? "Stop" : `Listen to the brief, ${spokenSeconds(lines)} sec`}
    </button>
  );
}

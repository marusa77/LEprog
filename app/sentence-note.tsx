"use client";

import { useEffect, useId, useRef, useState } from "react";

/** A display-only preview: never shorten or write the saved explanation. */
export function SentenceNote({ note }: { note: string }) {
  const textId = useId();
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);

  useEffect(() => {
    const element = textRef.current;
    if (!element) return;
    let disposed = false;
    const measure = () => {
      if (disposed || !element.clientWidth) return;
      const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight);
      if (Number.isFinite(lineHeight) && lineHeight > 0) {
        // Measure rendered lines, including explicit newlines, at the current
        // width and font size. The full text remains in the DOM even when clamped.
        setCanExpand(element.scrollHeight > Math.ceil(lineHeight * 3) + 1);
      }
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    if (!observer) window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure);
    return () => {
      disposed = true;
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", measure);
    };
  }, [note]);

  return <div className="personal-note sentence-note">
    <p id={textId} ref={textRef} className={`sentence-note-text${expanded ? "" : " collapsed"}`}>メモ：{note}</p>
    {canExpand && <button type="button" className="sentence-note-toggle" aria-expanded={expanded} aria-controls={textId}
      onClick={() => setExpanded(current => !current)}>{expanded ? "折りたたむ" : "続きを読む"}</button>}
  </div>;
}

import { useEffect, useRef, useState } from "react";
// Adapted from the owner's portfolio AnimatedWord: actual ASCII bits, 150ms/bit,
// 75ms letter stagger, and original-character spacers to keep the layout steady.
export function AnimatedTitleWord({
  text,
  variant,
}: {
  text: string;
  variant: "greeting" | "name";
}) {
  const [glyphs, setGlyphs] = useState(() => Array.from(text)),
    [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  function animate(next: boolean) {
    clearInterval(timer.current);
    setActive(next);
    const letters = Array.from(text);
    if (!next || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setGlyphs(letters);
      return;
    }
    const bits = letters.map((l) =>
        l.charCodeAt(0).toString(2).padStart(8, "0"),
      ),
      started = performance.now();
    setGlyphs(letters.map((l, i) => (/[a-z]/i.test(l) ? bits[i][0] : l)));
    timer.current = setInterval(() => {
      const elapsed = performance.now() - started;
      setGlyphs(
        letters.map((l, i) =>
          !/[a-z]/i.test(l) || elapsed >= 1200 + i * 75
            ? l
            : bits[i][Math.min(7, Math.floor(elapsed / 150))],
        ),
      );
      if (elapsed >= 1200 + letters.length * 75) clearInterval(timer.current);
    }, 50);
  }
  useEffect(() => () => clearInterval(timer.current), []);
  return (
    <span
      className={`title-word title-word--${variant}${active ? " is-active" : ""}`}
      tabIndex={0}
      onMouseEnter={() => animate(true)}
      onMouseLeave={() => animate(false)}
      onFocus={() => animate(true)}
      onBlur={() => animate(false)}
    >
      <span className="title-accessible">{text}</span>
      {Array.from(text, (letter, i) => (
        <span className="title-character" aria-hidden="true" key={i}>
          <span className="title-spacer">{letter}</span>
          <span className="title-glyph">{glyphs[i]}</span>
        </span>
      ))}
    </span>
  );
}

"use client";

import { useEffect, useRef } from "react";

/** Decorative, and hidden from assistive technology, since the same position is already available to it. */
export function ReadingProgress({ targetId }: { targetId: string }) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const target = document.getElementById(targetId);
      const bar = barRef.current;
      if (!target || !bar) return;
      const { top, height } = target.getBoundingClientRect();
      const distance = height - window.innerHeight;
      const progress = distance <= 0 ? 1 : Math.min(1, Math.max(0, -top / distance));
      bar.style.inlineSize = `${progress * 100}%`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [targetId]);

  return (
    <div aria-hidden data-testid="reading-progress" className="pointer-events-none sticky top-(--top-bar-height) z-20 h-0.5 w-full md:top-0">
      <div ref={barRef} className="h-full w-0 bg-brand" />
    </div>
  );
}

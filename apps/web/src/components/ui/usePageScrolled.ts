"use client";

import { useEffect, useState } from "react";

export function usePageScrolled(threshold = 2) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;

    const readScroll = () => {
      const top =
        window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      setScrolled(top > threshold);
    };

    const scheduleRead = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        readScroll();
      });
    };

    readScroll();
    window.addEventListener("scroll", scheduleRead, { passive: true });
    window.addEventListener("resize", scheduleRead);

    return () => {
      window.removeEventListener("scroll", scheduleRead);
      window.removeEventListener("resize", scheduleRead);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [threshold]);

  return scrolled;
}

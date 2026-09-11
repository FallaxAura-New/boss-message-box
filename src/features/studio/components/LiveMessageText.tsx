import { useLayoutEffect, useRef } from "react";

/** Fit actual wrapped text to the available stage; keep readable overflow for long messages. */
export function LiveMessageText({ content }: { content: string }) {
  const regionRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const region = regionRef.current;
    const text = textRef.current;
    if (!region || !text) return;
    let frame = 0;
    let disposed = false;
    const fit = () => {
      const style = getComputedStyle(region);
      const height = region.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (height <= 0 || region.clientWidth <= 0) return;
      const scroll = region.scrollTop;
      text.style.setProperty("--live-fitted-font", "var(--type-live-message-min)");
      let low = parseFloat(getComputedStyle(text).fontSize);
      text.style.setProperty("--live-fitted-font", "var(--type-live-message-max)");
      let high = parseFloat(getComputedStyle(text).fontSize);
      const fits = () => text.offsetHeight <= height && text.scrollWidth <= text.clientWidth + 1;
      if (!fits()) {
        // At most nine measurements, only on resize/content/font changes, never while scrolling.
        for (let step = 0; step < 8 && high - low > 0.25; step++) {
          const mid = (low + high) / 2;
          text.style.setProperty("--live-fitted-font", `${mid}px`);
          if (fits()) low = mid; else high = mid;
        }
        text.style.setProperty("--live-fitted-font", `${low}px`);
      }
      region.scrollTop = scroll;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(region);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    void document.fonts?.ready.then(() => { if (!disposed) schedule(); });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [content]);

  return <div ref={regionRef} className="studio-live-message-text" role="region" aria-label="完整留言正文" tabIndex={0}>
    <p ref={textRef}>{content}</p>
  </div>;
}

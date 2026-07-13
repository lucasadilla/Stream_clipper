"use client";

import { useEffect } from "react";

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function MarketingScrollMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".marketing-home");
    if (!root) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const revealItems = Array.from(
      root.querySelectorAll<HTMLElement>("[data-scroll-reveal]")
    );

    root.classList.add("scroll-motion-ready");

    if (reduceMotion) {
      revealItems.forEach((item) => item.classList.add("is-scroll-visible"));
      return () => root.classList.remove("scroll-motion-ready");
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-scroll-visible");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    revealItems.forEach((item) => observer.observe(item));

    const progressItems = Array.from(
      root.querySelectorAll<HTMLElement>("[data-scroll-progress]")
    );

    const hero = root.querySelector<HTMLElement>("[data-scroll-hero]");
    let frame = 0;

    const updateProgress = () => {
      frame = 0;
      const viewportHeight = Math.max(window.innerHeight, 1);
      const pageRange = Math.max(
        document.documentElement.scrollHeight - viewportHeight,
        1
      );
      root.style.setProperty(
        "--page-scroll-progress",
        String(clamp(window.scrollY / pageRange))
      );

      if (hero) {
        const rect = hero.getBoundingClientRect();
        const heroProgress = clamp(-rect.top / Math.max(rect.height, 1));
        root.style.setProperty("--hero-scroll-progress", String(heroProgress));
        root.style.setProperty("--hero-art-x", `${heroProgress * 4}vw`);
        root.style.setProperty("--hero-art-y", `${heroProgress * -5}vh`);
        root.style.setProperty("--hero-art-scale", String(1 + heroProgress * 0.16));
        root.style.setProperty("--hero-art-opacity", String(0.95 - heroProgress * 0.58));
        root.style.setProperty("--hero-copy-y", `${heroProgress * -7}vh`);
        root.style.setProperty("--hero-copy-opacity", String(1 - heroProgress * 0.72));
      }

      for (const item of progressItems) {
        const rect = item.getBoundingClientRect();
        const progress = clamp(
          (viewportHeight - rect.top) / (viewportHeight + rect.height)
        );
        item.style.setProperty("--section-scroll-progress", String(progress));
        item.style.setProperty(
          "--section-scroll-shift",
          `${(progress - 0.5) * 72}px`
        );
        item.style.setProperty(
          "--section-scroll-parallax",
          `${(progress - 0.5) * -8.64}px`
        );
      }
    };

    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateProgress);
    };

    updateProgress();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      root.classList.remove("scroll-motion-ready");
    };
  }, []);

  return (
    <div className="marketing-scroll-meter" aria-hidden="true">
      <span />
    </div>
  );
}

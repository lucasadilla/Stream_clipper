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
    const warpItems = Array.from(root.children).filter(
      (item): item is HTMLElement => item instanceof HTMLElement && item.tagName === "SECTION"
    );
    warpItems.forEach((item) => item.classList.add("marketing-warp-section"));

    const hero = root.querySelector<HTMLElement>("[data-scroll-hero]");
    let frame = 0;
    let warpFrame = 0;
    let lastScrollY = window.scrollY;
    let lastScrollTime = performance.now();
    let targetVelocity = 0;
    let currentVelocity = 0;

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

    const renderWarp = () => {
      const energy = Math.abs(currentVelocity);
      const viewportHeight = Math.max(window.innerHeight, 1);

      root.classList.toggle("is-scroll-warping", energy > 0.012);
      warpItems.forEach((item, index) => {
        const rect = item.getBoundingClientRect();
        const isNearViewport =
          rect.bottom > -viewportHeight * 0.2 &&
          rect.top < viewportHeight * 1.2;

        if (!isNearViewport || energy <= 0.012) {
          item.classList.remove("is-warp-active");
          return;
        }

        const alternate = index % 2 === 0 ? 1 : -1;
        const direction = currentVelocity < 0 ? -1 : 1;
        const depth = energy * 42;

        item.classList.add("is-warp-active");
        item.style.setProperty(
          "--scroll-warp-top",
          `${-depth + 1}px`
        );
        item.style.setProperty(
          "--scroll-warp-height",
          `${depth + 2}px`
        );
        item.style.setProperty(
          "--scroll-warp-top-x",
          `${energy * alternate * direction * 9}px`
        );
        item.style.setProperty(
          "--scroll-warp-top-skew",
          `${currentVelocity * alternate * 0.55}deg`
        );
        item.style.setProperty(
          "--scroll-warp-top-scale",
          String(1 + energy * 0.025)
        );
      });
    };

    const animateWarp = () => {
      currentVelocity += (targetVelocity - currentVelocity) * 0.22;
      targetVelocity *= 0.88;
      renderWarp();

      if (
        Math.abs(currentVelocity) > 0.002 ||
        Math.abs(targetVelocity) > 0.002
      ) {
        warpFrame = window.requestAnimationFrame(animateWarp);
      } else {
        currentVelocity = 0;
        targetVelocity = 0;
        renderWarp();
        warpFrame = 0;
      }
    };

    const updateVelocity = () => {
      const now = performance.now();
      const elapsed = clamp(now - lastScrollTime, 8, 50);
      const distance = window.scrollY - lastScrollY;
      const pixelsPerMillisecond = distance / elapsed;

      targetVelocity = clamp(pixelsPerMillisecond / 2.1, -1, 1);
      lastScrollY = window.scrollY;
      lastScrollTime = now;

      if (!warpFrame) warpFrame = window.requestAnimationFrame(animateWarp);
      requestUpdate();
    };

    updateProgress();
    window.addEventListener("scroll", updateVelocity, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      if (warpFrame) window.cancelAnimationFrame(warpFrame);
      window.removeEventListener("scroll", updateVelocity);
      window.removeEventListener("resize", requestUpdate);
      warpItems.forEach((item) => {
        item.classList.remove("marketing-warp-section", "is-warp-active");
      });
      root.classList.remove("scroll-motion-ready");
      root.classList.remove("is-scroll-warping");
    };
  }, []);

  return (
    <div className="marketing-scroll-meter" aria-hidden="true">
      <span />
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

function seededRandom() {
  let seed = 7429;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

export function ParticleEditingHero() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const mountNode = mount;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
    camera.position.set(0.1, 0.08, 7.6);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
    mountNode.appendChild(renderer.domElement);

    const random = seededRandom();
    const group = new THREE.Group();
    scene.add(group);

    const positions: number[] = [];
    const colors: number[] = [];
    const phases: number[] = [];
    const amplitudes: number[] = [];
    const driftWeights: number[] = [];

    const green = new THREE.Color("#95ff00");
    const hotGreen = new THREE.Color("#d7ff64");
    const dimGreen = new THREE.Color("#5c8f1d");
    const deepGreen = new THREE.Color("#20350c");
    const white = new THREE.Color("#f8fff0");

    function pushPoint(
      x: number,
      y: number,
      z: number,
      color: THREE.Color,
      jitter = 0.03,
      amplitude = 0.02
    ) {
      positions.push(
        x + (random() - 0.5) * jitter,
        y + (random() - 0.5) * jitter,
        z + (random() - 0.5) * jitter
      );
      colors.push(color.r, color.g, color.b);
      phases.push(random() * Math.PI * 2);
      amplitudes.push(amplitude + random() * amplitude);
      driftWeights.push(0.45 + random() * 1.2);
    }

    function mixedColor(a: THREE.Color, b: THREE.Color, t: number) {
      return a.clone().lerp(b, THREE.MathUtils.clamp(t, 0, 1));
    }

    function addRibbon(
      yOffset: number,
      zOffset: number,
      length: number,
      thickness: number,
      count: number,
      bend: number
    ) {
      for (let i = 0; i < count; i++) {
        const t = i / Math.max(1, count - 1);
        const centered = (t - 0.5) * 2;
        const lane = (random() - 0.5) * thickness;
        const wave =
          Math.sin(t * Math.PI * 3.2 + bend) * 0.5 +
          Math.sin(t * Math.PI * 8.5 + bend * 0.7) * 0.11;
        const x = centered * length + Math.sin(t * Math.PI * 2 + bend) * 0.42;
        const y = yOffset + wave + lane;
        const z =
          zOffset +
          Math.cos(t * Math.PI * 2.6 + bend) * 0.62 +
          Math.sin(t * Math.PI * 9 + bend) * 0.08 +
          (random() - 0.5) * 0.48;
        const brightness = Math.pow(1 - Math.abs(centered), 0.55);
        const color =
          random() > 0.94
            ? white
            : mixedColor(deepGreen, random() > 0.36 ? green : dimGreen, brightness);
        pushPoint(x, y, z, color, 0.045, 0.018 + brightness * 0.035);
      }
    }

    function addParticleArc(
      radiusX: number,
      radiusY: number,
      zOffset: number,
      count: number,
      rotation: number
    ) {
      for (let i = 0; i < count; i++) {
        const t = random();
        const angle = t * Math.PI * 2;
        const band = (random() - 0.5) * 0.34;
        const x = Math.cos(angle) * (radiusX + band);
        const y = Math.sin(angle) * (radiusY + band * 0.55);
        const z = zOffset + Math.sin(angle * 2 + rotation) * 0.64;
        const rotatedX = x * Math.cos(rotation) - z * Math.sin(rotation);
        const rotatedZ = x * Math.sin(rotation) + z * Math.cos(rotation);
        const color =
          random() > 0.9
            ? hotGreen
            : mixedColor(deepGreen, dimGreen, 0.35 + random() * 0.45);
        pushPoint(rotatedX, y, rotatedZ, color, 0.04, 0.028);
      }
    }

    function addDissolveField(count: number) {
      for (let i = 0; i < count; i++) {
        const angle = random() * Math.PI * 2;
        const radius = Math.pow(random(), 0.55) * 5.9;
        const x = Math.cos(angle) * radius + (random() - 0.5) * 0.9;
        const y = (random() - 0.5) * 4.95;
        const z =
          -1.65 +
          Math.sin(angle * 1.7) * 0.95 +
          (random() - 0.5) * 1.35;
        const edgeEnergy = radius / 5.9;
        const color =
          random() > 0.82
            ? mixedColor(green, hotGreen, random() * 0.65)
            : mixedColor(deepGreen, dimGreen, edgeEnergy * 0.65);
        pushPoint(x, y, z, color, 0.075, 0.016 + edgeEnergy * 0.032);
      }
    }

    function addPulseCloud(count: number) {
      for (let i = 0; i < count; i++) {
        const angle = random() * Math.PI * 2;
        const vertical = Math.asin(random() * 2 - 1);
        const radius = 1.35 + Math.pow(random(), 0.42) * 2.75;
        const x = Math.cos(angle) * Math.cos(vertical) * radius;
        const y = Math.sin(vertical) * radius * 0.72;
        const z = Math.sin(angle) * Math.cos(vertical) * radius * 0.58;
        const color =
          random() > 0.74
            ? mixedColor(green, hotGreen, random())
            : mixedColor(deepGreen, dimGreen, random() * 0.75);
        pushPoint(x + 0.35, y - 0.05, z - 0.55, color, 0.06, 0.032);
      }
    }

    addDissolveField(3200);
    addPulseCloud(1800);

    for (let ribbon = 0; ribbon < 9; ribbon++) {
      addRibbon(
        -1.65 + ribbon * 0.42,
        -0.95 + Math.sin(ribbon * 0.8) * 0.55,
        4.6 + ribbon * 0.22,
        0.18 + ribbon * 0.015,
        520,
        ribbon * 0.72
      );
    }

    addParticleArc(3.75, 1.95, -0.55, 1150, 0.38);
    addParticleArc(4.35, 2.35, -0.86, 1320, -0.24);
    addParticleArc(2.85, 1.52, -0.12, 900, 0.92);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const basePositions = Float32Array.from(positions);

    const material = new THREE.PointsMaterial({
      size: 0.04,
      vertexColors: true,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    group.add(points);

    function resize() {
      const rect = mountNode.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);

      const heroScale = width < 640 ? 0.9 : width < 1024 ? 1.05 : 1.28;
      group.scale.setScalar(heroScale);
      group.position.set(
        width < 640 ? 0.15 : width < 1024 ? 0.7 : 1.85,
        width < 640 ? -0.2 : -0.02,
        0
      );

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mountNode);

    // --- Interaction state -------------------------------------------------
    // Pointer position in world space (on the z≈0 plane the cloud sits near),
    // smoothed so the repulsion feels fluid rather than jittery.
    const pointerTarget = new THREE.Vector2(0, 0);
    const pointerSmoothed = new THREE.Vector2(0, 0);
    let pointerActive = false;
    let pointerStrength = 0;

    // Click ripples: expanding shockwaves that push particles outward.
    interface Ripple {
      x: number;
      y: number;
      born: number;
    }
    const ripples: Ripple[] = [];

    // Scroll velocity feeds vertical stretch (ties the hero into page warp).
    let scrollStretch = 0;
    let lastScrollY = window.scrollY;
    let lastScrollTime = performance.now();

    const raycastPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const worldHit = new THREE.Vector3();

    function pointerToWorld(clientX: number, clientY: number): THREE.Vector2 | null {
      const rect = mountNode.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(raycastPlane, worldHit)) return null;
      // Convert to group-local coordinates so repulsion matches particle space.
      const local = group.worldToLocal(worldHit.clone());
      return new THREE.Vector2(local.x, local.y);
    }

    function isInsideHero(clientX: number, clientY: number): boolean {
      const rect = mountNode.getBoundingClientRect();
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    }

    function onPointerMove(event: PointerEvent) {
      if (!isInsideHero(event.clientX, event.clientY)) {
        pointerActive = false;
        return;
      }
      const world = pointerToWorld(event.clientX, event.clientY);
      if (!world) return;
      pointerTarget.copy(world);
      pointerActive = true;
    }

    function onPointerDown(event: PointerEvent) {
      if (!isInsideHero(event.clientX, event.clientY)) return;
      const world = pointerToWorld(event.clientX, event.clientY);
      if (!world) return;
      ripples.push({ x: world.x, y: world.y, born: performance.now() });
      if (ripples.length > 5) ripples.shift();
    }

    function onScroll() {
      const now = performance.now();
      const elapsed = Math.min(Math.max(now - lastScrollTime, 8), 50);
      const velocity = (window.scrollY - lastScrollY) / elapsed;
      scrollStretch = THREE.MathUtils.clamp(velocity, -1.4, 1.4);
      lastScrollY = window.scrollY;
      lastScrollTime = now;
    }

    // Listen on window so particles react even under overlaying hero copy.
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });

    let frameId = 0;
    const startTime = performance.now();
    const positionAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colorAttr = geometry.getAttribute("color") as THREE.BufferAttribute;
    const baseColors = Float32Array.from(colors);

    const REPULSE_RADIUS = 1.55;
    const REPULSE_RADIUS_SQ = REPULSE_RADIUS * REPULSE_RADIUS;
    const RIPPLE_SPEED = 3.4;
    const RIPPLE_LIFE_MS = 1400;

    function renderFrame() {
      const now = performance.now();
      const elapsed = (now - startTime) / 1000;

      if (!prefersReducedMotion) {
        // Smooth pointer + strength (fades out when pointer leaves).
        pointerSmoothed.lerp(pointerTarget, 0.12);
        pointerStrength += ((pointerActive ? 1 : 0) - pointerStrength) * 0.06;
        scrollStretch *= 0.9;

        // Cull dead ripples.
        for (let r = ripples.length - 1; r >= 0; r--) {
          if (now - ripples[r].born > RIPPLE_LIFE_MS) ripples.splice(r, 1);
        }

        const array = positionAttr.array as Float32Array;
        const colorArray = colorAttr.array as Float32Array;
        const stretch = 1 + Math.abs(scrollStretch) * 0.22;
        let colorsDirty = false;

        for (let i = 0; i < array.length; i += 3) {
          const pointIndex = i / 3;
          const phase = phases[pointIndex];
          const amplitude = amplitudes[pointIndex];
          const drift = driftWeights[pointIndex];

          const baseX = basePositions[i];
          const baseY = basePositions[i + 1];
          const baseZ = basePositions[i + 2];

          let x =
            baseX +
            Math.sin(elapsed * 0.42 * drift + phase + baseZ) * amplitude * 0.7;
          let y =
            baseY +
            Math.sin(elapsed * 0.72 * drift + phase + baseX * 0.42) * amplitude;
          const z =
            baseZ +
            Math.cos(elapsed * 0.54 * drift + phase + baseY) * amplitude * 0.8;

          // Scroll warp: stretch vertically away from center, like the page.
          y = y * stretch - scrollStretch * 0.35;

          let glow = 0;

          // Mouse repulsion: particles near the cursor get pushed out along
          // the radial direction and brighten while displaced.
          if (pointerStrength > 0.01) {
            const dx = x - pointerSmoothed.x;
            const dy = y - pointerSmoothed.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < REPULSE_RADIUS_SQ && distSq > 0.0001) {
              const dist = Math.sqrt(distSq);
              const falloff = 1 - dist / REPULSE_RADIUS;
              const push = falloff * falloff * 0.85 * pointerStrength * drift;
              x += (dx / dist) * push;
              y += (dy / dist) * push;
              glow = Math.max(glow, falloff * pointerStrength);
            }
          }

          // Click ripples: ring-shaped shockwave expanding outward.
          for (let r = 0; r < ripples.length; r++) {
            const ripple = ripples[r];
            const age = (now - ripple.born) / 1000;
            const ringRadius = age * RIPPLE_SPEED;
            const life = 1 - (now - ripple.born) / RIPPLE_LIFE_MS;
            const dx = x - ripple.x;
            const dy = y - ripple.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const band = Math.abs(dist - ringRadius);
            if (band < 0.55 && dist > 0.001) {
              const wave = (1 - band / 0.55) * life;
              const push = wave * wave * 0.6;
              x += (dx / dist) * push;
              y += (dy / dist) * push;
              glow = Math.max(glow, wave * 0.9);
            }
          }

          array[i] = x;
          array[i + 1] = y;
          array[i + 2] = z;

          // Brighten displaced particles toward hot green/white.
          const br = baseColors[i];
          const bg = baseColors[i + 1];
          const bb = baseColors[i + 2];
          if (glow > 0.01) {
            colorArray[i] = br + (0.95 - br) * glow;
            colorArray[i + 1] = bg + (1.0 - bg) * glow;
            colorArray[i + 2] = bb + (0.55 - bb) * glow;
            colorsDirty = true;
          } else if (
            colorArray[i] !== br ||
            colorArray[i + 1] !== bg ||
            colorArray[i + 2] !== bb
          ) {
            colorArray[i] = br;
            colorArray[i + 1] = bg;
            colorArray[i + 2] = bb;
            colorsDirty = true;
          }
        }

        positionAttr.needsUpdate = true;
        if (colorsDirty) colorAttr.needsUpdate = true;

        // Camera parallax follows the cursor for depth, on top of idle sway.
        const parallaxX = pointerSmoothed.x * 0.045 * pointerStrength;
        const parallaxY = pointerSmoothed.y * 0.035 * pointerStrength;
        group.rotation.y =
          Math.sin(elapsed * 0.14) * 0.18 - 0.12 + parallaxX;
        group.rotation.x = Math.sin(elapsed * 0.11) * 0.06 - parallaxY;
        group.rotation.z = Math.sin(elapsed * 0.08) * 0.035;
        camera.position.x =
          0.1 + Math.sin(elapsed * 0.1) * 0.16 + parallaxX * 1.6;
        camera.position.y =
          0.08 + Math.sin(elapsed * 0.08) * 0.07 + parallaxY * 1.2;
      } else {
        group.rotation.y = -0.12;
      }

      renderer.render(scene, camera);
      if (!prefersReducedMotion) frameId = requestAnimationFrame(renderFrame);
    }

    renderFrame();

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="marketing-particle-field absolute inset-0 h-full w-full opacity-95"
      aria-hidden="true"
    />
  );
}

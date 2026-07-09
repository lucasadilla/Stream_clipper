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

    let frameId = 0;
    const startTime = performance.now();
    const positionAttr = geometry.getAttribute("position") as THREE.BufferAttribute;

    function renderFrame() {
      const elapsed = (performance.now() - startTime) / 1000;
      if (!prefersReducedMotion) {
        const array = positionAttr.array as Float32Array;
        for (let i = 0; i < array.length; i += 3) {
          const pointIndex = i / 3;
          const phase = phases[pointIndex];
          const amplitude = amplitudes[pointIndex];
          const drift = driftWeights[pointIndex];
          array[i] =
            basePositions[i] +
            Math.sin(elapsed * 0.42 * drift + phase + basePositions[i + 2]) *
              amplitude *
              0.7;
          array[i + 1] =
            basePositions[i + 1] +
            Math.sin(elapsed * 0.72 * drift + phase + basePositions[i] * 0.42) *
              amplitude;
          array[i + 2] =
            basePositions[i + 2] +
            Math.cos(elapsed * 0.54 * drift + phase + basePositions[i + 1]) *
              amplitude *
              0.8;
        }
        positionAttr.needsUpdate = true;
        group.rotation.y = Math.sin(elapsed * 0.14) * 0.18 - 0.12;
        group.rotation.x = Math.sin(elapsed * 0.11) * 0.06;
        group.rotation.z = Math.sin(elapsed * 0.08) * 0.035;
        camera.position.x = 0.1 + Math.sin(elapsed * 0.1) * 0.16;
        camera.position.y = 0.08 + Math.sin(elapsed * 0.08) * 0.07;
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
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="absolute inset-0 h-full w-full opacity-95"
      aria-hidden="true"
    />
  );
}

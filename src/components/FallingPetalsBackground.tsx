import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

type SpriteKind = 'petal' | 'leaf';

interface CachedSprite {
  kind: SpriteKind;
  image: HTMLImageElement;
  fallbackCanvas: HTMLCanvasElement;
  size: number;
}

interface FallingParticle {
  spriteIndex: number;
  x: number;
  y: number;
  vxBase: number;
  vy: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
  tiltPhase: number;
  tiltSpeed: number;
  baseAlpha: number;
}

function renderWatercolorPetalPng(
  primaryColor: string,
  highlightColor: string,
  edgeTint: string,
  veinColor: string,
  blurPx: number
): CachedSprite {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const img = new Image();
  if (!ctx) {
    return { kind: 'petal', image: img, fallbackCanvas: canvas, size };
  }

  ctx.save();
  ctx.translate(size / 2, size / 2);
  if (blurPx > 0 && 'filter' in ctx) {
    ctx.filter = `blur(${blurPx}px)`;
  }

  // Organic curved sunflower petal silhouette filling ~80% of sprite
  const grad = ctx.createRadialGradient(-2, 10, 4, 2, -8, 38);
  grad.addColorStop(0, highlightColor);
  grad.addColorStop(0.52, primaryColor);
  grad.addColorStop(0.88, edgeTint);
  grad.addColorStop(1, 'rgba(233, 185, 78, 0.25)');

  ctx.beginPath();
  ctx.moveTo(0, -37);
  ctx.bezierCurveTo(16, -24, 18, 8, 7, 30);
  ctx.quadraticCurveTo(0, 38, -7, 30);
  ctx.bezierCurveTo(-18, 8, -16, -24, 0, -37);
  ctx.closePath();

  ctx.fillStyle = grad;
  ctx.fill();

  // Watercolor pigment bloom along border
  ctx.strokeStyle = 'rgba(198, 138, 42, 0.36)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Subtle hand-painted veins
  ctx.beginPath();
  ctx.moveTo(0, 27);
  ctx.quadraticCurveTo(1.5, 0, 0, -27);
  ctx.moveTo(-3, 18);
  ctx.quadraticCurveTo(-7, 0, -6, -16);
  ctx.moveTo(3, 18);
  ctx.quadraticCurveTo(7, 0, 6, -16);
  ctx.strokeStyle = veinColor;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();

  img.src = canvas.toDataURL('image/png');
  return { kind: 'petal', image: img, fallbackCanvas: canvas, size };
}

function renderWatercolorLeafPng(
  baseColor: string,
  highlightColor: string,
  edgeTint: string,
  veinColor: string,
  blurPx: number
): CachedSprite {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const img = new Image();
  if (!ctx) {
    return { kind: 'leaf', image: img, fallbackCanvas: canvas, size };
  }

  ctx.save();
  ctx.translate(size / 2, size / 2);
  if (blurPx > 0 && 'filter' in ctx) {
    ctx.filter = `blur(${blurPx}px)`;
  }

  const grad = ctx.createLinearGradient(-14, -32, 16, 32);
  grad.addColorStop(0, highlightColor);
  grad.addColorStop(0.55, baseColor);
  grad.addColorStop(1, edgeTint);

  ctx.beginPath();
  ctx.moveTo(0, -34);
  ctx.bezierCurveTo(17, -14, 15, 14, 0, 34);
  ctx.bezierCurveTo(-15, 14, -17, -14, 0, -34);
  ctx.closePath();

  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = 'rgba(104, 115, 75, 0.28)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Stem & central midrib
  ctx.beginPath();
  ctx.moveTo(0, 38);
  ctx.quadraticCurveTo(1.2, 4, 0, -27);
  ctx.moveTo(0, 10);
  ctx.lineTo(-6, 1);
  ctx.moveTo(0, -2);
  ctx.lineTo(6, -11);
  ctx.strokeStyle = veinColor;
  ctx.lineWidth = 1.1;
  ctx.stroke();

  ctx.restore();

  img.src = canvas.toDataURL('image/png');
  return { kind: 'leaf', image: img, fallbackCanvas: canvas, size };
}

function getTargetParticleCount(): number {
  const width = window.innerWidth;
  const isMobile = width < 768;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 8;
  const memory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 8;
  const isLowPerf = cores <= 4 || memory <= 4;

  // Desktop: 10–15 visible particles | Mobile: 4–7 visible particles
  if (isMobile) {
    return isLowPerf ? 4 : 6;
  }
  return isLowPerf ? 10 : 13;
}

export const FallingPetalsBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { pathname } = useLocation();

  // Keep admin & gift checkout pages calm and distraction-free
  const isCalmRoute =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/pix') ||
    pathname.startsWith('/presentear');

  useEffect(() => {
    if (isCalmRoute) return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motionQuery.matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Transparent PNG watercolor sprites (~70% golden sunflower petals, ~30% olive/sage/dried leaves)
    const sprites: CachedSprite[] = [
      renderWatercolorPetalPng('#E9B94E', '#F8DF8C', '#D69A2B', 'rgba(168, 110, 26, 0.34)', 0),
      renderWatercolorPetalPng('#ECC057', '#FAE59E', '#DC9F30', 'rgba(168, 110, 26, 0.28)', 0.5),
      renderWatercolorPetalPng('#DFA836', '#F4D47A', '#C88922', 'rgba(148, 86, 28, 0.28)', 0),
      renderWatercolorPetalPng('#E9B94E', '#F7DC84', '#D79B2D', 'rgba(168, 110, 26, 0.24)', 1.0),
      renderWatercolorPetalPng('#E4B446', '#F5D67F', '#CE8E26', 'rgba(168, 110, 26, 0.3)', 0),
      renderWatercolorPetalPng('#F0C866', '#FCEAA8', '#E0AA3C', 'rgba(168, 110, 26, 0.26)', 0.4),
      renderWatercolorPetalPng('#D99E32', '#F0C75E', '#BF7F1F', 'rgba(148, 86, 28, 0.28)', 0),
      // ~30% small dried/olive/sage leaves
      renderWatercolorLeafPng('#8D9A75', '#B0BC98', '#68734B', 'rgba(73, 53, 43, 0.32)', 0),
      renderWatercolorLeafPng('#68734B', '#92A07A', '#525C39', 'rgba(73, 53, 43, 0.28)', 0.7),
      renderWatercolorLeafPng('#B56B4E', '#D19D6A', '#8F4C36', 'rgba(111, 68, 48, 0.34)', 0),
    ];

    let viewportW = window.innerWidth;
    let viewportH = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 1.75);

    const resize = () => {
      viewportW = window.innerWidth;
      viewportH = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      canvas.width = Math.floor(viewportW * dpr);
      canvas.height = Math.floor(viewportH * dpr);
      canvas.style.width = `${viewportW}px`;
      canvas.style.height = `${viewportH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();

    const pickHorizontalSpawn = (): { x: number; isCenter: boolean } => {
      const r = Math.random();
      // ~72% in outer side corridors so the central reading text stays uncluttered
      if (r < 0.36) {
        return { x: viewportW * (0.02 + Math.random() * 0.25), isCenter: false };
      }
      if (r < 0.72) {
        return { x: viewportW * (0.73 + Math.random() * 0.25), isCenter: false };
      }
      return { x: viewportW * (0.27 + Math.random() * 0.46), isCenter: true };
    };

    const makeParticle = (spreadOverHeight: boolean): FallingParticle => {
      const spriteIndex = Math.floor(Math.random() * sprites.length);
      const isLeaf = sprites[spriteIndex].kind === 'leaf';
      // 3 depth layers: far, mid, near
      const depthTier = Math.random();
      const depthScale = 0.75 + depthTier * 0.65;
      const { x, isCenter } = pickHorizontalSpawn();

      // Opacity strictly between 40% (0.40) and 80% (0.80); softer when passing behind center
      const tierAlpha = 0.44 + depthTier * 0.34;
      const baseAlpha = isCenter ? Math.max(0.4, tierAlpha * 0.78) : Math.min(0.8, tierAlpha);

      return {
        spriteIndex,
        x,
        y: spreadOverHeight
          ? Math.random() * (viewportH + 60) - 30
          : -42 - Math.random() * 90,
        vxBase: (Math.random() - 0.5) * 9,
        vy: (isLeaf ? 20 : 24) + depthTier * 20,
        size: (isLeaf ? 22 : 25) * depthScale + Math.random() * 6,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.7,
        swayAmp: 12 + Math.random() * 18,
        swayFreq: 0.45 + Math.random() * 0.55,
        swayPhase: Math.random() * Math.PI * 2,
        tiltPhase: Math.random() * Math.PI * 2,
        tiltSpeed: 0.9 + Math.random() * 0.9,
        baseAlpha,
      };
    };

    let targetCount = getTargetParticleCount();
    const particles: FallingParticle[] = Array.from({ length: targetCount }, () =>
      makeParticle(true)
    );

    let rafId: number | null = null;
    let lastTime = performance.now();
    let elapsed = 0;

    const tick = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.min(rawDt, 0.05);
      elapsed += dt;

      ctx.clearRect(0, 0, viewportW, viewportH);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.y += p.vy * dt;
        const breeze = Math.sin(elapsed * p.swayFreq + p.swayPhase) * p.swayAmp;
        p.x += p.vxBase * dt + breeze * dt * 0.95;
        p.rotation += p.rotationSpeed * dt;
        p.tiltPhase += p.tiltSpeed * dt;

        // Gentle horizontal wrapping
        if (p.x < -55) p.x = viewportW + 45;
        if (p.x > viewportW + 55) p.x = -45;

        // Respawn smoothly at top once below viewport bottom
        if (p.y > viewportH + 50) {
          particles[i] = makeParticle(false);
          continue;
        }

        // Gradual fade-in from top & fade-out near bottom
        const topFade = Math.min(1, Math.max(0, (p.y + 42) / 95));
        const bottomFade = Math.min(1, Math.max(0, (viewportH + 25 - p.y) / 115));
        const alpha = p.baseAlpha * topFade * bottomFade;
        if (alpha <= 0.01) continue;

        const sprite = sprites[p.spriteIndex];
        const drawable: CanvasImageSource =
          sprite.image.complete && sprite.image.naturalWidth > 0
            ? sprite.image
            : sprite.fallbackCanvas;

        // Gentle 3D flutter illusion
        const flutterScaleX = 0.64 + 0.36 * Math.abs(Math.cos(p.tiltPhase));

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.scale(flutterScaleX, 1);
        ctx.drawImage(drawable, -p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }

      rafId = window.requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (rafId !== null || document.visibilityState === 'hidden') return;
      lastTime = performance.now();
      rafId = window.requestAnimationFrame(tick);
    };

    const stopLoop = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stopLoop();
      } else {
        startLoop();
      }
    };

    const handleResize = () => {
      resize();
      const nextTarget = getTargetParticleCount();
      if (nextTarget !== targetCount) {
        targetCount = nextTarget;
        while (particles.length > targetCount) particles.pop();
        while (particles.length < targetCount) particles.push(makeParticle(true));
      }
    };

    const handleMotionChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        stopLoop();
        ctx.clearRect(0, 0, viewportW, viewportH);
      } else {
        startLoop();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('resize', handleResize, { passive: true });
    motionQuery.addEventListener('change', handleMotionChange);

    startLoop();

    return () => {
      stopLoop();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('resize', handleResize);
      motionQuery.removeEventListener('change', handleMotionChange);
    };
  }, [isCalmRoute]);

  if (isCalmRoute) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="falling-petals-canvas"
      className="pointer-events-none fixed inset-0 z-[10] select-none"
    />
  );
};

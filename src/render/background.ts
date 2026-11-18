/**
 * Color-reactive and level-reactive full-screen Canvas 2D backdrop inspired by
 * Tetris Effect (parallax starfields, aurora veils, nebula bloom, glowing
 * celestial horizon over a shimmering ocean, reactive shockwaves) and
 * Classic Mobile Tetris (clean glowing 3D-perspective horizon cyber-grid).
 */
import { detectQualityScale, ParticleSystem } from './particles';
import {
  applyPrismaticModulation,
  clamp01,
  darkenRgb,
  getThemeForLevel,
  hexToRgb,
  interpolateThemes,
  lightenRgb,
  mixRgb,
  rgba,
  rgbToHex,
  type RGB,
  type VisualTheme,
} from './themes';

interface Star {
  x: number; // normalized [0..1]
  y: number; // normalized [0..1] of the sky region
  depth: number; // 0.25 .. 1.0 (parallax layer)
  size: number;
  phase: number;
  twinkleSpeed: number;
  flare: boolean;
  tint: number; // 0 = theme star tint, 1 = nebula tint
}

interface StardustMote {
  x: number;
  y: number;
  vy: number;
  vx: number;
  radius: number;
  alpha: number;
  phase: number;
  colorMix: number; // 0 = theme accent, 1 = active piece color
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

interface GroundWave {
  z: number; // 0 = horizon, 1 = viewer
  speed: number;
  color: RGB;
  strength: number;
}

export interface BackgroundOptions {
  qualityScale?: number;
  initialLevel?: number;
  autoResize?: boolean;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function auroraStrengthFor(theme: VisualTheme): number {
  switch (theme.id) {
    case 'emerald-aurora':
      return 1.6;
    case 'prismatic-supernova':
      return 1.35;
    case 'cyan-electric':
      return 0.85;
    case 'solar-crimson':
      return 0.9;
    default:
      return 1;
  }
}

export class BackgroundRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly particles: ParticleSystem;
  private readonly reducedMotion: boolean;

  private width = 1280;
  private height = 720;
  private dpr = 1;
  private qualityScale: number;

  private stars: Star[] = [];
  private dust: StardustMote[] = [];
  private shootingStars: ShootingStar[] = [];
  private groundWaves: GroundWave[] = [];
  private nextShootingStarSec = 4;

  private currentLevel = 1;
  private fromTheme: VisualTheme;
  private toTheme: VisualTheme;
  private activeTheme: VisualTheme;
  private themeTransition = 1;
  private easedThemeT = 1;
  private readonly themeTransitionDurationSec = 1.6;

  private targetPieceRgb: RGB;
  private currentPieceRgb: RGB;
  private pieceColorWeight = 0;
  private targetPieceWeight = 0;

  private pulseEnergy = 0;
  private pulseRgb: RGB;
  private gridScroll = 0;
  private elapsedSec = 0;

  private rafId: number | null = null;
  private lastFrameMs = 0;
  private destroyed = false;
  private resizeListenerBound = false;

  private readonly handleWindowResize = (): void => {
    if (!this.destroyed) {
      this.resize();
    }
  };

  constructor(canvas: HTMLCanvasElement, options?: BackgroundOptions) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.qualityScale = options?.qualityScale ?? detectQualityScale();
    this.particles = new ParticleSystem(this.qualityScale, 160);
    this.reducedMotion = prefersReducedMotion();

    const initialLevel = Math.max(1, options?.initialLevel ?? 1);
    this.currentLevel = initialLevel;
    const initialTheme = getThemeForLevel(initialLevel);
    this.fromTheme = initialTheme;
    this.toTheme = initialTheme;
    this.activeTheme = initialTheme;

    this.targetPieceRgb = initialTheme.accent;
    this.currentPieceRgb = initialTheme.accent;
    this.pulseRgb = initialTheme.accent;

    this.resize();
    this.seedStarfield();
    this.seedStardust();

    if (options?.autoResize !== false && typeof window !== 'undefined') {
      this.resizeListenerBound = true;
      window.addEventListener('resize', this.handleWindowResize, { passive: true });
    }
  }

  public setQualityScale(scale: number): void {
    const clamped = Math.max(0.4, Math.min(1, scale));
    if (Math.abs(clamped - this.qualityScale) < 0.05) return;
    this.qualityScale = clamped;
    this.particles.setQualityScale(clamped, 160);
    this.seedStarfield();
    this.seedStardust();
    this.resize();
  }

  public resize(explicitWidth?: number, explicitHeight?: number): void {
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 720;
    const rawW = explicitWidth ?? (this.canvas.clientWidth || winW);
    const rawH = explicitHeight ?? (this.canvas.clientHeight || winH);

    this.width = Math.max(1, Math.round(rawW));
    this.height = Math.max(1, Math.round(rawH));
    const deviceDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    // The backdrop is soft by nature: cap its resolution for battery-friendly fill rate.
    const dprCap = this.qualityScale < 0.8 ? 1.25 : 1.5;
    this.dpr = Math.min(dprCap, Math.max(1, deviceDpr));

    const pixelW = Math.round(this.width * this.dpr);
    const pixelH = Math.round(this.height * this.dpr);
    if (this.canvas.width !== pixelW || this.canvas.height !== pixelH) {
      this.canvas.width = pixelW;
      this.canvas.height = pixelH;
    }
  }

  public setLevel(level: number, immediate = false): void {
    const safeLevel = Math.max(1, Math.floor(level));
    this.currentLevel = safeLevel;
    const nextTheme = getThemeForLevel(safeLevel);

    if (immediate) {
      this.fromTheme = nextTheme;
      this.toTheme = nextTheme;
      this.activeTheme = nextTheme;
      this.themeTransition = 1;
      this.easedThemeT = 1;
      return;
    }

    if (nextTheme.id !== this.toTheme.id) {
      this.fromTheme = this.activeTheme;
      this.toTheme = nextTheme;
      this.themeTransition = 0;
    }
  }

  public setActiveColor(hexColor: string | null): void {
    if (!hexColor) {
      this.targetPieceWeight = 0;
      return;
    }
    this.targetPieceRgb = hexToRgb(hexColor);
    this.targetPieceWeight = 1;
  }

  public triggerImpact(
    hexColor: string,
    intensity = 0.65,
    originNorm: { x: number; y: number } = { x: 0.5, y: 0.56 }
  ): void {
    const clamped = clamp01(intensity);
    const rgb = hexToRgb(hexColor);
    this.pulseRgb = rgb;
    this.pulseEnergy = Math.min(1.4, Math.max(this.pulseEnergy, clamped));

    const ox = originNorm.x * this.width;
    const oy = originNorm.y * this.height;
    const maxRadius = Math.max(this.width, this.height) * (0.28 + clamped * 0.34);

    this.particles.spawnShockwave(ox, oy, maxRadius, hexColor, {
      lineWidth: 2 + clamped * 2.5,
      durationSec: 0.55 + clamped * 0.25,
      alpha: 0.32 + clamped * 0.3,
    });

    if (clamped >= 0.3) {
      this.spawnGroundWave(rgb, 0.45 + clamped * 0.5, 0.9 + clamped * 0.3);
    }
  }

  public triggerLineClear(
    colors: readonly string[],
    linesCount: number,
    isTetris = false
  ): void {
    const palette = colors.length > 0 ? colors : ['#00E5FF'];
    const leadColor = palette[Math.floor(palette.length / 2)] || palette[0];
    const intensity = isTetris ? 1.25 : Math.min(1.05, 0.48 + linesCount * 0.16);

    this.pulseRgb = hexToRgb(leadColor);
    this.pulseEnergy = Math.min(1.5, Math.max(this.pulseEnergy, intensity));

    const ox = this.width * 0.5;
    const oy = this.height * 0.52;
    const baseRadius = Math.max(this.width, this.height) * (isTetris ? 0.68 : 0.48);

    const ringLimit = isTetris ? Math.min(4, palette.length) : Math.min(2, palette.length);
    for (let i = 0; i < ringLimit; i++) {
      const color = palette[Math.floor((i / ringLimit) * palette.length)] || leadColor;
      this.particles.spawnShockwave(ox, oy, baseRadius * (0.78 + i * 0.14), color, {
        lineWidth: isTetris ? 4.2 : 2.8,
        durationSec: 0.62 + i * 0.11,
        alpha: isTetris ? 0.62 : 0.44,
      });
    }

    // Color waves roll across the horizon ocean in the cleared minos' colors
    const waveCount = isTetris ? 3 : Math.min(2, Math.max(1, linesCount));
    for (let i = 0; i < waveCount; i++) {
      const color = palette[Math.floor(((i + 0.5) / waveCount) * palette.length)] || leadColor;
      this.spawnGroundWave(hexToRgb(color), isTetris ? 1 : 0.75, 0.85 + i * 0.22, -i * 0.12);
    }
  }

  public triggerLevelUp(newLevel: number): void {
    this.setLevel(newLevel, false);
    const nextTheme = getThemeForLevel(newLevel);
    this.triggerImpact(rgbToHex(nextTheme.accent), 1.15, { x: 0.5, y: 0.5 });
  }

  public getCurrentTheme(): VisualTheme {
    return this.activeTheme;
  }

  public start(): void {
    if (this.destroyed || this.rafId !== null || typeof requestAnimationFrame === 'undefined') {
      return;
    }
    this.lastFrameMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const tick = (now: number): void => {
      if (this.destroyed) return;
      const dt = Math.min(50, Math.max(0, now - this.lastFrameMs));
      this.lastFrameMs = now;
      this.update(dt);
      this.render();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public stop(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  public destroy(): void {
    this.destroyed = true;
    this.stop();
    if (this.resizeListenerBound && typeof window !== 'undefined') {
      this.resizeListenerBound = false;
      window.removeEventListener('resize', this.handleWindowResize);
    }
    this.particles.clear();
    this.groundWaves.length = 0;
    this.shootingStars.length = 0;
  }

  public update(dtMs: number): void {
    const dt = Math.min(0.05, Math.max(0, dtMs / 1000));
    if (dt <= 0) return;

    const motion = this.reducedMotion ? 0.35 : 1;
    this.elapsedSec += dt * motion;

    // Smooth theme band crossfade (easeInOutCubic)
    if (this.themeTransition < 1) {
      this.themeTransition = Math.min(
        1,
        this.themeTransition + dt / this.themeTransitionDurationSec
      );
    }
    const tt = this.themeTransition;
    this.easedThemeT = tt < 0.5 ? 4 * tt * tt * tt : 1 - Math.pow(-2 * tt + 2, 3) / 2;

    const blended = interpolateThemes(this.fromTheme, this.toTheme, this.easedThemeT);
    this.activeTheme = applyPrismaticModulation(blended, this.elapsedSec);

    // Exponentially smooth active piece color reactivity
    const colorFollow = 1 - Math.exp(-dt * 4.5);
    this.currentPieceRgb = mixRgb(this.currentPieceRgb, this.targetPieceRgb, colorFollow);
    this.pieceColorWeight += (this.targetPieceWeight - this.pieceColorWeight) * colorFollow;

    // Decay impact pulse smoothly
    this.pulseEnergy *= Math.exp(-dt * 2.8);
    if (this.pulseEnergy < 0.004) this.pulseEnergy = 0;

    // Advance 3D horizon grid (faster at higher levels + during pulses)
    const speedFactor =
      (0.22 + Math.min(15, this.currentLevel) * 0.02 + this.pulseEnergy * 0.35) * motion;
    this.gridScroll = (this.gridScroll + dt * speedFactor) % 1;

    // Drift stardust motes upward
    const boost = (1 + this.pulseEnergy * 1.4) * motion;
    for (let i = 0; i < this.dust.length; i++) {
      const m = this.dust[i];
      m.x += m.vx * dt * boost;
      m.y += m.vy * dt * boost;
      if (m.y < -0.04) {
        m.y = 1.04;
        m.x = Math.random();
      }
      if (m.x < -0.04) m.x = 1.04;
      if (m.x > 1.04) m.x = -0.04;
    }

    // Ground color waves roll toward the viewer
    for (let i = this.groundWaves.length - 1; i >= 0; i--) {
      const wv = this.groundWaves[i];
      wv.z += dt * wv.speed;
      if (wv.z >= 1.05) this.groundWaves.splice(i, 1);
    }

    // Occasional shooting stars
    if (!this.reducedMotion) {
      this.nextShootingStarSec -= dt;
      if (this.nextShootingStarSec <= 0) {
        this.spawnShootingStar();
        this.nextShootingStarSec = (4 + Math.random() * 7) / Math.max(0.5, this.qualityScale);
      }
    }
    for (let i = this.shootingStars.length - 1; i >= 0; i--) {
      const s = this.shootingStars[i];
      s.life += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.life >= s.maxLife) this.shootingStars.splice(i, 1);
    }

    this.particles.update(dtMs);
  }

  public render(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const w = this.width;
    const h = this.height;
    const theme = this.activeTheme;
    const pieceFactor = this.pieceColorWeight;

    const reactiveRgb = mixRgb(theme.accent, this.currentPieceRgb, 0.72 * pieceFactor);
    const glowRgb = mixRgb(reactiveRgb, this.pulseRgb, Math.min(0.75, this.pulseEnergy * 0.65));
    const horizonY = Math.round(h * (h > w ? 0.7 : 0.64));

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // 1. Deep cosmic sky gradient
    const skyTop = mixRgb(theme.skyTop, reactiveRgb, 0.05 * pieceFactor);
    const skyMid = mixRgb(theme.skyMid, reactiveRgb, 0.09 * pieceFactor);
    const skyHorizon = mixRgb(
      theme.skyHorizon,
      glowRgb,
      0.16 * pieceFactor + this.pulseEnergy * 0.14
    );
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyGrad.addColorStop(0, rgba(skyTop, 1));
    skyGrad.addColorStop(0.55, rgba(skyMid, 1));
    skyGrad.addColorStop(1, rgba(skyHorizon, 1));
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, horizonY + 1);

    // Deep ocean / void below the horizon
    const voidGrad = ctx.createLinearGradient(0, horizonY, 0, h);
    voidGrad.addColorStop(0, rgba(mixRgb(skyHorizon, theme.groundVoid, 0.55), 1));
    voidGrad.addColorStop(0.35, rgba(theme.groundVoid, 1));
    voidGrad.addColorStop(1, rgba(darkenRgb(theme.groundVoid, 0.35), 1));
    ctx.fillStyle = voidGrad;
    ctx.fillRect(0, horizonY, w, h - horizonY);

    // 2. Nebula bloom
    this.renderNebulae(ctx, w, h, horizonY, theme, reactiveRgb, glowRgb);

    // 3. Aurora veils
    this.renderAurora(ctx, w, horizonY, theme, reactiveRgb);

    // 4. Parallax starfield + shooting stars
    this.renderStars(ctx, w, horizonY, theme, reactiveRgb);
    this.renderShootingStars(ctx, theme);

    // 5. Glowing celestial orb sitting on the horizon
    this.renderHorizonOrb(ctx, w, h, horizonY, theme, reactiveRgb, glowRgb);

    // 6. Horizon ocean + 3D perspective cyber-grid + rolling color waves
    this.renderPerspectiveHorizon(ctx, w, h, horizonY, theme, reactiveRgb, glowRgb);

    // 7. Shimmering reactive stardust
    this.renderStardust(ctx, w, h, theme, reactiveRgb);

    // 8. Radial shockwaves
    this.particles.renderRings(ctx);

    // 9. Soft vignette that frames the playfield and deepens contrast
    this.renderVignette(ctx, w, h, theme);

    ctx.restore();
  }

  private spawnGroundWave(color: RGB, strength: number, speed: number, zStart = 0): void {
    if (this.groundWaves.length >= 6) this.groundWaves.shift();
    this.groundWaves.push({ z: zStart, speed, color, strength: clamp01(strength) });
  }

  private spawnShootingStar(): void {
    const fromLeft = Math.random() > 0.5;
    const speed = Math.max(this.width, 600) * (0.7 + Math.random() * 0.5);
    const angle = (fromLeft ? 0.18 : Math.PI - 0.18) + (Math.random() - 0.5) * 0.25;
    this.shootingStars.push({
      x: this.width * (fromLeft ? 0.05 + Math.random() * 0.4 : 0.55 + Math.random() * 0.4),
      y: this.height * (0.04 + Math.random() * 0.22),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.6 + speed * 0.12,
      life: 0,
      maxLife: 0.55 + Math.random() * 0.35,
    });
  }

  private renderStars(
    ctx: CanvasRenderingContext2D,
    w: number,
    horizonY: number,
    theme: VisualTheme,
    reactiveRgb: RGB
  ): void {
    const baseStarRgb = mixRgb(theme.starTint, reactiveRgb, 0.16 * this.pieceColorWeight);
    const tintStarRgb = lightenRgb(theme.nebulaSecondary, 0.45);
    const pulseBoost = this.pulseEnergy * 0.25;
    const skyH = horizonY * 0.97;

    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      const twinkle = 0.55 + 0.45 * Math.sin(this.elapsedSec * s.twinkleSpeed + s.phase);
      // Near-horizon stars fade into atmospheric haze
      const haze = 1 - Math.pow(s.y, 3) * 0.75;
      const alpha = Math.min(1, ((0.25 + s.depth * 0.65) * twinkle + pulseBoost * s.depth) * haze);
      if (alpha < 0.03) continue;

      // Parallax drift: near layers move faster
      const driftX = (s.x + this.elapsedSec * 0.004 * s.depth * s.depth) % 1;
      const sx = driftX * w;
      const sy = s.y * skyH;
      const color = s.tint > 0 ? mixRgb(baseStarRgb, tintStarRgb, s.tint) : baseStarRgb;

      ctx.fillStyle = rgba(color, alpha);
      if (s.size < 1.1) {
        ctx.fillRect(sx, sy, s.size * 1.4, s.size * 1.4);
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, s.size, 0, Math.PI * 2);
        ctx.fill();
      }

      if (s.flare && twinkle > 0.7) {
        const len = s.size * (3.4 + this.pulseEnergy * 2.4) * twinkle;
        ctx.strokeStyle = rgba(lightenRgb(color, 0.4), alpha * 0.5);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(sx - len, sy);
        ctx.lineTo(sx + len, sy);
        ctx.moveTo(sx, sy - len);
        ctx.lineTo(sx, sy + len);
        ctx.stroke();
      }
    }
  }

  private renderShootingStars(ctx: CanvasRenderingContext2D, theme: VisualTheme): void {
    if (this.shootingStars.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const s of this.shootingStars) {
      const t = s.life / s.maxLife;
      const alpha = Math.sin(t * Math.PI) * 0.85;
      const tailX = s.x - s.vx * 0.09;
      const tailY = s.y - s.vy * 0.09;
      const grad = ctx.createLinearGradient(tailX, tailY, s.x, s.y);
      grad.addColorStop(0, rgba(theme.starTint, 0));
      grad.addColorStop(1, rgba(lightenRgb(theme.starTint, 0.5), alpha));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private renderNebulae(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    horizonY: number,
    theme: VisualTheme,
    reactiveRgb: RGB,
    glowRgb: RGB
  ): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const driftA = Math.sin(this.elapsedSec * 0.17) * w * 0.04;
    const driftB = Math.cos(this.elapsedSec * 0.13) * h * 0.03;
    const breathe = 1 + Math.sin(this.elapsedSec * 0.4) * 0.05;

    const nebA = mixRgb(theme.nebulaPrimary, reactiveRgb, 0.34 * this.pieceColorWeight);
    const nebB = mixRgb(theme.nebulaSecondary, glowRgb, 0.28 * this.pieceColorWeight);
    const maxDim = Math.max(w, h);

    const r1 = maxDim * (0.48 + this.pulseEnergy * 0.07) * breathe;
    const x1 = w * 0.24 + driftA;
    const y1 = horizonY * 0.4 + driftB;
    const g1 = ctx.createRadialGradient(x1, y1, 0, x1, y1, r1);
    g1.addColorStop(0, rgba(nebA, 0.2 + this.pulseEnergy * 0.1));
    g1.addColorStop(0.45, rgba(nebA, 0.075));
    g1.addColorStop(1, rgba(nebA, 0));
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);

    const r2 = maxDim * (0.52 + this.pulseEnergy * 0.08) / breathe;
    const x2 = w * 0.78 - driftA;
    const y2 = horizonY * 0.56 - driftB;
    const g2 = ctx.createRadialGradient(x2, y2, 0, x2, y2, r2);
    g2.addColorStop(0, rgba(nebB, 0.18 + this.pulseEnergy * 0.11));
    g2.addColorStop(0.5, rgba(nebB, 0.065));
    g2.addColorStop(1, rgba(nebB, 0));
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);

    // Central reactive bloom behind the playfield
    const centerR = maxDim * (0.36 + this.pulseEnergy * 0.18);
    const cx = w * 0.5;
    const cy = h * 0.48;
    const gCenter = ctx.createRadialGradient(cx, cy, 0, cx, cy, centerR);
    gCenter.addColorStop(0, rgba(lightenRgb(glowRgb, 0.25), 0.1 + this.pulseEnergy * 0.28));
    gCenter.addColorStop(0.45, rgba(glowRgb, 0.05 + this.pulseEnergy * 0.12));
    gCenter.addColorStop(1, rgba(glowRgb, 0));
    ctx.fillStyle = gCenter;
    ctx.fillRect(0, 0, w, h);

    ctx.restore();
  }

  private renderAurora(
    ctx: CanvasRenderingContext2D,
    w: number,
    horizonY: number,
    theme: VisualTheme,
    reactiveRgb: RGB
  ): void {
    const strength =
      auroraStrengthFor(this.fromTheme) * (1 - this.easedThemeT) +
      auroraStrengthFor(this.toTheme) * this.easedThemeT;
    const ribbons = this.qualityScale < 0.7 ? 1 : 2;
    const steps = this.qualityScale < 0.7 ? 14 : 22;
    const t = this.elapsedSec;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let j = 0; j < ribbons; j++) {
      const baseY = horizonY * (0.26 + j * 0.17);
      const amp = horizonY * (0.07 - j * 0.015);
      const thickness = horizonY * (0.15 - j * 0.03);
      const color =
        j === 0
          ? mixRgb(theme.nebulaPrimary, reactiveRgb, 0.3 * this.pieceColorWeight)
          : mixRgb(theme.nebulaSecondary, theme.gridPrimary, 0.25);
      const alpha = (0.075 + this.pulseEnergy * 0.05) * strength;

      const topY = (x: number): number =>
        baseY +
        Math.sin(x * 0.0042 + t * (0.32 + j * 0.1) + j * 2.1) * amp +
        Math.sin(x * 0.011 - t * (0.21 + j * 0.07)) * amp * 0.35;

      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * w;
        const y = topY(x);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = steps; i >= 0; i--) {
        const x = (i / steps) * w;
        const curtain = thickness * (0.75 + 0.25 * Math.sin(x * 0.007 + t * 0.5 + j));
        ctx.lineTo(x, topY(x) + curtain);
      }
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, baseY - amp, 0, baseY + amp + thickness);
      grad.addColorStop(0, rgba(color, 0));
      grad.addColorStop(0.3, rgba(lightenRgb(color, 0.3), alpha));
      grad.addColorStop(0.65, rgba(color, alpha * 0.55));
      grad.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.restore();
  }

  private renderHorizonOrb(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    horizonY: number,
    theme: VisualTheme,
    reactiveRgb: RGB,
    glowRgb: RGB
  ): void {
    const vx = w * 0.5;
    const baseR = Math.min(w, h) * 0.13 * (1 + this.pulseEnergy * 0.12);
    const orbRgb = mixRgb(lightenRgb(theme.accent, 0.15), reactiveRgb, 0.3 * this.pieceColorWeight);
    const orbGlow = mixRgb(orbRgb, glowRgb, Math.min(0.6, this.pulseEnergy * 0.6));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Wide atmospheric halo (spills slightly over the horizon)
    const haloR = baseR * 3.2;
    const halo = ctx.createRadialGradient(vx, horizonY, 0, vx, horizonY, haloR);
    halo.addColorStop(0, rgba(orbGlow, 0.22 + this.pulseEnergy * 0.16));
    halo.addColorStop(0.4, rgba(orbGlow, 0.07));
    halo.addColorStop(1, rgba(orbGlow, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(vx - haloR, horizonY - haloR, haloR * 2, haloR * 1.35);

    // Orb disc, half-sunk beneath the horizon
    ctx.beginPath();
    ctx.rect(0, 0, w, horizonY);
    ctx.clip();
    const disc = ctx.createRadialGradient(vx, horizonY - baseR * 0.15, 0, vx, horizonY, baseR);
    disc.addColorStop(0, rgba(lightenRgb(orbRgb, 0.75), 0.5));
    disc.addColorStop(0.6, rgba(lightenRgb(orbRgb, 0.3), 0.3));
    disc.addColorStop(0.92, rgba(orbRgb, 0.16));
    disc.addColorStop(1, rgba(orbRgb, 0));
    ctx.fillStyle = disc;
    ctx.fillRect(vx - baseR, horizonY - baseR, baseR * 2, baseR);

    // Delicate horizontal cuts through the lower disc (Classic Mobile neon touch)
    ctx.globalCompositeOperation = 'destination-out';
    const cuts = 4;
    for (let i = 0; i < cuts; i++) {
      const cy = horizonY - baseR * (0.1 + i * 0.13);
      const ch = Math.max(1, baseR * (0.05 - i * 0.009));
      ctx.fillStyle = `rgba(0, 0, 0, ${(0.5 - i * 0.08).toFixed(3)})`;
      ctx.fillRect(vx - baseR, cy, baseR * 2, ch);
    }

    ctx.restore();
  }

  private renderPerspectiveHorizon(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    horizonY: number,
    theme: VisualTheme,
    reactiveRgb: RGB,
    glowRgb: RGB
  ): void {
    const gridColor = mixRgb(theme.gridPrimary, reactiveRgb, 0.38 * this.pieceColorWeight);
    const rayColor = mixRgb(theme.gridSecondary, glowRgb, 0.3 * this.pieceColorWeight);
    const groundHeight = Math.max(1, h - horizonY);
    const vanishX = w * 0.5;
    const pulse = this.pulseEnergy;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Horizon glow band
    const bandHeight = Math.max(48, h * 0.12);
    const horizonGrad = ctx.createLinearGradient(0, horizonY - bandHeight * 0.65, 0, horizonY + bandHeight * 0.85);
    horizonGrad.addColorStop(0, rgba(gridColor, 0));
    horizonGrad.addColorStop(0.48, rgba(lightenRgb(glowRgb, 0.3), 0.22 + pulse * 0.22));
    horizonGrad.addColorStop(0.52, rgba(gridColor, 0.18 + pulse * 0.16));
    horizonGrad.addColorStop(1, rgba(gridColor, 0));
    ctx.fillStyle = horizonGrad;
    ctx.fillRect(0, horizonY - bandHeight * 0.65, w, bandHeight * 1.5);

    // Shimmering ocean reflection of the celestial orb
    const orbR = Math.min(w, h) * 0.13;
    const reflectRgb = lightenRgb(mixRgb(theme.accent, reactiveRgb, 0.3 * this.pieceColorWeight), 0.4);
    const strips = this.qualityScale < 0.7 ? 9 : 14;
    for (let k = 0; k < strips; k++) {
      const depth = k / strips;
      const sy = horizonY + 2 + Math.pow(k, 1.55) * 2.6;
      if (sy > h) break;
      const wobble = Math.sin(this.elapsedSec * 2.2 + k * 1.3) * orbR * 0.12;
      const span = orbR * (1.5 - depth * 0.9) * (0.75 + 0.25 * Math.sin(this.elapsedSec * 1.6 + k * 2.1));
      const alpha = (0.2 - depth * 0.16 + pulse * 0.1) * (0.7 + 0.3 * Math.sin(this.elapsedSec * 3 + k));
      if (alpha <= 0.01) continue;
      ctx.fillStyle = rgba(reflectRgb, alpha);
      ctx.fillRect(vanishX - span * 0.5 + wobble, sy, span, 1 + depth * 1.8);
    }

    // Clip to ground for the perspective grid
    ctx.beginPath();
    ctx.rect(0, horizonY, w, groundHeight);
    ctx.clip();

    // Converging perspective rays (batched into two strokes for performance)
    const rayCount = w < 640 ? 12 : 20;
    const spread = w * 1.85;
    const rayGrad = ctx.createLinearGradient(0, horizonY, 0, h);
    rayGrad.addColorStop(0, rgba(rayColor, 0.03));
    rayGrad.addColorStop(0.3, rgba(gridColor, 0.14 + pulse * 0.08));
    rayGrad.addColorStop(1, rgba(gridColor, 0.3 + pulse * 0.14));
    ctx.strokeStyle = rayGrad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -rayCount; i <= rayCount; i++) {
      const ratio = i / rayCount;
      ctx.moveTo(vanishX + ratio * 16, horizonY);
      ctx.lineTo(vanishX + ratio * spread, h);
    }
    ctx.stroke();

    // Brighter central lane rays draw the eye toward the playfield
    const centerGrad = ctx.createLinearGradient(0, horizonY, 0, h);
    centerGrad.addColorStop(0, rgba(gridColor, 0));
    centerGrad.addColorStop(1, rgba(lightenRgb(gridColor, 0.2), 0.2 + pulse * 0.12));
    ctx.strokeStyle = centerGrad;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    const centerRays = Math.max(2, Math.round(rayCount * 0.3));
    for (let i = -centerRays; i <= centerRays; i++) {
      const ratio = i / rayCount;
      ctx.moveTo(vanishX + ratio * 16, horizonY);
      ctx.lineTo(vanishX + ratio * spread, h);
    }
    ctx.stroke();

    // Scrolling horizontal depth lines
    const lineCount = w < 640 ? 11 : 15;
    for (let i = 0; i < lineCount; i++) {
      const z = ((i + this.gridScroll) / lineCount) % 1;
      const perspective = Math.pow(z, 2.25);
      const y = horizonY + perspective * groundHeight;
      const alpha = 0.05 + perspective * 0.34 + pulse * 0.16 * perspective;
      ctx.strokeStyle = rgba(lightenRgb(gridColor, perspective * 0.25), alpha);
      ctx.lineWidth = 0.7 + perspective * 1.3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Color-reactive waves rolling across the ocean grid
    for (const wv of this.groundWaves) {
      if (wv.z <= 0) continue;
      const z = Math.min(1, wv.z);
      const perspective = Math.pow(z, 2.25);
      const y = horizonY + perspective * groundHeight;
      const fade = wv.strength * Math.pow(1 - z, 0.6);
      if (fade <= 0.01) continue;
      const band = 4 + perspective * groundHeight * 0.22;

      const g = ctx.createLinearGradient(0, y - band, 0, y + band * 0.4);
      g.addColorStop(0, rgba(wv.color, 0));
      g.addColorStop(0.75, rgba(wv.color, fade * 0.3));
      g.addColorStop(1, rgba(wv.color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, y - band, w, band * 1.4);

      ctx.strokeStyle = rgba(lightenRgb(wv.color, 0.5), fade * 0.75);
      ctx.lineWidth = 1 + perspective * 2.2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.restore();

    // Crisp luminous horizon seam (drawn outside the clip so it sits on top)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(lightenRgb(glowRgb, 0.55), 0.45 + pulse * 0.38);
    ctx.lineWidth = 1.4 + pulse * 1.2;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(w, horizonY);
    ctx.stroke();
    ctx.restore();
  }

  private renderStardust(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    theme: VisualTheme,
    reactiveRgb: RGB
  ): void {
    if (this.dust.length === 0) return;
    const lowQuality = this.qualityScale < 0.7;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < this.dust.length; i++) {
      const m = this.dust[i];
      const shimmer = 0.55 + 0.45 * Math.sin(this.elapsedSec * 2.1 + m.phase);
      const alpha = m.alpha * shimmer * (1 + this.pulseEnergy * 0.4);
      const color = mixRgb(
        theme.accent,
        reactiveRgb,
        m.colorMix * (0.4 + 0.6 * this.pieceColorWeight)
      );
      const x = m.x * w;
      const y = m.y * h;
      const r = m.radius * (1 + this.pulseEnergy * 0.25);

      if (!lowQuality) {
        ctx.fillStyle = rgba(color, alpha * 0.28);
        ctx.beginPath();
        ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = rgba(lightenRgb(color, 0.5), alpha * 0.9);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private renderVignette(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    theme: VisualTheme
  ): void {
    const inner = Math.min(w, h) * 0.38;
    const outer = Math.hypot(w, h) * 0.62;
    const vg = ctx.createRadialGradient(w * 0.5, h * 0.48, inner, w * 0.5, h * 0.48, outer);
    const edge = darkenRgb(theme.skyTop, 0.5);
    vg.addColorStop(0, rgba(edge, 0));
    vg.addColorStop(1, rgba(edge, 0.62));
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  private seedStarfield(): void {
    const count = Math.round(180 * this.qualityScale);
    this.stars = [];
    for (let i = 0; i < count; i++) {
      // Bias toward many faint far stars and fewer bright near ones
      const depth = 0.25 + Math.pow(Math.random(), 1.8) * 0.75;
      this.stars.push({
        x: Math.random(),
        y: Math.pow(Math.random(), 0.85),
        depth,
        size: 0.5 + depth * 1.35,
        phase: Math.random() * Math.PI * 2,
        twinkleSpeed: 0.9 + Math.random() * 2.4,
        flare: depth > 0.82 && Math.random() > 0.5,
        tint: Math.random() > 0.78 ? 0.4 + Math.random() * 0.5 : 0,
      });
    }
  }

  private seedStardust(): void {
    const count = Math.round(60 * this.qualityScale);
    this.dust = [];
    for (let i = 0; i < count; i++) {
      this.dust.push({
        x: Math.random(),
        y: Math.random(),
        vy: -(0.012 + Math.random() * 0.028),
        vx: (Math.random() - 0.5) * 0.01,
        radius: 0.9 + Math.random() * 1.7,
        alpha: 0.2 + Math.random() * 0.4,
        phase: Math.random() * Math.PI * 2,
        colorMix: 0.35 + Math.random() * 0.65,
      });
    }
  }
}

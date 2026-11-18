/**
 * High-performance Canvas 2D particle, shockwave, light-beam, row-flash,
 * and floating callout system with mobile-aware particle budgets.
 *
 * Visual language: Tetris Effect (luminous additive sparks, lingering embers,
 * soft radial shockwaves) + Classic Mobile Tetris (crisp white-hot row flash,
 * clean bold callouts).
 */
import { hexToRgb, lightenRgb, rgba, type RGB } from './themes';

export interface SparkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
  color: RGB;
  kind: 'spark' | 'shard' | 'stardust' | 'ember';
  rotation: number;
  vr: number;
  /** Optional per-particle twinkle phase (embers / stardust). */
  phase?: number;
}

export interface ShockwaveRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  lineWidth: number;
  life: number;
  maxLife: number;
  color: RGB;
  alpha: number;
}

export interface HardDropBeam {
  x: number;
  yTop: number;
  yBottom: number;
  width: number;
  life: number;
  maxLife: number;
  color: RGB;
}

export interface RowFlash {
  row: number;
  life: number;
  maxLife: number;
  colors: RGB[];
}

export interface CellFlash {
  x: number;
  y: number;
  size: number;
  life: number;
  maxLife: number;
  color: RGB;
}

export interface FloatingCallout {
  text: string;
  subtext?: string;
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  color: RGB;
  scale: number;
}

const WHITE: RGB = { r: 255, g: 255, b: 255 };

export function detectQualityScale(): number {
  if (typeof window === 'undefined') {
    return 1;
  }

  let scale = 1;
  const isCoarsePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const minDim = Math.min(window.innerWidth || 1024, window.innerHeight || 768);
  const cores =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 4;

  if (isCoarsePointer || minDim < 680) {
    scale *= 0.65;
  }
  if (cores <= 4) {
    scale *= 0.85;
  }
  return Math.max(0.45, Math.min(1, scale));
}

function easeOutCubic(t: number): number {
  const k = 1 - Math.min(1, Math.max(0, t));
  return 1 - k * k * k;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const k = Math.min(1, Math.max(0, t)) - 1;
  return 1 + c3 * k * k * k + c1 * k * k;
}

export class ParticleSystem {
  private particles: SparkParticle[] = [];
  private rings: ShockwaveRing[] = [];
  private beams: HardDropBeam[] = [];
  private rowFlashes: RowFlash[] = [];
  private cellFlashes: CellFlash[] = [];
  private callouts: FloatingCallout[] = [];
  private maxParticles: number;
  private qualityScale: number;

  constructor(qualityScale = detectQualityScale(), maxDesktopParticles = 340) {
    this.qualityScale = Math.max(0.35, Math.min(1, qualityScale));
    this.maxParticles = Math.round(maxDesktopParticles * this.qualityScale);
  }

  public setQualityScale(scale: number, maxDesktopParticles = 340): void {
    this.qualityScale = Math.max(0.35, Math.min(1, scale));
    this.maxParticles = Math.round(maxDesktopParticles * this.qualityScale);
    if (this.particles.length > this.maxParticles) {
      this.particles.splice(0, this.particles.length - this.maxParticles);
    }
  }

  public getQualityScale(): number {
    return this.qualityScale;
  }

  public clear(): void {
    this.particles.length = 0;
    this.rings.length = 0;
    this.beams.length = 0;
    this.rowFlashes.length = 0;
    this.cellFlashes.length = 0;
    this.callouts.length = 0;
  }

  private pushParticle(p: SparkParticle): void {
    if (this.particles.length >= this.maxParticles) {
      this.particles.shift();
    }
    this.particles.push(p);
  }

  public spawnShockwave(
    x: number,
    y: number,
    maxRadius: number,
    colorHex: string,
    options?: { lineWidth?: number; durationSec?: number; alpha?: number }
  ): void {
    if (this.rings.length >= 24) {
      this.rings.shift();
    }
    this.rings.push({
      x,
      y,
      radius: Math.max(6, maxRadius * 0.06),
      maxRadius,
      lineWidth: options?.lineWidth ?? 3,
      life: 0,
      maxLife: options?.durationSec ?? 0.65,
      color: hexToRgb(colorHex),
      alpha: options?.alpha ?? 0.72,
    });
  }

  public spawnHardDropBeam(
    x: number,
    yTop: number,
    yBottom: number,
    width: number,
    colorHex: string
  ): void {
    if (this.beams.length >= 12) {
      this.beams.shift();
    }
    this.beams.push({
      x,
      yTop,
      yBottom,
      width,
      life: 0,
      maxLife: 0.32,
      color: hexToRgb(colorHex),
    });
  }

  public spawnImpactSparks(
    x: number,
    y: number,
    colorHex: string,
    count = 14,
    speed = 190
  ): void {
    const scaledCount = Math.max(3, Math.round(count * this.qualityScale));
    const baseRgb = hexToRgb(colorHex);
    for (let i = 0; i < scaledCount; i++) {
      // Upward fan biased sideways so sparks "skid" along the stack surface
      const angle = -Math.PI + Math.random() * Math.PI;
      const v = speed * (0.45 + Math.random() * 0.85);
      this.pushParticle({
        x: x + (Math.random() - 0.5) * 16,
        y: y + (Math.random() - 0.5) * 5,
        vx: Math.cos(angle) * v * 1.15,
        vy: Math.sin(angle) * v * 0.75 - 18,
        size: 1.4 + Math.random() * 2.2,
        alpha: 1,
        life: 0,
        maxLife: 0.3 + Math.random() * 0.3,
        gravity: 420,
        drag: 0.93,
        color: Math.random() > 0.4 ? baseRgb : lightenRgb(baseRgb, 0.6),
        kind: 'spark',
        rotation: 0,
        vr: 0,
      });
    }
  }

  public spawnLineClearBurst(
    rowCenterY: number,
    boardX: number,
    boardWidth: number,
    cellSize: number,
    cellColors: string[],
    isTetris: boolean
  ): void {
    const cols = cellColors.length > 0 ? cellColors.length : 10;
    const sparksPerCell = Math.max(
      1,
      Math.round((isTetris ? 4 : 2.5) * this.qualityScale)
    );

    for (let c = 0; c < cols; c++) {
      const hex = cellColors[c] || '#00E5FF';
      const baseRgb = hexToRgb(hex);
      const cx = boardX + (c + 0.5) * (boardWidth / cols);
      // Shards fly outward from the row center, so the clear "bursts" open
      const outward = (c + 0.5) / cols - 0.5;

      for (let i = 0; i < sparksPerCell; i++) {
        const isShard = i === 0;
        const spread = isTetris ? 360 : 260;
        const vx = outward * spread * 1.4 + (Math.random() - 0.5) * spread * 0.6;
        const vy = -(40 + Math.random() * (isTetris ? 260 : 190));
        this.pushParticle({
          x: cx + (Math.random() - 0.5) * cellSize * 0.5,
          y: rowCenterY + (Math.random() - 0.5) * cellSize * 0.4,
          vx,
          vy,
          size: isShard ? cellSize * (0.22 + Math.random() * 0.16) : 1.6 + Math.random() * 2.2,
          alpha: 1,
          life: 0,
          maxLife: (isTetris ? 0.7 : 0.52) + Math.random() * 0.3,
          gravity: isShard ? 520 : 260,
          drag: 0.955,
          color: isShard ? baseRgb : lightenRgb(baseRgb, 0.5),
          kind: isShard ? 'shard' : 'spark',
          rotation: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 12,
        });
      }
    }

    // Lingering luminous embers that drift upward (Tetris Effect afterglow)
    const emberCount = Math.max(3, Math.round((isTetris ? 16 : 7) * this.qualityScale));
    for (let i = 0; i < emberCount; i++) {
      const hex = cellColors[Math.floor(Math.random() * cols)] || '#FFFFFF';
      this.pushParticle({
        x: boardX + Math.random() * boardWidth,
        y: rowCenterY + (Math.random() - 0.5) * cellSize,
        vx: (Math.random() - 0.5) * 30,
        vy: -(24 + Math.random() * 46),
        size: 1.2 + Math.random() * 1.8,
        alpha: 0.9,
        life: 0,
        maxLife: 1.1 + Math.random() * 0.9,
        gravity: -10,
        drag: 0.985,
        color: lightenRgb(hexToRgb(hex), 0.35),
        kind: 'ember',
        rotation: 0,
        vr: 0,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  public spawnRowFlash(row: number, colors: string[]): void {
    if (this.rowFlashes.length >= 12) {
      this.rowFlashes.shift();
    }
    this.rowFlashes.push({
      row,
      life: 0,
      maxLife: 0.42,
      colors: colors.map((c) => hexToRgb(c)),
    });
  }

  public spawnCellFlash(x: number, y: number, size: number, colorHex: string): void {
    if (this.cellFlashes.length >= 40) {
      this.cellFlashes.shift();
    }
    this.cellFlashes.push({
      x,
      y,
      size,
      life: 0,
      maxLife: 0.26,
      color: hexToRgb(colorHex),
    });
  }

  public spawnCallout(
    text: string,
    x: number,
    y: number,
    colorHex: string,
    options?: { subtext?: string; scale?: number; durationSec?: number }
  ): void {
    if (this.callouts.length >= 6) {
      this.callouts.shift();
    }
    // Stack simultaneous callouts (e.g. TETRIS! + ALL CLEAR! + LEVEL UP!) so they never overlap
    let stacked = 0;
    for (const c of this.callouts) {
      if (c.life < 0.35 && Math.abs(c.x - x) < 40) stacked += 1;
    }
    this.callouts.push({
      text,
      subtext: options?.subtext,
      x,
      y: y + stacked * 46,
      vy: -30,
      life: 0,
      maxLife: options?.durationSec ?? 1.15,
      color: hexToRgb(colorHex),
      scale: options?.scale ?? 1,
    });
  }

  public update(dtMs: number): void {
    const dt = Math.min(0.05, Math.max(0, dtMs / 1000));
    if (dt <= 0) return;

    // Particles (compact in place to avoid O(n^2) splices)
    let write = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) continue;
      const damp = Math.pow(p.drag, dt * 60);
      p.vx *= damp;
      p.vy = p.vy * damp + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.vr * dt;
      this.particles[write++] = p;
    }
    this.particles.length = write;

    // Shockwave rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life += dt;
      if (r.life >= r.maxLife) {
        this.rings.splice(i, 1);
        continue;
      }
      r.radius = r.maxRadius * (0.08 + easeOutCubic(r.life / r.maxLife) * 0.92);
    }

    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life += dt;
      if (b.life >= b.maxLife) this.beams.splice(i, 1);
    }

    for (let i = this.rowFlashes.length - 1; i >= 0; i--) {
      const f = this.rowFlashes[i];
      f.life += dt;
      if (f.life >= f.maxLife) this.rowFlashes.splice(i, 1);
    }

    for (let i = this.cellFlashes.length - 1; i >= 0; i--) {
      const cf = this.cellFlashes[i];
      cf.life += dt;
      if (cf.life >= cf.maxLife) this.cellFlashes.splice(i, 1);
    }

    for (let i = this.callouts.length - 1; i >= 0; i--) {
      const c = this.callouts[i];
      c.life += dt;
      if (c.life >= c.maxLife) {
        this.callouts.splice(i, 1);
        continue;
      }
      c.y += c.vy * dt;
      c.vy *= Math.pow(0.94, dt * 60);
    }
  }

  public renderBeams(ctx: CanvasRenderingContext2D): void {
    if (this.beams.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i];
      const progress = b.life / b.maxLife;
      const fade = (1 - progress) * (1 - progress);
      const height = Math.max(0, b.yBottom - b.yTop);
      if (height <= 0 || fade <= 0.01) continue;

      // Beam retracts downward toward the landing point as it fades
      const top = b.yTop + height * easeOutCubic(progress) * 0.65;
      const h = b.yBottom - top;

      // Soft wide halo
      const halo = ctx.createLinearGradient(0, top, 0, b.yBottom);
      halo.addColorStop(0, rgba(b.color, 0));
      halo.addColorStop(0.6, rgba(b.color, fade * 0.18));
      halo.addColorStop(1, rgba(b.color, fade * 0.42));
      ctx.fillStyle = halo;
      ctx.fillRect(b.x - b.width * 0.12, top, b.width * 1.24, h);

      // Bright narrow core
      const coreW = b.width * (0.42 - progress * 0.2);
      const core = ctx.createLinearGradient(0, top, 0, b.yBottom);
      core.addColorStop(0, rgba(WHITE, 0));
      core.addColorStop(0.7, rgba(lightenRgb(b.color, 0.55), fade * 0.35));
      core.addColorStop(1, rgba(lightenRgb(b.color, 0.8), fade * 0.7));
      ctx.fillStyle = core;
      ctx.fillRect(b.x + (b.width - coreW) * 0.5, top, coreW, h);
    }
    ctx.restore();
  }

  public renderRowFlashes(
    ctx: CanvasRenderingContext2D,
    boardX: number,
    boardY: number,
    boardWidth: number,
    cellSize: number
  ): void {
    if (this.rowFlashes.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.rowFlashes.length; i++) {
      const f = this.rowFlashes[i];
      const t = f.life / f.maxLife;
      const y = boardY + f.row * cellSize;
      const cx = boardX + boardWidth * 0.5;

      // Colored afterglow matching the cleared minos, swelling vertically
      const glowAlpha = Math.sin(Math.min(1, t) * Math.PI) * 0.8;
      if (glowAlpha > 0.01) {
        const grad = ctx.createLinearGradient(boardX, y, boardX + boardWidth, y);
        const count = f.colors.length || 1;
        for (let c = 0; c < count; c++) {
          const stop = count === 1 ? 0.5 : c / (count - 1);
          const color = f.colors[c] ?? WHITE;
          grad.addColorStop(stop, rgba(lightenRgb(color, 0.35), glowAlpha * 0.7));
        }
        ctx.fillStyle = grad;
        const swell = easeOutCubic(t) * cellSize * 0.6;
        ctx.fillRect(boardX, y - swell * 0.5, boardWidth, cellSize + swell);
      }

      // White-hot core sweeping open from the center outward
      const sweep = easeOutCubic(Math.min(1, t * 3.2));
      const whiteAlpha = Math.max(0, 1 - t * 1.9);
      if (whiteAlpha > 0.01) {
        const halfW = boardWidth * 0.5 * sweep;
        const coreH = cellSize * (0.8 - t * 0.55);
        const coreY = y + (cellSize - coreH) * 0.5;
        const wg = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
        wg.addColorStop(0, rgba(WHITE, 0));
        wg.addColorStop(0.12, rgba(WHITE, whiteAlpha * 0.9));
        wg.addColorStop(0.88, rgba(WHITE, whiteAlpha * 0.9));
        wg.addColorStop(1, rgba(WHITE, 0));
        ctx.fillStyle = wg;
        ctx.fillRect(cx - halfW, coreY, halfW * 2, coreH);
      }
    }
    ctx.restore();
  }

  public renderCellFlashes(ctx: CanvasRenderingContext2D): void {
    if (this.cellFlashes.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.cellFlashes.length; i++) {
      const cf = this.cellFlashes[i];
      const t = cf.life / cf.maxLife;
      const alpha = (1 - t) * (1 - t) * 0.7;
      if (alpha <= 0.01) continue;
      const inset = 1 + t * cf.size * 0.12;
      ctx.fillStyle = rgba(lightenRgb(cf.color, 0.6), alpha);
      ctx.fillRect(cf.x + inset, cf.y + inset, cf.size - inset * 2, cf.size - inset * 2);
    }
    ctx.restore();
  }

  public renderRings(ctx: CanvasRenderingContext2D): void {
    if (this.rings.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const t = r.life / r.maxLife;
      const alpha = r.alpha * (1 - t) * (1 - t);
      if (alpha <= 0.008) continue;

      // Soft wide outer band
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(r.color, alpha * 0.35);
      ctx.lineWidth = Math.max(2, r.lineWidth * 3.2 * (1 - t * 0.5));
      ctx.stroke();

      // Crisp bright leading edge
      ctx.strokeStyle = rgba(lightenRgb(r.color, 0.45), alpha);
      ctx.lineWidth = Math.max(1, r.lineWidth * (1 - t * 0.65));
      ctx.stroke();

      // Faint trailing echo ring
      if (r.radius > 24) {
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius * 0.8, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(r.color, alpha * 0.3);
        ctx.lineWidth = Math.max(1, r.lineWidth * 0.6);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  public renderParticles(ctx: CanvasRenderingContext2D): void {
    if (this.particles.length === 0) return;
    const lowQuality = this.qualityScale < 0.7;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const t = p.life / p.maxLife;
      let alpha = p.alpha * (1 - t);

      if (p.kind === 'shard') {
        if (alpha <= 0.01) continue;
        const s = p.size * (1 - t * 0.45);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = rgba(p.color, alpha);
        ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
        ctx.fillStyle = rgba(WHITE, alpha * 0.55);
        ctx.fillRect(-s * 0.5, -s * 0.5, s, s * 0.22);
        ctx.restore();
        continue;
      }

      if (p.kind === 'ember' || p.kind === 'stardust') {
        // Fade in, gentle twinkle, fade out
        const fadeIn = Math.min(1, t * 6);
        const twinkle = 0.65 + 0.35 * Math.sin(p.life * 9 + (p.phase ?? 0));
        alpha = p.alpha * fadeIn * (1 - t) * twinkle;
      } else {
        alpha *= 1 - t * 0.3;
      }
      if (alpha <= 0.01) continue;

      const radius = p.size * (1 - t * 0.3);
      if (!lowQuality) {
        ctx.fillStyle = rgba(p.color, alpha * 0.28);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = rgba(lightenRgb(p.color, 0.5), alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  public renderCallouts(ctx: CanvasRenderingContext2D, baseFontPx = 18): void {
    if (this.callouts.length === 0) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < this.callouts.length; i++) {
      const c = this.callouts[i];
      const t = c.life / c.maxLife;
      const enterT = Math.min(1, c.life / 0.22);
      const pop = 0.6 + 0.4 * easeOutBack(enterT);
      const exitAlpha = t > 0.68 ? Math.max(0, 1 - (t - 0.68) / 0.32) : 1;
      const alpha = Math.min(1, enterT * 1.6) * exitAlpha;
      if (alpha <= 0.01) continue;

      const fontSize = Math.max(10, Math.round(baseFontPx * pop * c.scale));
      const light = lightenRgb(c.color, 0.6);

      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.globalAlpha = alpha;
      ctx.font = `800 ${fontSize}px Inter, system-ui, -apple-system, "Segoe UI", sans-serif`;
      const textW = typeof ctx.measureText === 'function' ? ctx.measureText(c.text).width : fontSize * c.text.length * 0.6;

      // Horizontal light streak behind the callout
      const streakW = (textW * 0.7 + fontSize * 2) * (0.5 + 0.5 * easeOutCubic(enterT));
      const streak = ctx.createLinearGradient(-streakW, 0, streakW, 0);
      streak.addColorStop(0, rgba(c.color, 0));
      streak.addColorStop(0.5, rgba(c.color, 0.42));
      streak.addColorStop(1, rgba(c.color, 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = streak;
      ctx.fillRect(-streakW, -fontSize * 0.08, streakW * 2, Math.max(1.5, fontSize * 0.16));
      ctx.globalCompositeOperation = 'source-over';

      // Dark outline keeps text legible over any background
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, fontSize * 0.2);
      ctx.strokeStyle = 'rgba(5, 7, 20, 0.85)';
      ctx.strokeText(c.text, 0, 0);

      // Luminous gradient fill with colored bloom
      const fill = ctx.createLinearGradient(0, -fontSize * 0.5, 0, fontSize * 0.5);
      fill.addColorStop(0, '#FFFFFF');
      fill.addColorStop(0.55, rgba(light, 1));
      fill.addColorStop(1, rgba(c.color, 1));
      ctx.shadowColor = rgba(c.color, 0.95);
      ctx.shadowBlur = Math.round(fontSize * 0.7);
      ctx.fillStyle = fill;
      ctx.fillText(c.text, 0, 0);

      if (c.subtext) {
        const subSize = Math.max(10, Math.round(fontSize * 0.5));
        const subY = fontSize * 0.88;
        ctx.shadowBlur = Math.round(subSize * 0.6);
        ctx.font = `700 ${subSize}px Inter, system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.lineWidth = Math.max(2.5, subSize * 0.24);
        ctx.strokeText(c.subtext, 0, subY);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(c.subtext, 0, subY);
      }

      ctx.restore();
    }

    ctx.restore();
  }
}

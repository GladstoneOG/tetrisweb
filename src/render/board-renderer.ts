/**
 * 10x20 Tetris board renderer with glossy beveled minos, ghost piece outlines,
 * 1s lock-delay visual cues, juicy hard-drop/line-clear VFX, floating callouts,
 * and mini piece preview helper for Hold and Next boxes.
 */
import { getTightPieceShape } from '../engine/tetrominoes';
import {
  BOARD_COLS,
  BOARD_HIDDEN_ROWS,
  BOARD_VISIBLE_ROWS,
  TETROMINO_COLORS,
  type GameEvent,
  type GameSnapshot,
  type GridPoint,
  type TetrominoType,
} from '../engine/types';
import type { BackgroundRenderer } from './background';
import { detectQualityScale, ParticleSystem } from './particles';
import {
  clamp01,
  darkenRgb,
  getThemeForLevel,
  hexToRgb,
  lightenRgb,
  mixRgb,
  rgba,
  rgbToHex,
  type RGB,
} from './themes';

export interface BoardRect {
  x: number;
  y: number;
  width: number;
  height: number;
  cellSize: number;
}

export interface BoardRendererOptions {
  qualityScale?: number;
  paddingPx?: number;
}

export interface DrawMiniPieceOptions {
  dimmed?: boolean;
  paddingRatio?: number;
}

interface MinoDrawOptions {
  alpha?: number;
  lockPulse?: number;
  glowStrength?: number;
  dimmed?: boolean;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function drawGlossyMino(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  colorHex: string,
  options?: MinoDrawOptions
): void {
  const alpha = options?.alpha ?? 1;
  const lockPulse = clamp01(options?.lockPulse ?? 0);
  const glowStrength = options?.glowStrength ?? 0.35;
  const dimmed = options?.dimmed ?? false;

  const pad = Math.max(0.75, size * 0.045);
  const x = px + pad;
  const y = py + pad;
  const s = Math.max(2, size - pad * 2);
  const radius = Math.max(2, s * 0.16);

  const baseRgb = hexToRgb(colorHex);
  const effectiveRgb = dimmed
    ? darkenRgb(baseRgb, 0.38)
    : lockPulse > 0
      ? lightenRgb(baseRgb, lockPulse * 0.22)
      : baseRgb;
  const topColor = lightenRgb(effectiveRgb, 0.28 + lockPulse * 0.28);
  const bottomColor = darkenRgb(effectiveRgb, 0.28 - lockPulse * 0.1);

  ctx.save();
  if (dimmed) {
    ctx.globalAlpha = alpha * 0.62;
  } else if (alpha < 1) {
    ctx.globalAlpha = alpha;
  }

  // Subtle outer luminous aura (zero shadowBlur overhead for 60fps mobile performance)
  if (!dimmed && glowStrength > 0) {
    const auraAlpha = (0.14 + lockPulse * 0.26) * glowStrength;
    drawRoundedRectPath(ctx, x - 1.5, y - 1.5, s + 3, s + 3, radius + 1.5);
    ctx.fillStyle = rgba(lightenRgb(effectiveRgb, 0.38), auraAlpha);
    ctx.fill();
  }

  // Main glossy gradient body
  drawRoundedRectPath(ctx, x, y, s, s, radius);
  const bodyGrad = ctx.createLinearGradient(x, y, x, y + s);
  bodyGrad.addColorStop(0, rgba(topColor, 1));
  bodyGrad.addColorStop(0.5, rgba(effectiveRgb, 1));
  bodyGrad.addColorStop(1, rgba(bottomColor, 1));
  ctx.fillStyle = bodyGrad;
  ctx.fill();

  // Crisp bevel highlights (top + left)
  const bevel = Math.max(1.5, s * 0.13);
  ctx.fillStyle = `rgba(255, 255, 255, ${(0.38 + lockPulse * 0.26).toFixed(3)})`;
  ctx.beginPath();
  ctx.moveTo(x + radius * 0.6, y);
  ctx.lineTo(x + s - radius * 0.6, y);
  ctx.lineTo(x + s - bevel, y + bevel);
  ctx.lineTo(x + bevel, y + bevel);
  ctx.lineTo(x + bevel, y + s - bevel);
  ctx.lineTo(x, y + s - radius * 0.6);
  ctx.lineTo(x, y + radius * 0.6);
  ctx.closePath();
  ctx.fill();

  // Bottom-right bevel shadow
  ctx.fillStyle = 'rgba(4, 6, 18, 0.36)';
  ctx.beginPath();
  ctx.moveTo(x + s, y + radius * 0.6);
  ctx.lineTo(x + s, y + s - radius * 0.6);
  ctx.lineTo(x + s - radius * 0.6, y + s);
  ctx.lineTo(x + radius * 0.6, y + s);
  ctx.lineTo(x + bevel, y + s - bevel);
  ctx.lineTo(x + s - bevel, y + s - bevel);
  ctx.lineTo(x + s - bevel, y + bevel);
  ctx.closePath();
  ctx.fill();

  // Inner jewel core shine
  const inset = s * 0.23;
  const innerSize = Math.max(1, s - inset * 2);
  drawRoundedRectPath(ctx, x + inset, y + inset, innerSize, innerSize, radius * 0.55);
  const coreGrad = ctx.createLinearGradient(x + inset, y + inset, x + inset, y + inset + innerSize);
  coreGrad.addColorStop(0, `rgba(255, 255, 255, ${(0.32 + lockPulse * 0.26).toFixed(3)})`);
  coreGrad.addColorStop(0.55, `rgba(255, 255, 255, ${(0.08 + lockPulse * 0.16).toFixed(3)})`);
  coreGrad.addColorStop(1, 'rgba(255, 255, 255, 0.03)');
  ctx.fillStyle = coreGrad;
  ctx.fill();

  // Crisp top-left inner facet glint for jewel crispness on HiDPI screens
  if (!dimmed && innerSize >= 4) {
    ctx.fillStyle = `rgba(255, 255, 255, ${(0.46 + lockPulse * 0.22).toFixed(3)})`;
    ctx.fillRect(x + inset + 1, y + inset + 0.75, Math.max(1.5, innerSize * 0.42), Math.max(1, innerSize * 0.14));
  }

  // Crisp luminous rim
  drawRoundedRectPath(ctx, x + 0.5, y + 0.5, s - 1, s - 1, radius);
  ctx.strokeStyle = rgba(
    lightenRgb(effectiveRgb, 0.6 + lockPulse * 0.35),
    0.58 + lockPulse * 0.38
  );
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

export function drawGhostMino(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  colorHex: string,
  pulse = 0
): void {
  const pad = Math.max(1.2, size * 0.075);
  const x = px + pad;
  const y = py + pad;
  const s = Math.max(2, size - pad * 2);
  const radius = Math.max(2, s * 0.16);

  const rgb = hexToRgb(colorHex);
  const rimRgb = lightenRgb(rgb, 0.38);

  ctx.save();

  // Subtle translucent interior fill
  drawRoundedRectPath(ctx, x, y, s, s, radius);
  ctx.fillStyle = rgba(rgb, 0.09 + pulse * 0.045);
  ctx.fill();

  // Soft outer rim aura + crisp glowing hollow outline
  ctx.strokeStyle = rgba(rgb, 0.22 + pulse * 0.08);
  ctx.lineWidth = Math.max(2.6, size * 0.13);
  ctx.stroke();

  ctx.strokeStyle = rgba(rimRgb, 0.76 + pulse * 0.18);
  ctx.lineWidth = Math.max(1.4, size * 0.068);
  ctx.stroke();

  // Crisp opposite corner glints
  const inset = Math.max(2.5, s * 0.22);
  ctx.strokeStyle = `rgba(255, 255, 255, ${(0.26 + pulse * 0.14).toFixed(3)})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + inset, y + s * 0.38);
  ctx.lineTo(x + inset, y + inset);
  ctx.lineTo(x + s * 0.38, y + inset);
  ctx.moveTo(x + s - inset, y + s * 0.62);
  ctx.lineTo(x + s - inset, y + s - inset);
  ctx.lineTo(x + s * 0.62, y + s - inset);
  ctx.stroke();

  ctx.restore();
}

/**
 * Renders a mini tetromino centered inside a Hold or Next preview canvas.
 */
export function drawMiniPiece(
  canvas: HTMLCanvasElement,
  pieceType: TetrominoType | null,
  options?: DrawMiniPieceOptions
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const cssW = Math.max(1, canvas.clientWidth || canvas.width || 72);
  const cssH = Math.max(1, canvas.clientHeight || canvas.height || 72);
  const dpr =
    typeof window !== 'undefined' ? Math.min(2, Math.max(1, window.devicePixelRatio || 1)) : 1;

  const targetW = Math.round(cssW * dpr);
  const targetH = Math.round(cssH * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  if (!pieceType) {
    ctx.restore();
    return;
  }

  const shape = getTightPieceShape(pieceType, 0);
  const paddingRatio = options?.paddingRatio ?? 0.2;
  const availW = cssW * (1 - paddingRatio * 2);
  const availH = cssH * (1 - paddingRatio * 2);

  // Reference 4-cell max width so I-piece and O-piece feel consistent in scale
  const cellSize = Math.floor(
    Math.min(availW / Math.max(3, shape.width), availH / Math.max(2, shape.height))
  );
  const totalW = shape.width * cellSize;
  const totalH = shape.height * cellSize;
  const originX = (cssW - totalW) * 0.5;
  const originY = (cssH - totalH) * 0.5;

  for (const pt of shape.cells) {
    drawGlossyMino(
      ctx,
      originX + pt.x * cellSize,
      originY + pt.y * cellSize,
      cellSize,
      shape.color,
      {
        dimmed: options?.dimmed ?? false,
        glowStrength: options?.dimmed ? 0.1 : 0.45,
      }
    );
  }

  ctx.restore();
}

export class BoardRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly particles: ParticleSystem;

  private cssWidth = 340;
  private cssHeight = 680;
  private dpr = 1;
  private paddingPx: number;
  private boardRect: BoardRect = { x: 8, y: 8, width: 320, height: 640, cellSize: 32 };

  private shakeIntensity = 0;
  private shakeTime = 0;
  private borderPulse = 0;
  private borderPulseRgb: RGB = hexToRgb('#00E5FF');
  private smoothedActiveRgb: RGB = hexToRgb('#00E5FF');
  private elapsedSec = 0;

  constructor(canvas: HTMLCanvasElement, options?: BoardRendererOptions) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.paddingPx = options?.paddingPx ?? 8;
    const quality = options?.qualityScale ?? detectQualityScale();
    this.particles = new ParticleSystem(quality, 260);
    this.resize();
  }

  public setQualityScale(scale: number): void {
    this.particles.setQualityScale(scale, 260);
  }

  public resize(explicitWidth?: number, explicitHeight?: number): BoardRect {
    const rawW = explicitWidth ?? (this.canvas.clientWidth || this.canvas.width || 340);
    const rawH = explicitHeight ?? (this.canvas.clientHeight || this.canvas.height || 680);

    this.cssWidth = Math.max(100, Math.round(rawW));
    this.cssHeight = Math.max(200, Math.round(rawH));
    const deviceDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.dpr = Math.min(2, Math.max(1, deviceDpr));

    const pixelW = Math.round(this.cssWidth * this.dpr);
    const pixelH = Math.round(this.cssHeight * this.dpr);
    if (this.canvas.width !== pixelW || this.canvas.height !== pixelH) {
      this.canvas.width = pixelW;
      this.canvas.height = pixelH;
    }

    const availW = Math.max(80, this.cssWidth - this.paddingPx * 2);
    const availH = Math.max(160, this.cssHeight - this.paddingPx * 2);
    const cellSize = Math.max(
      8,
      Math.floor(Math.min(availW / BOARD_COLS, availH / BOARD_VISIBLE_ROWS))
    );
    const width = cellSize * BOARD_COLS;
    const height = cellSize * BOARD_VISIBLE_ROWS;
    const x = Math.round((this.cssWidth - width) * 0.5);
    const y = Math.round((this.cssHeight - height) * 0.5);

    this.boardRect = { x, y, width, height, cellSize };
    return this.boardRect;
  }

  public getBoardRect(): BoardRect {
    return this.boardRect;
  }

  public getCellSize(): number {
    return this.boardRect.cellSize;
  }

  public resetEffects(): void {
    this.particles.clear();
    this.shakeIntensity = 0;
    this.borderPulse = 0;
  }

  public processEvents(
    events: readonly GameEvent[],
    snapshot: GameSnapshot,
    background?: BackgroundRenderer
  ): void {
    if (events.length === 0) return;

    const { x: bx, y: by, width: bw, height: bh, cellSize } = this.boardRect;
    const hidden = snapshot.hiddenRows ?? BOARD_HIDDEN_ROWS;
    const hasSlam = events.some((ev) => ev.type === 'slam');

    for (const ev of events) {
      switch (ev.type) {
        case 'slam': {
          this.triggerSlamVfx(ev.cells, ev.fromY, ev.toY, ev.cellsDropped, ev.color, hidden);
          const impactNorm = this.cellsCenterNorm(ev.cells, hidden);
          background?.triggerImpact(ev.color, Math.min(0.95, 0.35 + ev.cellsDropped * 0.045), impactNorm);
          break;
        }

        case 'lock': {
          for (const cell of ev.cells) {
            const visY = cell.y - hidden;
            if (visY >= 0 && visY < BOARD_VISIBLE_ROWS) {
              this.particles.spawnCellFlash(
                bx + cell.x * cellSize,
                by + visY * cellSize,
                cellSize,
                ev.color
              );
            }
          }
          if (!hasSlam) {
            const avgPt = this.cellsCenterPx(ev.cells, hidden);
            this.particles.spawnImpactSparks(avgPt.x, avgPt.y + cellSize * 0.4, ev.color, 7, 110);
            this.triggerBorderPulse(ev.color, 0.38);
            background?.triggerImpact(ev.color, 0.32, this.cellsCenterNorm(ev.cells, hidden));
          }
          break;
        }

        case 'lineClear': {
          const clearedColors: string[] = [];
          for (const row of ev.rows) {
            const visRow = row - hidden;
            const rowCells = ev.clearedCells
              .filter((c) => c.y === row)
              .sort((a, b) => a.x - b.x);
            const rowColors =
              rowCells.length > 0
                ? rowCells.map((c) => c.color)
                : new Array(BOARD_COLS).fill(snapshot.activePiece?.color ?? '#00E5FF');

            clearedColors.push(...rowColors);

            if (visRow >= 0 && visRow < BOARD_VISIBLE_ROWS) {
              this.particles.spawnRowFlash(visRow, rowColors);
              const rowCenterY = by + (visRow + 0.5) * cellSize;
              this.particles.spawnLineClearBurst(
                rowCenterY,
                bx,
                bw,
                cellSize,
                rowColors,
                ev.isTetris
              );
            }
          }

          const avgVisRow =
            ev.rows.reduce((sum, r) => sum + (r - hidden), 0) / Math.max(1, ev.rows.length);
          const calloutY = Math.max(
            by + cellSize * 2,
            Math.min(by + bh - cellSize * 2, by + (avgVisRow + 0.5) * cellSize)
          );
          const leadColor =
            ev.isTetris
              ? '#FFD500'
              : clearedColors[Math.floor(clearedColors.length / 2)] || '#00E5FF';

          const label =
            ev.count === 4
              ? 'TETRIS!'
              : ev.count === 3
                ? 'TRIPLE'
                : ev.count === 2
                  ? 'DOUBLE'
                  : 'SINGLE';

          const subParts: string[] = [];
          if (ev.isBackToBack) subParts.push('BACK-TO-BACK');
          if (ev.combo >= 1) subParts.push(`COMBO x${ev.combo}`);

          this.particles.spawnCallout(label, bx + bw * 0.5, calloutY, leadColor, {
            subtext: subParts.length > 0 ? subParts.join(' • ') : undefined,
            scale: ev.isTetris ? 1.38 : 0.96 + ev.count * 0.1,
            durationSec: ev.isTetris ? 1.45 : 1.1,
          });

          if (ev.isTetris) {
            this.triggerShake(4.2);
            this.triggerBorderPulse('#FFD500', 1);
          } else {
            this.triggerShake(1.4 + ev.count * 0.6);
            this.triggerBorderPulse(leadColor, 0.55 + ev.count * 0.12);
          }

          background?.triggerLineClear(clearedColors, ev.count, ev.isTetris);
          break;
        }

        case 'allClear': {
          this.particles.spawnShockwave(bx + bw * 0.5, by + bh * 0.5, bw * 0.95, '#FFD500', {
            lineWidth: 4,
            durationSec: 0.9,
            alpha: 0.85,
          });
          this.particles.spawnCallout(
            'ALL CLEAR!',
            bx + bw * 0.5,
            by + bh * 0.36,
            '#FFD500',
            { scale: 1.32, durationSec: 1.5 }
          );
          this.triggerShake(3.8);
          this.triggerBorderPulse('#FFD500', 1);
          background?.triggerLineClear(['#00E5FF', '#FFD500', '#B84DFF', '#2EE86C'], 4, true);
          break;
        }

        case 'levelUp': {
          const theme = getThemeForLevel(ev.newLevel);
          const hex = rgbToHex(theme.accent);
          this.particles.spawnCallout(
            'LEVEL UP!',
            bx + bw * 0.5,
            by + bh * 0.25,
            hex,
            {
              subtext: `LEVEL ${ev.newLevel}`,
              scale: 1.24,
              durationSec: 1.45,
            }
          );
          this.triggerBorderPulse(hex, 0.95);
          background?.triggerLevelUp(ev.newLevel);
          break;
        }

        default:
          break;
      }
    }
  }

  public update(dtMs: number, snapshot: GameSnapshot, background?: BackgroundRenderer): void {
    const dt = Math.min(0.05, Math.max(0, dtMs / 1000));
    this.elapsedSec += dt;

    if (this.shakeIntensity > 0) {
      this.shakeTime += dt * 48;
      this.shakeIntensity *= Math.exp(-dt * 14);
      if (this.shakeIntensity < 0.08) {
        this.shakeIntensity = 0;
      }
    }

    if (this.borderPulse > 0) {
      this.borderPulse *= Math.exp(-dt * 3.6);
      if (this.borderPulse < 0.01) {
        this.borderPulse = 0;
      }
    }

    const activeHex = snapshot.activePiece?.color ?? null;
    if (activeHex) {
      const targetRgb = hexToRgb(activeHex);
      this.smoothedActiveRgb = mixRgb(
        this.smoothedActiveRgb,
        targetRgb,
        1 - Math.exp(-dt * 8)
      );
    }
    if (background) {
      background.setLevel(snapshot.level, false);
      background.setActiveColor(activeHex);
    }

    this.particles.update(dtMs);
  }

  public render(snapshot: GameSnapshot): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const { x: bx, y: by, width: bw, height: bh, cellSize } = this.boardRect;
    const hidden = snapshot.hiddenRows ?? BOARD_HIDDEN_ROWS;
    const theme = getThemeForLevel(snapshot.level);

    const shakeX =
      this.shakeIntensity > 0
        ? Math.sin(this.shakeTime * 1.7) * this.shakeIntensity
        : 0;
    const shakeY =
      this.shakeIntensity > 0
        ? Math.cos(this.shakeTime * 2.3) * this.shakeIntensity * 0.75
        : 0;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.translate(shakeX, shakeY);

    const frameRadius = Math.max(8, cellSize * 0.34);
    const accentRgb = snapshot.activePiece
      ? mixRgb(theme.boardGlow, this.smoothedActiveRgb, 0.5)
      : theme.boardGlow;
    const borderGlowRgb = mixRgb(accentRgb, this.borderPulseRgb, this.borderPulse * 0.75);

    // 1. Soft double-layer outer frosted neon aura around the well
    drawRoundedRectPath(ctx, bx - 7, by - 7, bw + 14, bh + 14, frameRadius + 5);
    ctx.fillStyle = rgba(borderGlowRgb, 0.045 + this.borderPulse * 0.12);
    ctx.fill();

    drawRoundedRectPath(ctx, bx - 3, by - 3, bw + 6, bh + 6, frameRadius + 2);
    ctx.fillStyle = rgba(borderGlowRgb, 0.08 + this.borderPulse * 0.16);
    ctx.fill();

    // 2. Sculpted frosted-glass playfield interior (deep high-contrast cosmic glass)
    drawRoundedRectPath(ctx, bx, by, bw, bh, frameRadius);
    const wellGrad = ctx.createLinearGradient(bx, by, bx, by + bh);
    wellGrad.addColorStop(0, 'rgba(6, 9, 24, 0.88)');
    wellGrad.addColorStop(0.5, 'rgba(5, 8, 21, 0.81)');
    wellGrad.addColorStop(1, 'rgba(9, 13, 32, 0.89)');
    ctx.fillStyle = wellGrad;
    ctx.fill();

    // Clip interior for grid, column guide, beams, minos, flashes
    ctx.save();
    drawRoundedRectPath(ctx, bx, by, bw, bh, frameRadius);
    ctx.clip();

    // Subtle upper frosted glass specular sheen
    const glassSheen = ctx.createLinearGradient(bx, by, bx + bw * 0.45, by + bh * 0.35);
    glassSheen.addColorStop(0, 'rgba(255, 255, 255, 0.045)');
    glassSheen.addColorStop(0.55, 'rgba(255, 255, 255, 0.012)');
    glassSheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glassSheen;
    ctx.fillRect(bx, by, bw, bh * 0.4);

    // 3. Clean 10x20 subtle well grid
    this.renderWellGrid(ctx, bx, by, bw, bh, cellSize, accentRgb);

    // 3b. Ultra-subtle vertical column guide under active piece for effortless alignment
    if (snapshot.activePiece && snapshot.activePiece.cells.length > 0) {
      this.renderActiveColumnGuide(
        ctx,
        bx,
        by,
        bh,
        cellSize,
        hidden,
        snapshot.activePiece.cells,
        snapshot.ghostCells,
        snapshot.activePiece.color
      );
    }

    // 4. Hard-drop light beams (behind pieces)
    this.particles.renderBeams(ctx);

    // 5. Locked board minos (visible rows hidden .. hidden + visibleRows - 1)
    const maxRows = Math.min(snapshot.board.length, hidden + BOARD_VISIBLE_ROWS);
    for (let r = hidden; r < maxRows; r++) {
      const rowData = snapshot.board[r];
      const visRow = r - hidden;
      for (let c = 0; c < BOARD_COLS; c++) {
        const cellType = rowData[c];
        if (!cellType) continue;
        drawGlossyMino(
          ctx,
          bx + c * cellSize,
          by + visRow * cellSize,
          cellSize,
          TETROMINO_COLORS[cellType],
          { glowStrength: 0.25 }
        );
      }
    }

    // 6. Ghost piece outline (if enabled / populated)
    if (snapshot.activePiece && snapshot.ghostCells.length > 0) {
      const ghostPulse = 0.5 + 0.5 * Math.sin(this.elapsedSec * 4.5);
      for (const pt of snapshot.ghostCells) {
        const visY = pt.y - hidden;
        if (visY < 0 || visY >= BOARD_VISIBLE_ROWS) continue;
        drawGhostMino(
          ctx,
          bx + pt.x * cellSize,
          by + visY * cellSize,
          cellSize,
          snapshot.activePiece.color,
          ghostPulse
        );
      }
    }

    // 7. Active piece + subtle 1s lock-delay pulse
    if (snapshot.activePiece) {
      const lockProgress = clamp01(snapshot.lockProgress);
      const isGrounded = snapshot.activePiece.isGrounded || lockProgress > 0;
      const pulseWave = isGrounded
        ? (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.elapsedSec * (8 + lockProgress * 12)))) *
          (0.25 + lockProgress * 0.75)
        : 0;

      for (const pt of snapshot.activePiece.cells) {
        const visY = pt.y - hidden;
        if (visY < -1 || visY >= BOARD_VISIBLE_ROWS) continue;
        drawGlossyMino(
          ctx,
          bx + pt.x * cellSize,
          by + visY * cellSize,
          cellSize,
          snapshot.activePiece.color,
          {
            lockPulse: pulseWave,
            glowStrength: 0.55 + pulseWave * 0.45,
          }
        );
      }

      // Subtle remaining slide-time bar under grounded active piece & floor cue
      if (isGrounded && lockProgress > 0) {
        this.renderLockDelayCue(
          ctx,
          bx,
          by,
          bw,
          bh,
          cellSize,
          hidden,
          snapshot.activePiece.cells,
          snapshot.activePiece.color,
          lockProgress
        );
      }
    }

    // 8. Cell lock flashes, row clear flashes, shockwaves & particle bursts
    this.particles.renderCellFlashes(ctx);
    this.particles.renderRowFlashes(ctx, bx, by, bw, cellSize);
    this.particles.renderRings(ctx);
    this.particles.renderParticles(ctx);

    ctx.restore(); // end well clip

    // 9. Luminous frosted-glass neon border frame (soft bloom stroke + crisp inner tube)
    drawRoundedRectPath(ctx, bx, by, bw, bh, frameRadius);
    ctx.strokeStyle = rgba(borderGlowRgb, 0.22 + this.borderPulse * 0.25);
    ctx.lineWidth = 4.5 + this.borderPulse * 2;
    ctx.stroke();

    ctx.strokeStyle = rgba(
      lightenRgb(borderGlowRgb, 0.42),
      0.66 + this.borderPulse * 0.34
    );
    ctx.lineWidth = 1.8 + this.borderPulse * 1.1;
    ctx.stroke();

    // Subtle crisp inner highlight line on top of glass frame
    drawRoundedRectPath(ctx, bx + 1.5, by + 1.5, bw - 3, bh - 3, Math.max(4, frameRadius - 1.5));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Crisp luminous corner accents (Classic Mobile Tetris tech-glass framing)
    const cornerLen = Math.max(10, cellSize * 0.55);
    const cornerOff = 2.5;
    ctx.strokeStyle = rgba(lightenRgb(borderGlowRgb, 0.68), 0.72 + this.borderPulse * 0.28);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    // Top-left
    ctx.moveTo(bx - cornerOff, by + cornerLen);
    ctx.lineTo(bx - cornerOff, by + frameRadius * 0.35);
    ctx.quadraticCurveTo(bx - cornerOff, by - cornerOff, bx + frameRadius * 0.35, by - cornerOff);
    ctx.lineTo(bx + cornerLen, by - cornerOff);
    // Top-right
    ctx.moveTo(bx + bw - cornerLen, by - cornerOff);
    ctx.lineTo(bx + bw - frameRadius * 0.35, by - cornerOff);
    ctx.quadraticCurveTo(bx + bw + cornerOff, by - cornerOff, bx + bw + cornerOff, by + frameRadius * 0.35);
    ctx.lineTo(bx + bw + cornerOff, by + cornerLen);
    // Bottom-left
    ctx.moveTo(bx - cornerOff, by + bh - cornerLen);
    ctx.lineTo(bx - cornerOff, by + bh - frameRadius * 0.35);
    ctx.quadraticCurveTo(bx - cornerOff, by + bh + cornerOff, bx + frameRadius * 0.35, by + bh + cornerOff);
    ctx.lineTo(bx + cornerLen, by + bh + cornerOff);
    // Bottom-right
    ctx.moveTo(bx + bw - cornerLen, by + bh + cornerOff);
    ctx.lineTo(bx + bw - frameRadius * 0.35, by + bh + cornerOff);
    ctx.quadraticCurveTo(bx + bw + cornerOff, by + bh + cornerOff, bx + bw + cornerOff, by + bh - frameRadius * 0.35);
    ctx.lineTo(bx + bw + cornerOff, by + bh - cornerLen);
    ctx.stroke();

    // 10. Floating animated callouts (allowed to extend cleanly over frame edges)
    this.particles.renderCallouts(ctx, Math.max(16, Math.round(cellSize * 0.68)));

    ctx.restore();
  }

  private renderWellGrid(
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    bw: number,
    bh: number,
    cellSize: number,
    accentRgb: RGB
  ): void {
    ctx.save();
    ctx.strokeStyle = rgba(lightenRgb(accentRgb, 0.45), 0.065);
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let c = 1; c < BOARD_COLS; c++) {
      const gx = bx + c * cellSize + 0.5;
      ctx.moveTo(gx, by);
      ctx.lineTo(gx, by + bh);
    }
    for (let r = 1; r < BOARD_VISIBLE_ROWS; r++) {
      const gy = by + r * cellSize + 0.5;
      ctx.moveTo(bx, gy);
      ctx.lineTo(bx + bw, gy);
    }
    ctx.stroke();

    // Tiny subtle crosshair dots every 2 cells for effortless piece alignment
    ctx.fillStyle = rgba(lightenRgb(accentRgb, 0.6), 0.12);
    for (let r = 2; r < BOARD_VISIBLE_ROWS; r += 2) {
      for (let c = 2; c < BOARD_COLS; c += 2) {
        ctx.fillRect(bx + c * cellSize - 0.5, by + r * cellSize - 0.5, 1.5, 1.5);
      }
    }
    ctx.restore();
  }

  private renderActiveColumnGuide(
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    bh: number,
    cellSize: number,
    hiddenRows: number,
    activeCells: readonly GridPoint[],
    ghostCells: readonly GridPoint[],
    colorHex: string
  ): void {
    let minCol = BOARD_COLS;
    let maxCol = -1;
    let minVisY = BOARD_VISIBLE_ROWS;
    for (const pt of activeCells) {
      if (pt.x < minCol) minCol = pt.x;
      if (pt.x > maxCol) maxCol = pt.x;
      const vy = pt.y - hiddenRows;
      if (vy < minVisY) minVisY = vy;
    }
    if (maxCol < minCol) return;

    let maxGhostVisY = BOARD_VISIBLE_ROWS;
    if (ghostCells.length > 0) {
      let lowest = -1;
      for (const pt of ghostCells) {
        const vy = pt.y - hiddenRows;
        if (vy > lowest) lowest = vy;
      }
      if (lowest >= 0) {
        maxGhostVisY = Math.min(BOARD_VISIBLE_ROWS, lowest + 1);
      }
    }

    const startY = by + Math.max(0, minVisY) * cellSize;
    const endY = Math.max(startY + cellSize, by + maxGhostVisY * cellSize);
    const guideX = bx + minCol * cellSize;
    const guideW = (maxCol - minCol + 1) * cellSize;
    const rgb = hexToRgb(colorHex);

    const grad = ctx.createLinearGradient(0, startY, 0, Math.min(by + bh, endY));
    grad.addColorStop(0, rgba(rgb, 0.055));
    grad.addColorStop(0.75, rgba(rgb, 0.032));
    grad.addColorStop(1, rgba(rgb, 0.01));

    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(guideX, startY, guideW, Math.min(by + bh, endY) - startY);
    ctx.restore();
  }

  private renderLockDelayCue(
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    bw: number,
    bh: number,
    cellSize: number,
    hiddenRows: number,
    cells: readonly GridPoint[],
    colorHex: string,
    lockProgress: number
  ): void {
    const remaining = clamp01(1 - lockProgress);
    const pieceRgb = hexToRgb(colorHex);
    const urgent = lockProgress > 0.7;
    const barRgb = urgent
      ? mixRgb(lightenRgb(pieceRgb, 0.35), hexToRgb('#FFD166'), (lockProgress - 0.7) / 0.3)
      : lightenRgb(pieceRgb, 0.52);

    // Subtle per-column bottom edge glow & capsule bar beneath the active piece's lowest cells
    const bottomByCol = new Map<number, number>();
    for (const pt of cells) {
      const prev = bottomByCol.get(pt.x);
      if (prev === undefined || pt.y > prev) {
        bottomByCol.set(pt.x, pt.y);
      }
    }

    ctx.save();
    for (const [col, row] of bottomByCol.entries()) {
      const visY = row - hiddenRows;
      if (visY < 0 || visY >= BOARD_VISIBLE_ROWS) continue;
      const cellX = bx + col * cellSize + 2;
      const cellBottomY = by + (visY + 1) * cellSize - 2.6;
      const maxBarW = Math.max(4, cellSize - 4);
      const barW = Math.max(2, maxBarW * remaining);
      const offsetX = cellX + (maxBarW - barW) * 0.5;

      // Soft track behind remaining slide time
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.fillRect(cellX, cellBottomY, maxBarW, 2.2);

      // Luminous active remaining slide bar
      ctx.fillStyle = rgba(barRgb, 0.88);
      ctx.fillRect(offsetX, cellBottomY, barW, 2.2);
    }

    // Subtle sleek well-bottom slide indicator bar
    const trackW = bw * 0.48;
    const trackX = bx + (bw - trackW) * 0.5;
    const wellBarW = trackW * remaining;
    const wellBarX = bx + (bw - wellBarW) * 0.5;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(trackX, by + bh - 3.5, trackW, 2.2);
    ctx.fillStyle = rgba(barRgb, 0.72);
    ctx.fillRect(wellBarX, by + bh - 3.5, wellBarW, 2.2);
    ctx.restore();
  }

  private triggerSlamVfx(
    cells: readonly GridPoint[],
    fromY: number,
    toY: number,
    cellsDropped: number,
    colorHex: string,
    hiddenRows: number
  ): void {
    const { x: bx, y: by, cellSize } = this.boardRect;
    const deltaY = Math.max(0, toY - fromY);

    if (cellsDropped > 0 && deltaY > 0) {
      const colBounds = new Map<number, { minVisY: number; maxVisY: number }>();
      for (const cell of cells) {
        const landedVisY = cell.y - hiddenRows;
        const startVisY = landedVisY - deltaY;
        const existing = colBounds.get(cell.x);
        if (!existing) {
          colBounds.set(cell.x, { minVisY: startVisY, maxVisY: landedVisY });
        } else {
          existing.minVisY = Math.min(existing.minVisY, startVisY);
          existing.maxVisY = Math.max(existing.maxVisY, landedVisY);
        }
      }

      for (const [col, span] of colBounds.entries()) {
        const topPx = by + Math.max(0, span.minVisY) * cellSize;
        const bottomPx = by + Math.min(BOARD_VISIBLE_ROWS, span.maxVisY + 1) * cellSize;
        if (bottomPx > topPx) {
          this.particles.spawnHardDropBeam(
            bx + col * cellSize,
            topPx,
            bottomPx,
            cellSize,
            colorHex
          );
        }
      }
    }

    // Impact sparks under landed piece
    const bottomCenter = this.cellsCenterPx(cells, hiddenRows);
    this.particles.spawnImpactSparks(
      bottomCenter.x,
      bottomCenter.y + cellSize * 0.45,
      colorHex,
      cellsDropped > 4 ? 18 : 11,
      cellsDropped > 4 ? 210 : 145
    );

    if (cellsDropped >= 3) {
      this.triggerShake(Math.min(2.8, 1.1 + cellsDropped * 0.14));
    }
    this.triggerBorderPulse(colorHex, Math.min(0.65, 0.25 + cellsDropped * 0.03));
  }

  private triggerShake(amount: number): void {
    this.shakeIntensity = Math.min(4.5, Math.max(this.shakeIntensity, amount));
  }

  private triggerBorderPulse(colorHex: string, strength: number): void {
    this.borderPulseRgb = hexToRgb(colorHex);
    this.borderPulse = Math.min(1, Math.max(this.borderPulse, strength));
  }

  private cellsCenterPx(cells: readonly GridPoint[], hiddenRows: number): { x: number; y: number } {
    const { x: bx, y: by, cellSize } = this.boardRect;
    if (cells.length === 0) {
      return { x: bx + this.boardRect.width * 0.5, y: by + this.boardRect.height * 0.5 };
    }
    let sx = 0;
    let sy = 0;
    for (const c of cells) {
      sx += c.x + 0.5;
      sy += c.y - hiddenRows + 0.5;
    }
    return {
      x: bx + (sx / cells.length) * cellSize,
      y: by + (sy / cells.length) * cellSize,
    };
  }

  private cellsCenterNorm(cells: readonly GridPoint[], hiddenRows: number): { x: number; y: number } {
    if (cells.length === 0) return { x: 0.5, y: 0.55 };
    let sy = 0;
    for (const c of cells) {
      sy += c.y - hiddenRows + 0.5;
    }
    const avgRowNorm = Math.max(0.1, Math.min(0.9, sy / cells.length / BOARD_VISIBLE_ROWS));
    return { x: 0.5, y: 0.15 + avgRowNorm * 0.7 };
  }
}

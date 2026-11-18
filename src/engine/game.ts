import { SevenBagRandomizer } from './bag';
import { getWallKicks, rotateStateCCW, rotateStateCW } from './srs';
import { getPieceCells, SPAWN_COLUMN } from './tetrominoes';
import {
  BOARD_COLS,
  BOARD_HIDDEN_ROWS,
  BOARD_TOTAL_ROWS,
  BOARD_VISIBLE_ROWS,
  DEFAULT_LOCK_DELAY_MS,
  DEFAULT_MAX_LOCK_RESETS,
  DEFAULT_NEXT_QUEUE_SIZE,
  MAX_START_LEVEL,
  MIN_START_LEVEL,
  TETROMINO_COLORS,
  type ActivePieceState,
  type BoardGrid,
  type ClearedCellInfo,
  type GameEvent,
  type GameOptions,
  type GameSnapshot,
  type GameStatus,
  type GridPoint,
  type RotationState,
  type TetrominoType,
} from './types';

interface InternalPiece {
  type: TetrominoType;
  rotation: RotationState;
  x: number;
  y: number;
  lowestY: number;
  isGrounded: boolean;
  lockTimerMs: number;
  lockResets: number;
}

const GRAVITY_TABLE_MS: readonly number[] = [
  900, // Level 1
  780, // Level 2
  670, // Level 3
  570, // Level 4
  480, // Level 5
  400, // Level 6
  330, // Level 7
  270, // Level 8
  220, // Level 9
  180, // Level 10
  150, // Level 11
  125, // Level 12
  105, // Level 13
  90, // Level 14
  78, // Level 15
];

const LINE_BASE_POINTS: Record<1 | 2 | 3 | 4, number> = {
  1: 100,
  2: 300,
  3: 500,
  4: 800,
};

const ALL_CLEAR_POINTS: Record<1 | 2 | 3 | 4, number> = {
  1: 800,
  2: 1200,
  3: 1800,
  4: 2000,
};

const MAX_PENDING_EVENTS = 500;

export function clampStartLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return MIN_START_LEVEL;
  }
  return Math.max(MIN_START_LEVEL, Math.min(MAX_START_LEVEL, Math.floor(level)));
}

/**
 * Smooth parent-friendly gravity curve: gentle ~900ms/row at Level 1 down to
 * brisk ~78ms/row at Level 15, asymptotically approaching 50ms beyond Level 15.
 */
export function getGravityIntervalMs(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  if (safeLevel <= GRAVITY_TABLE_MS.length) {
    return GRAVITY_TABLE_MS[safeLevel - 1];
  }
  return Math.max(50, Math.round(78 * Math.pow(0.88, safeLevel - 15)));
}

export function createEmptyBoard(): BoardGrid {
  return Array.from({ length: BOARD_TOTAL_ROWS }, () =>
    Array<TetrominoType | null>(BOARD_COLS).fill(null)
  );
}

function cloneBoard(source: BoardGrid): BoardGrid {
  return Array.from({ length: BOARD_TOTAL_ROWS }, (_, row) => {
    const srcRow = source[row];
    return Array.from({ length: BOARD_COLS }, (__, col) => srcRow?.[col] ?? null);
  });
}

export class TetrisGame {
  private board: BoardGrid = createEmptyBoard();
  private bag: SevenBagRandomizer;
  private status: GameStatus = 'idle';
  private activePiece: InternalPiece | null = null;
  private holdPiece: TetrominoType | null = null;
  private canHold = true;
  private ghostEnabled: boolean;
  private nextQueueSize: number;
  private lockDelayMs: number;
  private maxLockResets: number;

  private startLevel: number;
  private level: number;
  private score = 0;
  private lines = 0;
  private comboStreak = -1;
  private maxCombo = 0;
  private backToBack = false;
  private tetrises = 0;
  private durationMs = 0;
  private gravityAccumulatorMs = 0;

  private pendingEvents: GameEvent[] = [];
  private stepEvents: GameEvent[] | null = null;
  private listeners = new Set<(event: GameEvent) => void>();

  constructor(options: GameOptions = {}) {
    this.startLevel = clampStartLevel(options.startLevel ?? MIN_START_LEVEL);
    this.level = this.startLevel;
    this.ghostEnabled = options.ghostEnabled ?? true;
    this.nextQueueSize = Math.max(1, options.nextQueueSize ?? DEFAULT_NEXT_QUEUE_SIZE);
    this.lockDelayMs = Math.max(1, options.lockDelayMs ?? DEFAULT_LOCK_DELAY_MS);
    this.maxLockResets = Math.max(0, options.maxLockResets ?? DEFAULT_MAX_LOCK_RESETS);

    this.bag = new SevenBagRandomizer({
      rng: options.rng,
      pieceSequence: options.pieceSequence,
    });

    if (options.initialBoard) {
      this.board = cloneBoard(options.initialBoard);
    }

    if (options.autoStart !== false) {
      this.start(this.startLevel, { preserveBoard: Boolean(options.initialBoard) });
    }
  }

  public start(
    startLevel?: number,
    internalOptions?: { preserveBoard?: boolean; pieceSequence?: TetrominoType[]; rng?: () => number }
  ): void {
    if (startLevel !== undefined) {
      this.startLevel = clampStartLevel(startLevel);
    }
    if (!internalOptions?.preserveBoard) {
      this.board = createEmptyBoard();
    }
    if (internalOptions?.pieceSequence || internalOptions?.rng) {
      this.bag.reset({
        rng: internalOptions.rng,
        pieceSequence: internalOptions.pieceSequence,
      });
    }

    this.status = 'playing';
    this.activePiece = null;
    this.holdPiece = null;
    this.canHold = true;
    this.level = this.startLevel;
    this.score = 0;
    this.lines = 0;
    this.comboStreak = -1;
    this.maxCombo = 0;
    this.backToBack = false;
    this.tetrises = 0;
    this.durationMs = 0;
    this.gravityAccumulatorMs = 0;
    this.pendingEvents = [];

    this.spawnNextPiece();
  }

  public reset(options: GameOptions = {}): void {
    if (options.startLevel !== undefined) {
      this.startLevel = clampStartLevel(options.startLevel);
    }
    if (options.ghostEnabled !== undefined) {
      this.ghostEnabled = options.ghostEnabled;
    }
    if (options.nextQueueSize !== undefined) {
      this.nextQueueSize = Math.max(1, options.nextQueueSize);
    }
    if (options.lockDelayMs !== undefined) {
      this.lockDelayMs = Math.max(1, options.lockDelayMs);
    }
    if (options.maxLockResets !== undefined) {
      this.maxLockResets = Math.max(0, options.maxLockResets);
    }

    this.bag.reset({
      rng: options.rng,
      pieceSequence: options.pieceSequence,
    });

    if (options.initialBoard) {
      this.board = cloneBoard(options.initialBoard);
    } else {
      this.board = createEmptyBoard();
    }

    if (options.autoStart === false) {
      this.status = 'idle';
      this.activePiece = null;
      this.holdPiece = null;
      this.canHold = true;
      this.level = this.startLevel;
      this.score = 0;
      this.lines = 0;
      this.comboStreak = -1;
      this.maxCombo = 0;
      this.backToBack = false;
      this.tetrises = 0;
      this.durationMs = 0;
      this.gravityAccumulatorMs = 0;
      this.pendingEvents = [];
      return;
    }

    this.start(this.startLevel, { preserveBoard: Boolean(options.initialBoard) });
  }

  public pause(): boolean {
    if (this.status !== 'playing') {
      return false;
    }
    this.status = 'paused';
    return true;
  }

  public resume(): boolean {
    if (this.status !== 'paused') {
      return false;
    }
    this.status = 'playing';
    return true;
  }

  public togglePause(): boolean {
    if (this.status === 'playing') {
      this.status = 'paused';
      return true;
    }
    if (this.status === 'paused') {
      this.status = 'playing';
      return true;
    }
    return false;
  }

  public setGhostEnabled(enabled: boolean): void {
    this.ghostEnabled = Boolean(enabled);
  }

  public isGhostEnabled(): boolean {
    return this.ghostEnabled;
  }

  public onEvent(listener: (event: GameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public consumeEvents(): GameEvent[] {
    if (this.pendingEvents.length === 0) {
      return [];
    }
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  public moveLeft(): boolean {
    return this.moveHorizontal(-1);
  }

  public moveRight(): boolean {
    return this.moveHorizontal(1);
  }

  public softDrop(): boolean {
    if (this.status !== 'playing' || !this.activePiece) {
      return false;
    }
    const piece = this.activePiece;
    if (!this.canPlace(piece.type, piece.rotation, piece.x, piece.y + 1)) {
      return false;
    }

    const wasGrounded = piece.isGrounded;
    piece.y += 1;
    this.gravityAccumulatorMs = 0;
    this.score += 1;

    if (piece.y > piece.lowestY) {
      piece.lowestY = piece.y;
      piece.lockResets = 0;
      piece.lockTimerMs = 0;
    }

    this.emit({
      type: 'move',
      dx: 0,
      dy: 1,
      softDrop: true,
      piece: piece.type,
    });

    this.refreshGroundedAfterDrop(wasGrounded);
    return true;
  }

  public rotateCW(): boolean {
    return this.rotate(1);
  }

  public rotateCCW(): boolean {
    return this.rotate(-1);
  }

  /**
   * Hard drop (slam): drops the active piece to its lowest valid row, awards +2 pts
   * per cell dropped, emits `slam`, and locks immediately.
   */
  public slam(): number {
    return this.hardDrop();
  }

  public hardDrop(): number {
    if (this.status !== 'playing' || !this.activePiece) {
      return 0;
    }
    const piece = this.activePiece;
    const fromY = piece.y;
    let toY = fromY;

    while (this.canPlace(piece.type, piece.rotation, piece.x, toY + 1)) {
      toY += 1;
    }

    const cellsDropped = toY - fromY;
    piece.y = toY;
    if (toY > piece.lowestY) {
      piece.lowestY = toY;
    }
    this.score += cellsDropped * 2;

    const landingCells = getPieceCells(piece.type, piece.rotation, piece.x, piece.y);
    this.emit({
      type: 'slam',
      piece: piece.type,
      color: TETROMINO_COLORS[piece.type],
      fromY,
      toY,
      cellsDropped,
      cells: landingCells,
    });

    this.lockActivePiece();
    return cellsDropped;
  }

  public hold(): boolean {
    if (this.status !== 'playing' || !this.activePiece || !this.canHold) {
      return false;
    }

    const swappedOut = this.activePiece.type;
    const swappedIn = this.holdPiece ?? this.bag.next();
    this.holdPiece = swappedOut;
    this.canHold = false;
    this.gravityAccumulatorMs = 0;

    this.emit({
      type: 'hold',
      swappedOut,
      swappedIn,
    });

    this.spawnPiece(swappedIn);
    return true;
  }

  /**
   * Advances simulation by `dtMs` milliseconds, handling gravity and the 1000ms
   * bottom-slide lock timer accurately regardless of step size.
   */
  public step(dtMs: number): GameEvent[] {
    if (this.status !== 'playing' || !this.activePiece || !Number.isFinite(dtMs) || dtMs <= 0) {
      return [];
    }

    this.durationMs += dtMs;
    const collected: GameEvent[] = [];
    this.stepEvents = collected;

    try {
      let remaining = dtMs;
      while (remaining > 0 && this.status === 'playing' && this.activePiece) {
        const piece = this.activePiece;
        if (piece.isGrounded) {
          const needed = Math.max(0, this.lockDelayMs - piece.lockTimerMs);
          if (remaining >= needed) {
            piece.lockTimerMs = this.lockDelayMs;
            remaining -= needed;
            this.lockActivePiece();
          } else {
            piece.lockTimerMs += remaining;
            remaining = 0;
          }
        } else {
          const gravityMs = getGravityIntervalMs(this.level);
          const needed = Math.max(0, gravityMs - this.gravityAccumulatorMs);
          if (remaining >= needed) {
            this.gravityAccumulatorMs = 0;
            remaining -= needed;
            this.applyGravityDrop();
          } else {
            this.gravityAccumulatorMs += remaining;
            remaining = 0;
          }
        }
      }
    } finally {
      this.stepEvents = null;
    }

    return collected;
  }

  public getSnapshot(): GameSnapshot {
    const piece = this.activePiece;
    let activeSnapshot: ActivePieceState | null = null;
    let ghostCells: GridPoint[] = [];
    let lockProgress = 0;

    if (piece) {
      const cells = getPieceCells(piece.type, piece.rotation, piece.x, piece.y);
      activeSnapshot = {
        type: piece.type,
        rotation: piece.rotation,
        x: piece.x,
        y: piece.y,
        cells,
        color: TETROMINO_COLORS[piece.type],
        isGrounded: piece.isGrounded,
        lockTimerMs: piece.lockTimerMs,
        lockDelayMs: this.lockDelayMs,
        lockResets: piece.lockResets,
        maxLockResets: this.maxLockResets,
      };
      lockProgress = piece.isGrounded
        ? Math.max(0, Math.min(1, piece.lockTimerMs / this.lockDelayMs))
        : 0;

      if (this.ghostEnabled) {
        let ghostY = piece.y;
        while (this.canPlace(piece.type, piece.rotation, piece.x, ghostY + 1)) {
          ghostY += 1;
        }
        ghostCells = getPieceCells(piece.type, piece.rotation, piece.x, ghostY);
      }
    }

    return {
      status: this.status,
      board: cloneBoard(this.board),
      cols: BOARD_COLS,
      visibleRows: BOARD_VISIBLE_ROWS,
      hiddenRows: BOARD_HIDDEN_ROWS,
      totalRows: BOARD_TOTAL_ROWS,
      activePiece: activeSnapshot,
      ghostCells,
      ghostEnabled: this.ghostEnabled,
      holdPiece: this.holdPiece,
      canHold: this.canHold,
      nextQueue: this.bag.peek(this.nextQueueSize),
      score: this.score,
      lines: this.lines,
      level: this.level,
      startLevel: this.startLevel,
      combo: Math.max(0, this.comboStreak),
      maxCombo: this.maxCombo,
      backToBack: this.backToBack,
      tetrises: this.tetrises,
      durationMs: this.durationMs,
      lockProgress,
      gravityIntervalMs: getGravityIntervalMs(this.level),
    };
  }

  private moveHorizontal(dx: -1 | 1): boolean {
    if (this.status !== 'playing' || !this.activePiece) {
      return false;
    }
    const piece = this.activePiece;
    if (!this.canPlace(piece.type, piece.rotation, piece.x + dx, piece.y)) {
      return false;
    }

    const wasGrounded = piece.isGrounded;
    piece.x += dx;

    this.emit({
      type: 'move',
      dx,
      dy: 0,
      softDrop: false,
      piece: piece.type,
    });

    this.handlePostAdjustment(wasGrounded);
    return true;
  }

  private rotate(direction: 1 | -1): boolean {
    if (this.status !== 'playing' || !this.activePiece) {
      return false;
    }
    const piece = this.activePiece;
    const from = piece.rotation;
    const to = direction === 1 ? rotateStateCW(from) : rotateStateCCW(from);
    const kicks = getWallKicks(piece.type, from, to);

    for (let kickIndex = 0; kickIndex < kicks.length; kickIndex++) {
      const [dx, dy] = kicks[kickIndex];
      const nextX = piece.x + dx;
      const nextY = piece.y + dy;
      if (this.canPlace(piece.type, to, nextX, nextY)) {
        const wasGrounded = piece.isGrounded;
        piece.rotation = to;
        piece.x = nextX;
        piece.y = nextY;

        const cells = getPieceCells(piece.type, piece.rotation, piece.x, piece.y);
        this.emit({
          type: 'rotate',
          piece: piece.type,
          from,
          to,
          kickIndex,
          cells,
        });

        if (piece.y > piece.lowestY) {
          piece.lowestY = piece.y;
          piece.lockResets = 0;
          piece.lockTimerMs = 0;
          this.refreshGroundedAfterDrop(wasGrounded);
        } else {
          this.handlePostAdjustment(wasGrounded);
        }

        return true;
      }
    }

    return false;
  }

  private handlePostAdjustment(wasGrounded: boolean): void {
    const piece = this.activePiece;
    if (!piece) {
      return;
    }

    const nowGrounded = !this.canPlace(piece.type, piece.rotation, piece.x, piece.y + 1);
    piece.isGrounded = nowGrounded;

    if (wasGrounded) {
      if (piece.lockResets < this.maxLockResets) {
        piece.lockTimerMs = 0;
        piece.lockResets += 1;
      }
      if (!nowGrounded) {
        this.gravityAccumulatorMs = 0;
      }
    } else if (nowGrounded) {
      if (piece.lockResets < this.maxLockResets) {
        piece.lockTimerMs = 0;
      }
      this.gravityAccumulatorMs = 0;
      this.emit({
        type: 'land',
        piece: piece.type,
        cells: getPieceCells(piece.type, piece.rotation, piece.x, piece.y),
      });
    }
  }

  private refreshGroundedAfterDrop(wasGrounded: boolean): void {
    const piece = this.activePiece;
    if (!piece) {
      return;
    }
    const nowGrounded = !this.canPlace(piece.type, piece.rotation, piece.x, piece.y + 1);
    piece.isGrounded = nowGrounded;
    if (nowGrounded && !wasGrounded) {
      if (piece.lockResets < this.maxLockResets) {
        piece.lockTimerMs = 0;
      }
      this.gravityAccumulatorMs = 0;
      this.emit({
        type: 'land',
        piece: piece.type,
        cells: getPieceCells(piece.type, piece.rotation, piece.x, piece.y),
      });
    }
  }

  private applyGravityDrop(): void {
    const piece = this.activePiece;
    if (!piece) {
      return;
    }

    if (this.canPlace(piece.type, piece.rotation, piece.x, piece.y + 1)) {
      const wasGrounded = piece.isGrounded;
      piece.y += 1;
      if (piece.y > piece.lowestY) {
        piece.lowestY = piece.y;
        piece.lockResets = 0;
        piece.lockTimerMs = 0;
      }
      this.refreshGroundedAfterDrop(wasGrounded);
    } else if (!piece.isGrounded) {
      piece.isGrounded = true;
      if (piece.lockResets < this.maxLockResets) {
        piece.lockTimerMs = 0;
      }
      this.emit({
        type: 'land',
        piece: piece.type,
        cells: getPieceCells(piece.type, piece.rotation, piece.x, piece.y),
      });
    }
  }

  private lockActivePiece(): void {
    const piece = this.activePiece;
    if (!piece) {
      return;
    }

    const cells = getPieceCells(piece.type, piece.rotation, piece.x, piece.y);
    let allAboveVisible = true;

    for (const cell of cells) {
      if (cell.y >= 0 && cell.y < BOARD_TOTAL_ROWS && cell.x >= 0 && cell.x < BOARD_COLS) {
        this.board[cell.y][cell.x] = piece.type;
      }
      if (cell.y >= BOARD_HIDDEN_ROWS) {
        allAboveVisible = false;
      }
    }

    this.emit({
      type: 'lock',
      piece: piece.type,
      color: TETROMINO_COLORS[piece.type],
      cells,
    });

    this.activePiece = null;
    this.gravityAccumulatorMs = 0;

    const fullRows: number[] = [];
    for (let y = 0; y < BOARD_TOTAL_ROWS; y++) {
      if (this.board[y].every((cell) => cell !== null)) {
        fullRows.push(y);
      }
    }

    if (fullRows.length > 0) {
      this.processLineClears(fullRows);
      // Clearing lines frees space; only treat as lock-out if no lines cleared and all cells hidden.
    } else {
      this.comboStreak = -1;
      if (allAboveVisible) {
        this.triggerGameOver();
        return;
      }
    }

    this.canHold = true;
    this.spawnNextPiece();
  }

  private processLineClears(fullRows: number[]): void {
    const clearedCells: ClearedCellInfo[] = [];
    for (const y of fullRows) {
      for (let x = 0; x < BOARD_COLS; x++) {
        const cellType = this.board[y][x];
        if (cellType) {
          clearedCells.push({
            x,
            y,
            piece: cellType,
            color: TETROMINO_COLORS[cellType],
          });
        }
      }
    }

    const clearedSet = new Set(fullRows);
    const survivingRows = this.board.filter((_, y) => !clearedSet.has(y));
    const emptyRows: BoardGrid = Array.from({ length: fullRows.length }, () =>
      Array<TetrominoType | null>(BOARD_COLS).fill(null)
    );
    this.board = [...emptyRows, ...survivingRows];

    const count = Math.min(4, fullRows.length) as 1 | 2 | 3 | 4;
    const isTetris = count === 4;
    const isBackToBack = isTetris && this.backToBack;
    const activeLevel = this.level;

    let basePoints = LINE_BASE_POINTS[count] * activeLevel;
    if (isBackToBack) {
      basePoints = Math.round(basePoints * 1.5);
    }
    this.backToBack = isTetris;

    this.comboStreak += 1;
    const activeCombo = Math.max(0, this.comboStreak);
    if (activeCombo > this.maxCombo) {
      this.maxCombo = activeCombo;
    }

    const comboBonus = activeCombo > 0 ? 50 * activeCombo * activeLevel : 0;
    const totalClearPoints = basePoints + comboBonus;
    this.score += totalClearPoints;
    this.lines += fullRows.length;
    if (isTetris) {
      this.tetrises += 1;
    }

    this.emit({
      type: 'lineClear',
      rows: fullRows,
      count,
      isTetris,
      isBackToBack,
      combo: activeCombo,
      points: totalClearPoints,
      clearedCells,
    });

    const isBoardEmpty = this.board.every((row) => row.every((cell) => cell === null));
    if (isBoardEmpty) {
      const allClearPoints = ALL_CLEAR_POINTS[count] * activeLevel;
      this.score += allClearPoints;
      this.emit({
        type: 'allClear',
        points: allClearPoints,
        level: activeLevel,
      });
    }

    const newLevel = Math.max(this.startLevel, this.startLevel + Math.floor(this.lines / 10));
    if (newLevel > this.level) {
      const previousLevel = this.level;
      this.level = newLevel;
      this.emit({
        type: 'levelUp',
        previousLevel,
        newLevel,
      });
    }
  }

  private spawnNextPiece(): boolean {
    const nextType = this.bag.next();
    return this.spawnPiece(nextType);
  }

  private spawnPiece(type: TetrominoType): boolean {
    const spawnX = SPAWN_COLUMN[type];
    let spawnY = 0;

    if (!this.canPlace(type, 0, spawnX, spawnY)) {
      this.triggerGameOver();
      return false;
    }

    if (this.canPlace(type, 0, spawnX, spawnY + 1)) {
      spawnY = 1;
    }

    const isGrounded = !this.canPlace(type, 0, spawnX, spawnY + 1);
    this.activePiece = {
      type,
      rotation: 0,
      x: spawnX,
      y: spawnY,
      lowestY: spawnY,
      isGrounded,
      lockTimerMs: 0,
      lockResets: 0,
    };
    this.gravityAccumulatorMs = 0;

    if (isGrounded) {
      this.emit({
        type: 'land',
        piece: type,
        cells: getPieceCells(type, 0, spawnX, spawnY),
      });
    }

    return true;
  }

  private triggerGameOver(): void {
    this.status = 'gameover';
    this.activePiece = null;
    this.emit({
      type: 'gameOver',
      score: this.score,
      level: this.level,
      lines: this.lines,
    });
  }

  private canPlace(
    type: TetrominoType,
    rotation: RotationState,
    x: number,
    y: number
  ): boolean {
    const cells = getPieceCells(type, rotation, x, y);
    for (const cell of cells) {
      if (cell.x < 0 || cell.x >= BOARD_COLS || cell.y < 0 || cell.y >= BOARD_TOTAL_ROWS) {
        return false;
      }
      if (this.board[cell.y][cell.x] !== null) {
        return false;
      }
    }
    return true;
  }

  private emit(event: GameEvent): void {
    this.pendingEvents.push(event);
    if (this.pendingEvents.length > MAX_PENDING_EVENTS) {
      this.pendingEvents.shift();
    }
    if (this.stepEvents) {
      this.stepEvents.push(event);
    }
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

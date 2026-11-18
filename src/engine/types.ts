export type TetrominoType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

/**
 * Rotation state following SRS conventions:
 * 0 = spawn orientation, 1 = 90 deg CW (R), 2 = 180 deg, 3 = 270 deg CW (L).
 */
export type RotationState = 0 | 1 | 2 | 3;

export interface GridPoint {
  x: number;
  y: number;
}

export const BOARD_COLS = 10;
export const BOARD_VISIBLE_ROWS = 20;
export const BOARD_HIDDEN_ROWS = 2;
export const BOARD_TOTAL_ROWS = BOARD_VISIBLE_ROWS + BOARD_HIDDEN_ROWS; // 22

export const DEFAULT_LOCK_DELAY_MS = 1000;
export const DEFAULT_MAX_LOCK_RESETS = 15;
export const DEFAULT_NEXT_QUEUE_SIZE = 5;

export const MIN_START_LEVEL = 1;
export const MAX_START_LEVEL = 15;

export const TETROMINO_TYPES: readonly TetrominoType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

export const TETROMINO_COLORS: Record<TetrominoType, string> = {
  I: '#00E5FF',
  O: '#FFD500',
  T: '#B84DFF',
  S: '#2EE86C',
  Z: '#FF3B5C',
  J: '#2F7BFF',
  L: '#FF8C1A',
};

export type GameStatus = 'idle' | 'playing' | 'paused' | 'gameover';

export type BoardGrid = (TetrominoType | null)[][];

export interface ActivePieceState {
  type: TetrominoType;
  rotation: RotationState;
  x: number;
  y: number;
  /** Absolute board coordinates (rows 0..21, cols 0..9). Rows 0..1 are hidden spawn buffer. */
  cells: GridPoint[];
  color: string;
  isGrounded: boolean;
  lockTimerMs: number;
  lockDelayMs: number;
  lockResets: number;
  maxLockResets: number;
}

export interface GameSnapshot {
  status: GameStatus;
  /** 22 rows x 10 cols: rows 0..1 are hidden top buffer, rows 2..21 are the visible 10x20 well. */
  board: BoardGrid;
  cols: number;
  visibleRows: number;
  hiddenRows: number;
  totalRows: number;
  activePiece: ActivePieceState | null;
  /** Empty array when ghost piece is disabled or game has no active piece. */
  ghostCells: GridPoint[];
  ghostEnabled: boolean;
  holdPiece: TetrominoType | null;
  canHold: boolean;
  nextQueue: TetrominoType[];
  score: number;
  lines: number;
  level: number;
  startLevel: number;
  /** Current active combo count (0 when no active combo streak, >= 1 on consecutive line clears). */
  combo: number;
  maxCombo: number;
  backToBack: boolean;
  tetrises: number;
  durationMs: number;
  /** Normalized 0..1 progress of the 1000ms lock timer while grounded (0 when airborne). */
  lockProgress: number;
  gravityIntervalMs: number;
}

export interface ClearedCellInfo {
  x: number;
  y: number;
  piece: TetrominoType;
  color: string;
}

export type GameEvent =
  | {
      type: 'move';
      dx: number;
      dy: number;
      softDrop: boolean;
      piece: TetrominoType;
    }
  | {
      type: 'rotate';
      piece: TetrominoType;
      from: RotationState;
      to: RotationState;
      kickIndex: number;
      cells: GridPoint[];
    }
  | {
      type: 'hold';
      swappedOut: TetrominoType;
      swappedIn: TetrominoType;
    }
  | {
      type: 'slam';
      piece: TetrominoType;
      color: string;
      fromY: number;
      toY: number;
      cellsDropped: number;
      cells: GridPoint[];
    }
  | {
      type: 'land';
      piece: TetrominoType;
      cells: GridPoint[];
    }
  | {
      type: 'lock';
      piece: TetrominoType;
      color: string;
      cells: GridPoint[];
    }
  | {
      type: 'lineClear';
      rows: number[];
      count: 1 | 2 | 3 | 4;
      isTetris: boolean;
      isBackToBack: boolean;
      combo: number;
      points: number;
      clearedCells: ClearedCellInfo[];
    }
  | {
      type: 'allClear';
      points: number;
      level: number;
    }
  | {
      type: 'levelUp';
      previousLevel: number;
      newLevel: number;
    }
  | {
      type: 'gameOver';
      score: number;
      level: number;
      lines: number;
    };

export interface GameOptions {
  startLevel?: number;
  ghostEnabled?: boolean;
  nextQueueSize?: number;
  lockDelayMs?: number;
  maxLockResets?: number;
  autoStart?: boolean;
  rng?: () => number;
  /** Optional deterministic piece sequence (mainly for unit testing). */
  pieceSequence?: TetrominoType[];
  /** Optional pre-populated 22x10 board (mainly for unit testing). */
  initialBoard?: BoardGrid;
}

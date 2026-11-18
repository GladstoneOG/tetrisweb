import { TETROMINO_TYPES, type TetrominoType } from './types';

export interface PieceRandomizerOptions {
  rng?: () => number;
  /** Optional deterministic sequence used first before falling back to 7-bag generation. */
  pieceSequence?: TetrominoType[];
}

/**
 * Standard Tetris 7-bag randomizer: generates shuffled permutations of all 7
 * tetrominoes so each 7-piece bag contains each piece exactly once.
 */
export class SevenBagRandomizer {
  private rng: () => number;
  private queue: TetrominoType[] = [];

  constructor(options: PieceRandomizerOptions = {}) {
    this.rng = options.rng ?? Math.random;
    if (options.pieceSequence && options.pieceSequence.length > 0) {
      this.queue.push(...options.pieceSequence);
    }
  }

  public reset(options: PieceRandomizerOptions = {}): void {
    if (options.rng) {
      this.rng = options.rng;
    }
    this.queue = [];
    if (options.pieceSequence && options.pieceSequence.length > 0) {
      this.queue.push(...options.pieceSequence);
    }
  }

  public next(): TetrominoType {
    this.ensureLength(1);
    return this.queue.shift()!;
  }

  public peek(count: number): TetrominoType[] {
    if (count <= 0) {
      return [];
    }
    this.ensureLength(count);
    return this.queue.slice(0, count);
  }

  private ensureLength(minLength: number): void {
    while (this.queue.length < minLength) {
      this.queue.push(...this.generateBag());
    }
  }

  private generateBag(): TetrominoType[] {
    const bag: TetrominoType[] = [...TETROMINO_TYPES];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const tmp = bag[i];
      bag[i] = bag[j];
      bag[j] = tmp;
    }
    return bag;
  }
}

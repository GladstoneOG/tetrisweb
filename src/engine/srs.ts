import type { RotationState, TetrominoType } from './types';

export type KickOffset = readonly [dx: number, dy: number];

type TransitionKey =
  | '0->1'
  | '1->2'
  | '2->3'
  | '3->0'
  | '1->0'
  | '2->1'
  | '3->2'
  | '0->3';

/**
 * Standard SRS wall-kick offsets for J, L, S, T, Z converted to +y downward coordinates.
 */
const JLSTZ_KICKS: Record<TransitionKey, readonly KickOffset[]> = {
  '0->1': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '1->2': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  '2->3': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '3->0': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '1->0': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  '2->1': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '3->2': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '0->3': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
};

/**
 * Standard SRS wall-kick offsets for the I tetromino converted to +y downward coordinates.
 */
const I_KICKS: Record<TransitionKey, readonly KickOffset[]> = {
  '0->1': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, 1],
    [1, -2],
  ],
  '1->2': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, -2],
    [2, 1],
  ],
  '2->3': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, -1],
    [-1, 2],
  ],
  '3->0': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, 2],
    [-2, -1],
  ],
  '1->0': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, -1],
    [-1, 2],
  ],
  '2->1': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, 2],
    [-2, -1],
  ],
  '3->2': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, 1],
    [1, -2],
  ],
  '0->3': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, -2],
    [2, 1],
  ],
};

const O_KICKS: readonly KickOffset[] = [[0, 0]];

export function rotateStateCW(rotation: RotationState): RotationState {
  return ((rotation + 1) % 4) as RotationState;
}

export function rotateStateCCW(rotation: RotationState): RotationState {
  return ((rotation + 3) % 4) as RotationState;
}

export function getWallKicks(
  type: TetrominoType,
  from: RotationState,
  to: RotationState
): readonly KickOffset[] {
  if (type === 'O') {
    return O_KICKS;
  }
  const key = `${from}->${to}` as TransitionKey;
  if (type === 'I') {
    return I_KICKS[key] ?? O_KICKS;
  }
  return JLSTZ_KICKS[key] ?? O_KICKS;
}

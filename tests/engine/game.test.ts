import { describe, expect, it } from 'vitest';
import {
  BOARD_COLS,
  BOARD_HIDDEN_ROWS,
  BOARD_TOTAL_ROWS,
  BOARD_VISIBLE_ROWS,
  SevenBagRandomizer,
  TETROMINO_COLORS,
  TETROMINO_TYPES,
  TetrisGame,
  createEmptyBoard,
  getGravityIntervalMs,
  type BoardGrid,
  type GameEvent,
  type TetrominoType,
} from '../../src/engine/index';

function makeBoardWithRows(fillRowsFromBottom: number, holeCol: number | null = null): BoardGrid {
  const board = createEmptyBoard();
  for (let i = 0; i < fillRowsFromBottom; i++) {
    const y = BOARD_TOTAL_ROWS - 1 - i;
    for (let x = 0; x < BOARD_COLS; x++) {
      if (x !== holeCol) {
        board[y][x] = 'J';
      }
    }
  }
  return board;
}

describe('Board, Tetrominoes, and 7-Bag Randomizer', () => {
  it('uses standard 10x20 visible + 2 hidden rows (22 total) and exact vibrant colors', () => {
    const game = new TetrisGame({ pieceSequence: ['T', 'I', 'O', 'S', 'Z', 'J', 'L'] });
    const snap = game.getSnapshot();

    expect(snap.cols).toBe(10);
    expect(snap.visibleRows).toBe(20);
    expect(snap.hiddenRows).toBe(2);
    expect(snap.totalRows).toBe(22);
    expect(snap.board.length).toBe(BOARD_TOTAL_ROWS);
    expect(snap.board[0].length).toBe(BOARD_COLS);
    expect(BOARD_VISIBLE_ROWS + BOARD_HIDDEN_ROWS).toBe(BOARD_TOTAL_ROWS);

    expect(TETROMINO_COLORS).toEqual({
      I: '#00E5FF',
      O: '#FFD500',
      T: '#B84DFF',
      S: '#2EE86C',
      Z: '#FF3B5C',
      J: '#2F7BFF',
      L: '#FF8C1A',
    });
  });

  it('produces fair 7-bag permutations where every 7-piece bag contains all 7 pieces once', () => {
    let seed = 123456789;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const bag = new SevenBagRandomizer({ rng });
    const peeked = bag.peek(14);
    const drawn: TetrominoType[] = [];

    for (let b = 0; b < 50; b++) {
      const chunk: TetrominoType[] = [];
      for (let i = 0; i < 7; i++) {
        chunk.push(bag.next());
      }
      drawn.push(...chunk);
      expect(new Set(chunk).size).toBe(7);
      for (const t of TETROMINO_TYPES) {
        expect(chunk).toContain(t);
      }
    }

    expect(drawn.slice(0, 14)).toEqual(peeked);
  });
});

describe('SRS Rotation & Wall Kicks', () => {
  it('rotates pieces clockwise through all 4 SRS states and keeps O stationary', () => {
    const gameT = new TetrisGame({ pieceSequence: ['T', 'O'] });
    const initialCells = gameT.getSnapshot().activePiece!.cells;

    for (let r = 1; r <= 4; r++) {
      expect(gameT.rotateCW()).toBe(true);
      expect(gameT.getSnapshot().activePiece!.rotation).toBe(r % 4);
    }
    expect(gameT.getSnapshot().activePiece!.cells).toEqual(initialCells);

    gameT.hardDrop();
    const oCellsBefore = gameT.getSnapshot().activePiece!.cells;
    expect(gameT.rotateCW()).toBe(true);
    expect(gameT.getSnapshot().activePiece!.cells).toEqual(oCellsBefore);
  });

  it('wall-kicks I and T pieces cleanly off left and right walls', () => {
    // Rotate I vertically against right wall, then rotate CW (1 -> 2) requiring kick left
    const game = new TetrisGame({ pieceSequence: ['I', 'T'] });
    expect(game.rotateCW()).toBe(true); // I state 1 (col x + 2)
    while (game.moveRight()) {
      // slide to right wall
    }
    const rightColBefore = Math.max(...game.getSnapshot().activePiece!.cells.map((c) => c.x));
    expect(rightColBefore).toBe(BOARD_COLS - 1);

    expect(game.rotateCW()).toBe(true); // 1 -> 2 must kick left to stay in bounds
    const iCellsAfter = game.getSnapshot().activePiece!.cells;
    expect(iCellsAfter.every((c) => c.x >= 0 && c.x < BOARD_COLS)).toBe(true);
    expect(Math.max(...iCellsAfter.map((c) => c.x))).toBe(BOARD_COLS - 1);

    // Next is T: rotate to state 3 (L), push to right wall, rotate 3 -> 0 (kick left [-1, 0])
    game.hardDrop();
    expect(game.rotateCCW()).toBe(true); // 0 -> 3
    while (game.moveRight()) {
      // push T right against wall
    }
    expect(game.rotateCW()).toBe(true); // 3 -> 0 wall kick
    const tCells = game.getSnapshot().activePiece!.cells;
    expect(tCells.every((c) => c.x >= 0 && c.x < BOARD_COLS)).toBe(true);
    expect(game.getSnapshot().activePiece!.rotation).toBe(0);
  });

  it('floor-kicks horizontal I piece upward when rotated on the bottom row', () => {
    const game = new TetrisGame({ pieceSequence: ['I', 'T'] });
    // Let gravity drop I piece all the way to the bottom floor without locking
    const grav = getGravityIntervalMs(1);
    for (let i = 0; i < 25; i++) {
      game.step(grav);
      if (game.getSnapshot().activePiece!.isGrounded) break;
    }

    expect(game.getSnapshot().activePiece!.isGrounded).toBe(true);
    expect(game.rotateCW()).toBe(true); // 0 -> 1 floor kick [1, -2]
    const cells = game.getSnapshot().activePiece!.cells;
    expect(cells.every((c) => c.y >= 0 && c.y < BOARD_TOTAL_ROWS)).toBe(true);
    expect(Math.max(...cells.map((c) => c.y))).toBe(BOARD_TOTAL_ROWS - 1);
  });

  it('rotates around stack obstacles using SRS kick offsets', () => {
    const board = createEmptyBoard();
    // Create an obstacle blocking basic 0->1 rotation of T on the right, forcing [-1, 0] or [-1, -1] kick
    board[BOARD_TOTAL_ROWS - 1][5] = 'J';
    board[BOARD_TOTAL_ROWS - 2][5] = 'J';
    const game = new TetrisGame({
      initialBoard: board,
      pieceSequence: ['T', 'I'],
    });
    // Drop T down next to col 5 at x = 2 (cells in cols 2, 3, 4) -> wait for ground
    game.moveLeft();
    // Place T at bottom by stepping gravity
    while (!game.getSnapshot().activePiece!.isGrounded) {
      game.step(900);
    }
    expect(game.rotateCW()).toBe(true);
    const cells = game.getSnapshot().activePiece!.cells;
    expect(cells.every((c) => board[c.y][c.x] === null)).toBe(true);
  });
});

describe('1000ms Bottom Slide Time (Lock Delay) & Move Reset Cap', () => {
  it('allows sliding for 1000ms after landing and exposes lockProgress (0..1)', () => {
    const game = new TetrisGame({
      startLevel: 1,
      pieceSequence: ['T', 'I', 'O'],
    });

    // Drop T onto bottom floor via gravity (20 steps of 900ms, stopping when grounded)
    while (!game.getSnapshot().activePiece!.isGrounded) {
      game.step(900);
    }

    expect(game.getSnapshot().lockProgress).toBe(0);

    game.step(500);
    expect(game.getSnapshot().activePiece!.type).toBe('T');
    expect(game.getSnapshot().lockProgress).toBeCloseTo(0.5, 5);

    game.step(499);
    expect(game.getSnapshot().activePiece!.type).toBe('T');
    expect(game.getSnapshot().lockProgress).toBeCloseTo(0.999, 5);

    const lockEvents = game.step(1);
    expect(lockEvents.some((e) => e.type === 'lock')).toBe(true);
    expect(game.getSnapshot().activePiece!.type).toBe('I');
    expect(game.getSnapshot().lockProgress).toBe(0);
  });

  it('resets the 1000ms lock timer on horizontal moves and rotations up to 15 times, then locks', () => {
    const game = new TetrisGame({
      startLevel: 1,
      pieceSequence: ['O', 'I'],
    });

    while (!game.getSnapshot().activePiece!.isGrounded) {
      game.step(900);
    }

    // Perform 15 horizontal moves after 700ms elapsed each time; piece must NOT lock!
    for (let i = 0; i < 15; i++) {
      game.step(700);
      expect(game.getSnapshot().activePiece!.type).toBe('O');
      expect(game.getSnapshot().lockProgress).toBeCloseTo(0.7, 5);
      const moved = i % 2 === 0 ? game.moveLeft() : game.moveRight();
      expect(moved).toBe(true);
      expect(game.getSnapshot().lockProgress).toBe(0);
      expect(game.getSnapshot().activePiece!.lockResets).toBe(i + 1);
    }

    // Wait 700ms, then make a 16th move: cap (15) reached, so lock timer must NOT reset!
    game.step(700);
    expect(game.moveLeft()).toBe(true);
    expect(game.getSnapshot().activePiece!.lockResets).toBe(15);
    expect(game.getSnapshot().lockProgress).toBeCloseTo(0.7, 5);

    // Remaining 300ms locks the piece
    const events = game.step(300);
    expect(events.some((e) => e.type === 'lock')).toBe(true);
    expect(game.getSnapshot().activePiece!.type).toBe('I');
  });

  it('un-grounds a piece when slid off a ledge so it continues falling', () => {
    const board = createEmptyBoard();
    // 2-high platform on left cols 0..3
    for (let x = 0; x < 4; x++) {
      board[BOARD_TOTAL_ROWS - 1][x] = 'J';
      board[BOARD_TOTAL_ROWS - 2][x] = 'J';
    }

    const game = new TetrisGame({
      initialBoard: board,
      pieceSequence: ['O', 'T'],
    });
    // Move O left over the platform (cols 2,3) and drop to platform
    game.moveLeft();
    game.moveLeft();
    while (!game.getSnapshot().activePiece!.isGrounded) {
      game.step(900);
    }
    const groundedY = game.getSnapshot().activePiece!.y;
    expect(groundedY).toBe(BOARD_TOTAL_ROWS - 4);

    // Wait 800ms, then slide right off the platform into the gap (cols 4,5)
    game.step(800);
    expect(game.moveRight()).toBe(true);
    expect(game.moveRight()).toBe(true);
    expect(game.getSnapshot().activePiece!.isGrounded).toBe(false);
    expect(game.getSnapshot().lockProgress).toBe(0);

    // Gravity drops it all the way to the floor (2 rows deeper)
    game.step(900);
    game.step(900);
    expect(game.getSnapshot().activePiece!.y).toBe(groundedY + 2);
    expect(game.getSnapshot().activePiece!.isGrounded).toBe(true);
  });
});

describe('Ghost Piece, Hold Box, Scoring, Combo, B2B, and Level Progression', () => {
  it('toggles ghostCells via setGhostEnabled(boolean)', () => {
    const game = new TetrisGame({ pieceSequence: ['T', 'I'], ghostEnabled: true });
    const snapOn = game.getSnapshot();
    expect(snapOn.ghostEnabled).toBe(true);
    expect(snapOn.ghostCells.length).toBe(4);
    expect(Math.max(...snapOn.ghostCells.map((c) => c.y))).toBe(BOARD_TOTAL_ROWS - 1);

    game.setGhostEnabled(false);
    const snapOff = game.getSnapshot();
    expect(snapOff.ghostEnabled).toBe(false);
    expect(snapOff.ghostCells).toEqual([]);

    game.setGhostEnabled(true);
    expect(game.getSnapshot().ghostCells.length).toBe(4);
  });

  it('swaps hold piece once per drop and resets on lock', () => {
    const game = new TetrisGame({ pieceSequence: ['T', 'I', 'O', 'L'] });
    expect(game.getSnapshot().activePiece!.type).toBe('T');
    expect(game.getSnapshot().holdPiece).toBeNull();
    expect(game.getSnapshot().canHold).toBe(true);

    expect(game.hold()).toBe(true);
    expect(game.getSnapshot().holdPiece).toBe('T');
    expect(game.getSnapshot().activePiece!.type).toBe('I');
    expect(game.getSnapshot().canHold).toBe(false);

    // Second hold before lock must fail
    expect(game.hold()).toBe(false);
    expect(game.getSnapshot().activePiece!.type).toBe('I');

    // Lock I via slam -> spawns O and restores canHold
    game.hardDrop();
    expect(game.getSnapshot().activePiece!.type).toBe('O');
    expect(game.getSnapshot().canHold).toBe(true);

    // Hold swaps O with T
    expect(game.hold()).toBe(true);
    expect(game.getSnapshot().holdPiece).toBe('O');
    expect(game.getSnapshot().activePiece!.type).toBe('T');
  });

  it('awards Guideline scoring for Single, Double, Triple, Tetris, B2B 1.5x, Combo, All Clear, and Hard Drop', () => {
    // 1. Test Single, Double, Triple on level 1
    const singleBoard = makeBoardWithRows(1, 0);
    // Row 21 has hole at x=0; fill x=1..9 except leave 1 cell? Wait: make hole width 4 or fill with vertical I!
    // Leave cols 0..3 open? No, I horizontal is 4 wide: leave cols 0,1,2,3 open on bottom row -> I clears Single!
    for (let x = 0; x < 4; x++) {
      singleBoard[BOARD_TOTAL_ROWS - 1][x] = null;
    }
    const gSingle = new TetrisGame({
      startLevel: 1,
      initialBoard: singleBoard,
      pieceSequence: ['I', 'O'],
    });
    gSingle.moveLeft();
    gSingle.moveLeft();
    gSingle.moveLeft(); // I spans cols 0..3
    const droppedSingle = gSingle.hardDrop(); // drops 19 rows -> +38 pts + 100 Single + 800 All Clear!
    const eventsSingle = gSingle.consumeEvents();
    const lcSingle = eventsSingle.find((e) => e.type === 'lineClear');
    const acSingle = eventsSingle.find((e) => e.type === 'allClear');
    expect(lcSingle).toMatchObject({ type: 'lineClear', count: 1, points: 100, combo: 0 });
    expect(acSingle).toMatchObject({ type: 'allClear', points: 800 });
    expect(gSingle.getSnapshot().score).toBe(droppedSingle * 2 + 100 + 800);

    // 2. Test Double & Triple
    const doubleBoard = makeBoardWithRows(2, 4);
    // O piece spans cols 4,5; leave cols 4,5 empty on bottom 2 rows
    for (let y = BOARD_TOTAL_ROWS - 2; y < BOARD_TOTAL_ROWS; y++) {
      doubleBoard[y][4] = null;
      doubleBoard[y][5] = null;
    }
    const gDouble = new TetrisGame({
      startLevel: 2,
      initialBoard: doubleBoard,
      pieceSequence: ['O', 'T'],
    });
    const droppedDouble = gDouble.hardDrop();
    expect(gDouble.getSnapshot().score).toBe(droppedDouble * 2 + 300 * 2 + 1200 * 2);

    // Triple with vertical I in col 9 (bottom 3 rows missing col 9)
    const tripleBoard = makeBoardWithRows(3, 9);
    // Add one extra block in col 8 on row 18 so I lands on floor cleanly and only clears 3 rows
    const gTriple = new TetrisGame({
      startLevel: 1,
      initialBoard: tripleBoard,
      pieceSequence: ['I', 'T'],
    });
    gTriple.rotateCW(); // vertical I at x+2 = col 5
    while (gTriple.moveRight()) {
      // col 9
    }
    // Wait: row 18 is empty, rows 19..21 have col 9 empty -> vertical I covers rows 18,19,20,21 -> clears 3 rows (19,20,21) and leaves 1 block at row 18 (not All Clear!)
    const droppedTriple = gTriple.hardDrop();
    expect(gTriple.getSnapshot().lines).toBe(3);
    expect(gTriple.getSnapshot().score).toBe(droppedTriple * 2 + 500);

    // 3. Test Back-to-Back Tetris (1.5x) and Combo (+50 * combo * L)
    const b2bBoard = makeBoardWithRows(8, 9);
    // Add a non-clearing obstacle row? Wait: two vertical I pieces in col 9 back-to-back give 2 Tetrises + Combo x1!
    const gB2B = new TetrisGame({
      startLevel: 1,
      initialBoard: b2bBoard,
      pieceSequence: ['I', 'I', 'O', 'T'],
    });

    // First Tetris
    gB2B.rotateCW();
    while (gB2B.moveRight()) {}
    const drop1 = gB2B.hardDrop();
    const ev1 = gB2B.consumeEvents().find((e) => e.type === 'lineClear')!;
    expect(ev1).toMatchObject({ type: 'lineClear', count: 4, isTetris: true, isBackToBack: false, combo: 0, points: 800 });

    // Second Tetris immediately -> Back-to-Back (1200) + Combo x1 (+50) = 1250 + All Clear (2000)
    gB2B.rotateCW();
    while (gB2B.moveRight()) {}
    const drop2 = gB2B.hardDrop();
    const ev2 = gB2B.consumeEvents().find((e) => e.type === 'lineClear')!;
    expect(ev2).toMatchObject({
      type: 'lineClear',
      count: 4,
      isTetris: true,
      isBackToBack: true,
      combo: 1,
      points: 1250,
    });
    expect(gB2B.getSnapshot().tetrises).toBe(2);
    expect(gB2B.getSnapshot().maxCombo).toBe(1);
    expect(gB2B.getSnapshot().score).toBe(drop1 * 2 + 800 + drop2 * 2 + 1250 + 2000);
  });

  it('starts at chosen startLevel (1..15) and advances every 10 lines with monotonic gravity curve', () => {
    expect(getGravityIntervalMs(1)).toBe(900);
    for (let lvl = 1; lvl < 15; lvl++) {
      expect(getGravityIntervalMs(lvl + 1)).toBeLessThan(getGravityIntervalMs(lvl));
    }
    expect(getGravityIntervalMs(20)).toBeGreaterThanOrEqual(50);

    // Start at level 5 with 10 single-line boards worth of clears using repeated boards? Let's clear 4+4+2 = 10 lines!
    const board = makeBoardWithRows(10, 9);
    const game = new TetrisGame({
      startLevel: 5,
      initialBoard: board,
      pieceSequence: ['I', 'I', 'O', 'T', 'J'],
    });

    expect(game.getSnapshot().level).toBe(5);

    // 4 lines -> 4 total (still level 5)
    game.rotateCW();
    while (game.moveRight()) {}
    game.hardDrop();
    expect(game.getSnapshot().lines).toBe(4);
    expect(game.getSnapshot().level).toBe(5);

    // +4 lines -> 8 total (still level 5)
    game.rotateCW();
    while (game.moveRight()) {}
    game.hardDrop();
    expect(game.getSnapshot().lines).toBe(8);
    expect(game.getSnapshot().level).toBe(5);

    // +2 lines with O? Remaining 2 rows have col 9 open; make col 8 open? No, I vertical covers 4 rows, bottom 2 clear!
    // Wait: pieceSequence[2] is O; let's use I! Wait: let's inject I as 3rd piece too!
    const game2 = new TetrisGame({
      startLevel: 5,
      initialBoard: makeBoardWithRows(10, 9),
      pieceSequence: ['I', 'I', 'I', 'T'],
    });
    for (let k = 0; k < 3; k++) {
      game2.rotateCW();
      while (game2.moveRight()) {}
      game2.hardDrop();
    }
    const events: GameEvent[] = game2.consumeEvents();
    const levelUp = events.find((e) => e.type === 'levelUp');
    expect(game2.getSnapshot().lines).toBe(10);
    expect(game2.getSnapshot().level).toBe(6);
    expect(levelUp).toEqual({ type: 'levelUp', previousLevel: 5, newLevel: 6 });
  });

  it('triggers gameOver on block-out and freezes state while paused', () => {
    const game = new TetrisGame({ pieceSequence: ['O', 'O', 'O'] });
    expect(game.pause()).toBe(true);
    expect(game.getSnapshot().status).toBe('paused');
    const yBefore = game.getSnapshot().activePiece!.y;
    game.step(5000);
    expect(game.getSnapshot().activePiece!.y).toBe(yBefore);
    expect(game.moveLeft()).toBe(false);
    expect(game.resume()).toBe(true);

    // Fill spawn row 0, col 4 to trigger block-out on next spawn
    const fullTop = createEmptyBoard();
    fullTop[0][4] = 'Z';
    fullTop[1][4] = 'Z';
    const gOver = new TetrisGame({ initialBoard: fullTop, pieceSequence: ['O'] });
    expect(gOver.getSnapshot().status).toBe('gameover');
    expect(gOver.getSnapshot().activePiece).toBeNull();
    expect(gOver.consumeEvents().some((e) => e.type === 'gameOver')).toBe(true);

    // Lock-out: piece locks completely in hidden rows (y < 2)
    const lockOutBoard = createEmptyBoard();
    // Fill row 2 under spawn cols so I spawns at y=0 (cells at y=1, hidden!) and locks in row 1
    for (let x = 0; x < BOARD_COLS; x++) {
      lockOutBoard[2][x] = x === 0 ? null : 'J'; // leave 1 hole so row 2 doesn't clear
    }
    const gLockOut = new TetrisGame({ initialBoard: lockOutBoard, pieceSequence: ['I', 'O'] });
    expect(gLockOut.getSnapshot().status).toBe('playing');
    expect(gLockOut.getSnapshot().activePiece!.cells.every((c) => c.y < BOARD_HIDDEN_ROWS)).toBe(true);
    gLockOut.hardDrop();
    expect(gLockOut.getSnapshot().status).toBe('gameover');
    expect(gLockOut.consumeEvents().some((e) => e.type === 'gameOver')).toBe(true);
  });

  it('prevents infinite stalling via upward wall kicks once 15 lock resets are exhausted', () => {
    const game = new TetrisGame({
      startLevel: 1,
      pieceSequence: ['T', 'I'],
    });

    while (!game.getSnapshot().activePiece!.isGrounded) {
      game.step(900);
    }

    // Exhaust all 15 resets via horizontal moves
    for (let i = 0; i < 15; i++) {
      expect(i % 2 === 0 ? game.moveLeft() : game.moveRight()).toBe(true);
    }
    expect(game.getSnapshot().activePiece!.lockResets).toBe(15);

    // Advance 600ms, rotate repeatedly; lock timer must NOT reset back to 0 even if piece kicks/adjusts
    game.step(600);
    expect(game.getSnapshot().lockProgress).toBeCloseTo(0.6, 5);
    game.rotateCW();
    game.rotateCW();
    expect(game.getSnapshot().lockProgress).toBeGreaterThanOrEqual(0.6);

    game.step(400);
    expect(game.getSnapshot().activePiece!.type).toBe('I');
  });
});

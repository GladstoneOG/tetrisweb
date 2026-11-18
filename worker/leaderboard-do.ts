import { DurableObject } from "cloudflare:workers";
import type {
  ApiErrorResponse,
  HealthResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  LoginRequest,
  LoginResponse,
  PlayerProfile,
  SubmitScoreRequest,
  SubmitScoreResponse,
} from "../src/shared/types";

interface PlayerRow {
  [key: string]: SqlStorageValue;
  username: string;
  display_name: string;
  best_score: number;
  games_played: number;
  created_at: number;
  last_seen_at: number;
}

interface ScoreRow {
  [key: string]: SqlStorageValue;
  id: number;
  username: string;
  display_name: string;
  score: number;
  lines: number;
  level: number;
  start_level: number;
  duration_ms: number;
  max_combo: number;
  tetrises: number;
  created_at: number;
}

interface CountRow {
  [key: string]: SqlStorageValue;
  count: number;
}

const USERNAME_MIN_LENGTH = 2;
const USERNAME_MAX_LENGTH = 24;
const DEFAULT_LEADERBOARD_LIMIT = 50;
const MAX_LEADERBOARD_LIMIT = 100;

function jsonResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function errorResponse(error: string, status: number, code?: string): Response {
  const payload: ApiErrorResponse = code ? { error, code } : { error };
  return jsonResponse(payload, status);
}

function mapPlayerRow(row: PlayerRow): PlayerProfile {
  return {
    username: row.username,
    displayName: row.display_name,
    bestScore: row.best_score,
    gamesPlayed: row.games_played,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function mapScoreRow(row: ScoreRow): LeaderboardEntry {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    score: row.score,
    lines: row.lines,
    level: row.level,
    startLevel: row.start_level,
    durationMs: row.duration_ms,
    maxCombo: row.max_combo,
    tetrises: row.tetrises,
    createdAt: row.created_at,
  };
}

function normalizeUsername(
  raw: unknown,
): { ok: true; username: string; displayName: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Username must be a string." };
  }
  const trimmed = raw.trim();
  if (trimmed.length < USERNAME_MIN_LENGTH || trimmed.length > USERNAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters.`,
    };
  }
  // Reject ASCII control characters.
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    return { ok: false, error: "Username contains invalid control characters." };
  }
  return {
    ok: true,
    username: trimmed.toLowerCase(),
    displayName: trimmed,
  };
}

function validateNonNegativeInt(
  value: unknown,
  field: string,
  min: number,
  max: number,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, error: `${field} must be a finite integer.` };
  }
  if (value < min || value > max) {
    return { ok: false, error: `${field} must be between ${min} and ${max}.` };
  }
  return { ok: true, value };
}

const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS players (
    username TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    best_score INTEGER NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_players_best_score
    ON players (best_score DESC, last_seen_at ASC)`,
  `CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    score INTEGER NOT NULL,
    lines INTEGER NOT NULL,
    level INTEGER NOT NULL,
    start_level INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    max_combo INTEGER NOT NULL,
    tetrises INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scores_score_desc
    ON scores (score DESC, created_at ASC, id ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_scores_username
    ON scores (username, score DESC)`,
];

export class LeaderboardDO extends DurableObject<unknown> {
  private initialized = false;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
  }

  private ensureSchema(): void {
    if (this.initialized) return;

    for (const statement of SCHEMA_STATEMENTS) {
      this.ctx.storage.sql.exec(statement);
    }

    this.initialized = true;
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureSchema();

    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    try {
      if (pathname === "/api/health") {
        if (method !== "GET") {
          return errorResponse("Method not allowed.", 405, "METHOD_NOT_ALLOWED");
        }
        return this.handleHealth();
      }

      if (pathname === "/api/login") {
        if (method !== "POST") {
          return errorResponse("Method not allowed.", 405, "METHOD_NOT_ALLOWED");
        }
        return await this.handleLogin(request);
      }

      if (pathname === "/api/leaderboard") {
        if (method !== "GET") {
          return errorResponse("Method not allowed.", 405, "METHOD_NOT_ALLOWED");
        }
        return this.handleLeaderboard(url);
      }

      if (pathname === "/api/scores") {
        if (method !== "POST") {
          return errorResponse("Method not allowed.", 405, "METHOD_NOT_ALLOWED");
        }
        return await this.handleSubmitScore(request);
      }

      return errorResponse("API endpoint not found.", 404, "NOT_FOUND");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error.";
      return errorResponse(message, 500, "INTERNAL_ERROR");
    }
  }

  private handleHealth(): Response {
    const row = this.ctx.storage.sql
      .exec<{ ok: number }>("SELECT 1 AS ok")
      .one();

    if (!row || row.ok !== 1) {
      return errorResponse("SQLite health check failed.", 500, "DB_ERROR");
    }

    const body: HealthResponse = {
      ok: true,
      storage: "durable-object-sqlite",
    };
    return jsonResponse(body, 200);
  }

  private async handleLogin(request: Request): Promise<Response> {
    let body: Partial<LoginRequest>;
    try {
      body = (await request.json()) as Partial<LoginRequest>;
    } catch {
      return errorResponse("Invalid JSON request body.", 400, "INVALID_JSON");
    }

    const normalized = normalizeUsername(body?.username);
    if (!normalized.ok) {
      return errorResponse(normalized.error, 400, "INVALID_USERNAME");
    }

    const now = Date.now();
    const row = this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO players (username, display_name, best_score, games_played, created_at, last_seen_at)
         VALUES (?, ?, 0, 0, ?, ?)
         ON CONFLICT(username) DO UPDATE SET
           display_name = excluded.display_name,
           last_seen_at = excluded.last_seen_at`,
        normalized.username,
        normalized.displayName,
        now,
        now,
      );

      return this.ctx.storage.sql
        .exec<PlayerRow>(
          `SELECT username, display_name, best_score, games_played, created_at, last_seen_at
           FROM players
           WHERE username = ?`,
          normalized.username,
        )
        .one();
    });

    const response: LoginResponse = {
      player: mapPlayerRow(row),
    };
    return jsonResponse(response, 200);
  }

  private handleLeaderboard(url: URL): Response {
    const limitParam = url.searchParams.get("limit");
    let limit = DEFAULT_LEADERBOARD_LIMIT;
    if (limitParam !== null && limitParam !== "") {
      const parsed = Number(limitParam);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
        return errorResponse("limit must be a positive integer.", 400, "INVALID_LIMIT");
      }
      limit = Math.min(parsed, MAX_LEADERBOARD_LIMIT);
    }

    const scoreRows = this.ctx.storage.sql
      .exec<ScoreRow>(
        `SELECT id, username, display_name, score, lines, level, start_level, duration_ms, max_combo, tetrises, created_at
         FROM scores
         ORDER BY score DESC, created_at ASC, id ASC
         LIMIT ?`,
        limit,
      )
      .toArray();

    const playerRows = this.ctx.storage.sql
      .exec<PlayerRow>(
        `SELECT username, display_name, best_score, games_played, created_at, last_seen_at
         FROM players
         WHERE games_played > 0
         ORDER BY best_score DESC, last_seen_at ASC
         LIMIT ?`,
        limit,
      )
      .toArray();

    let player: PlayerProfile | null = null;
    let playerRank: number | null = null;

    const rawUsername = url.searchParams.get("username");
    if (rawUsername && rawUsername.trim().length > 0) {
      const key = rawUsername.trim().toLowerCase();
      const found = this.ctx.storage.sql
        .exec<PlayerRow>(
          `SELECT username, display_name, best_score, games_played, created_at, last_seen_at
           FROM players
           WHERE username = ?`,
          key,
        )
        .toArray();

      if (found.length > 0) {
        const row = found[0];
        player = mapPlayerRow(row);
        if (row.games_played > 0) {
          const rankRow = this.ctx.storage.sql
            .exec<CountRow>(
              `SELECT COUNT(*) AS count
               FROM players
               WHERE games_played > 0
                 AND (best_score > ? OR (best_score = ? AND last_seen_at < ?))`,
              row.best_score,
              row.best_score,
              row.last_seen_at,
            )
            .one();
          playerRank = rankRow.count + 1;
        }
      }
    }

    const response: LeaderboardResponse = {
      scores: scoreRows.map(mapScoreRow),
      topPlayers: playerRows.map(mapPlayerRow),
      player,
      playerRank,
    };
    return jsonResponse(response, 200);
  }

  private async handleSubmitScore(request: Request): Promise<Response> {
    let body: Partial<SubmitScoreRequest>;
    try {
      body = (await request.json()) as Partial<SubmitScoreRequest>;
    } catch {
      return errorResponse("Invalid JSON request body.", 400, "INVALID_JSON");
    }

    const normalized = normalizeUsername(body?.username);
    if (!normalized.ok) {
      return errorResponse(normalized.error, 400, "INVALID_USERNAME");
    }

    const scoreCheck = validateNonNegativeInt(body?.score, "score", 0, 100_000_000);
    if (!scoreCheck.ok) return errorResponse(scoreCheck.error, 400, "INVALID_SCORE");

    const linesCheck = validateNonNegativeInt(body?.lines, "lines", 0, 100_000);
    if (!linesCheck.ok) return errorResponse(linesCheck.error, 400, "INVALID_LINES");

    const levelCheck = validateNonNegativeInt(body?.level, "level", 1, 999);
    if (!levelCheck.ok) return errorResponse(levelCheck.error, 400, "INVALID_LEVEL");

    const startLevelCheck = validateNonNegativeInt(body?.startLevel, "startLevel", 1, 99);
    if (!startLevelCheck.ok) {
      return errorResponse(startLevelCheck.error, 400, "INVALID_START_LEVEL");
    }

    if (levelCheck.value < startLevelCheck.value) {
      return errorResponse("level cannot be less than startLevel.", 400, "INVALID_LEVEL");
    }

    const durationCheck = validateNonNegativeInt(
      body?.durationMs,
      "durationMs",
      0,
      7 * 24 * 60 * 60 * 1000,
    );
    if (!durationCheck.ok) return errorResponse(durationCheck.error, 400, "INVALID_DURATION");

    const maxComboCheck = validateNonNegativeInt(body?.maxCombo, "maxCombo", 0, 10_000);
    if (!maxComboCheck.ok) return errorResponse(maxComboCheck.error, 400, "INVALID_MAX_COMBO");

    const tetrisesCheck = validateNonNegativeInt(body?.tetrises, "tetrises", 0, 100_000);
    if (!tetrisesCheck.ok) return errorResponse(tetrisesCheck.error, 400, "INVALID_TETRISES");

    const now = Date.now();
    const score = scoreCheck.value;

    const response = this.ctx.storage.transactionSync<SubmitScoreResponse>(() => {
      const existingRows = this.ctx.storage.sql
        .exec<PlayerRow>(
          `SELECT username, display_name, best_score, games_played, created_at, last_seen_at
           FROM players
           WHERE username = ?`,
          normalized.username,
        )
        .toArray();

      const existing = existingRows[0];
      const previousBest = existing ? existing.best_score : 0;
      const isNewRecord = score > previousBest;
      const personalBest = Math.max(previousBest, score);

      // Preserve the player's original capitalized displayName when client submits lowercase username.
      const displayName =
        existing && normalized.displayName === normalized.username
          ? existing.display_name
          : normalized.displayName;

      if (existing) {
        this.ctx.storage.sql.exec(
          `UPDATE players
           SET display_name = ?,
               best_score = ?,
               games_played = games_played + 1,
               last_seen_at = ?
           WHERE username = ?`,
          displayName,
          personalBest,
          now,
          normalized.username,
        );
      } else {
        this.ctx.storage.sql.exec(
          `INSERT INTO players (username, display_name, best_score, games_played, created_at, last_seen_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
          normalized.username,
          displayName,
          personalBest,
          now,
          now,
        );
      }

      const inserted = this.ctx.storage.sql
        .exec<ScoreRow>(
          `INSERT INTO scores (
             username, display_name, score, lines, level, start_level,
             duration_ms, max_combo, tetrises, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id, username, display_name, score, lines, level, start_level, duration_ms, max_combo, tetrises, created_at`,
          normalized.username,
          displayName,
          score,
          linesCheck.value,
          levelCheck.value,
          startLevelCheck.value,
          durationCheck.value,
          maxComboCheck.value,
          tetrisesCheck.value,
          now,
        )
        .one();

      const higherRow = this.ctx.storage.sql
        .exec<CountRow>(
          `SELECT COUNT(*) AS count
           FROM scores
           WHERE score > ?
              OR (score = ? AND (created_at < ? OR (created_at = ? AND id < ?)))`,
          inserted.score,
          inserted.score,
          inserted.created_at,
          inserted.created_at,
          inserted.id,
        )
        .one();

      return {
        entry: mapScoreRow(inserted),
        personalBest,
        isNewRecord,
        rank: higherRow.count + 1,
      };
    });

    return jsonResponse(response, 201);
  }
}

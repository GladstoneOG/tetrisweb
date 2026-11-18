import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiErrorResponse,
  HealthResponse,
  LeaderboardResponse,
  LoginResponse,
  SubmitScoreResponse,
} from "../../src/shared/types";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class MockDurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;

    constructor(ctx: DurableObjectState, env: Env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

import worker, { LeaderboardDO, type Env } from "../../worker/index";

function createSqliteDurableObjectState(): {
  state: DurableObjectState;
  db: DatabaseSync;
} {
  const db = new DatabaseSync(":memory:");

  const sql = {
    exec<T extends Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: unknown[]
    ): SqlStorageCursor<T> {
      const stmt = db.prepare(query);
      const rawRows = stmt.all(...(bindings as Array<null | number | bigint | string | Uint8Array>));
      const rows = rawRows.map((row) => ({ ...(row as Record<string, SqlStorageValue>) })) as T[];

      let index = 0;
      return {
        columnNames: rows[0] ? Object.keys(rows[0]) : [],
        rowsRead: rows.length,
        rowsWritten: 0,
        next(): IteratorResult<T, undefined> {
          if (index < rows.length) {
            return { value: rows[index++], done: false };
          }
          return { value: undefined, done: true };
        },
        toArray(): T[] {
          return rows;
        },
        one(): T {
          if (rows.length !== 1) {
            throw new Error(`Expected 1 row from sql.exec().one(), got ${rows.length}`);
          }
          return rows[0];
        },
        *raw<U extends SqlStorageValue[]>(): IterableIterator<U> {
          for (const row of rows) {
            yield Object.values(row) as U;
          }
        },
        [Symbol.iterator](): IterableIterator<T> {
          return rows[Symbol.iterator]();
        },
      } as unknown as SqlStorageCursor<T>;
    },
    get databaseSize(): number {
      return 0;
    },
  };

  const storage = {
    sql,
    transactionSync<T>(closure: () => T): T {
      db.exec("BEGIN");
      try {
        const result = closure();
        db.exec("COMMIT");
        return result;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };

  const state = {
    storage,
  } as unknown as DurableObjectState;

  return { state, db };
}

function createWorkerEnv(
  doInstance: LeaderboardDO,
  assetsHandler?: (req: Request) => Promise<Response> | Response,
): { env: Env; idFromNameSpy: ReturnType<typeof vi.fn>; assetsFetchSpy: ReturnType<typeof vi.fn> } {
  const idFromNameSpy = vi.fn((name: string) => ({ toString: () => name }) as DurableObjectId);
  const assetsFetchSpy = vi.fn(
    assetsHandler ??
      (async (req: Request) => {
        const url = new URL(req.url);
        return new Response(`asset:${url.pathname}`, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }),
  );

  const env: Env = {
    LEADERBOARD_DO: {
      idFromName: idFromNameSpy,
      get: vi.fn(() => doInstance as unknown as DurableObjectStub<LeaderboardDO>),
    } as unknown as DurableObjectNamespace<LeaderboardDO>,
    ASSETS: {
      fetch: assetsFetchSpy,
    } as unknown as Fetcher,
  };

  return { env, idFromNameSpy, assetsFetchSpy };
}

describe("LeaderboardDO & Worker API", () => {
  let db: DatabaseSync;
  let doInstance: LeaderboardDO;
  let env: Env;
  let idFromNameSpy: ReturnType<typeof vi.fn>;
  let assetsFetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const setup = createSqliteDurableObjectState();
    db = setup.db;
    doInstance = new LeaderboardDO(setup.state, {});
    const wrapped = createWorkerEnv(doInstance);
    env = wrapped.env;
    idFromNameSpy = wrapped.idFromNameSpy;
    assetsFetchSpy = wrapped.assetsFetchSpy;
  });

  afterEach(() => {
    db.close();
  });

  async function api(path: string, init?: RequestInit): Promise<Response> {
    return worker.fetch(new Request(`https://lumino.test${path}`, init), env);
  }

  it("initializes SQLite schema, indexes, and serves /api/health", async () => {
    const res = await api("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const data = (await res.json()) as HealthResponse;
    expect(data).toEqual({
      ok: true,
      storage: "durable-object-sqlite",
    });

    expect(idFromNameSpy).toHaveBeenCalledWith("global-leaderboard");

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(["players", "scores"]));

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toEqual(
      expect.arrayContaining([
        "idx_players_best_score",
        "idx_scores_score_desc",
        "idx_scores_username",
      ]),
    );
  });

  it("handles POST /api/login with trimming, case-insensitive key, and displayName updates", async () => {
    const first = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "  MomPlayer  " }),
    });
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as LoginResponse;
    expect(firstJson.player).toMatchObject({
      username: "momplayer",
      displayName: "MomPlayer",
      bestScore: 0,
      gamesPlayed: 0,
    });

    // Submit a score so we verify login upsert preserves stats.
    await api("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "momplayer",
        score: 12500,
        lines: 24,
        level: 4,
        startLevel: 1,
        durationMs: 180000,
        maxCombo: 3,
        tetrises: 2,
      }),
    });

    const second = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "MOMPLAYER" }),
    });
    expect(second.status).toBe(200);
    const secondJson = (await second.json()) as LoginResponse;
    expect(secondJson.player).toMatchObject({
      username: "momplayer",
      displayName: "MOMPLAYER",
      bestScore: 12500,
      gamesPlayed: 1,
    });
    expect(secondJson.player.createdAt).toBe(firstJson.player.createdAt);
    expect(secondJson.player.lastSeenAt).toBeGreaterThanOrEqual(firstJson.player.lastSeenAt);
  });

  it("validates usernames on POST /api/login", async () => {
    const invalidBodies = [
      JSON.stringify({ username: "a" }),
      JSON.stringify({ username: "   " }),
      JSON.stringify({ username: "a".repeat(25) }),
      JSON.stringify({ username: "bad\nname" }),
      JSON.stringify({ username: 123 }),
      "{not-valid-json",
    ];

    for (const body of invalidBodies) {
      const res = await api("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      expect(res.status).toBe(400);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      const err = (await res.json()) as ApiErrorResponse;
      expect(typeof err.error).toBe("string");
      expect(err.error.length).toBeGreaterThan(0);
    }
  });

  it("tracks personalBest, isNewRecord, gamesPlayed, displayName preservation, and global rank on POST /api/scores", async () => {
    await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Sarah" }),
    });

    // First score for Sarah (submitted with lowercase username)
    const s1 = await api("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "sarah",
        score: 8000,
        lines: 18,
        level: 3,
        startLevel: 1,
        durationMs: 120000,
        maxCombo: 2,
        tetrises: 1,
      }),
    });
    expect(s1.status).toBe(201);
    const j1 = (await s1.json()) as SubmitScoreResponse;
    expect(j1.isNewRecord).toBe(true);
    expect(j1.personalBest).toBe(8000);
    expect(j1.rank).toBe(1);
    expect(j1.entry.displayName).toBe("Sarah");

    // Higher score by another player (auto-creates player)
    const s2 = await api("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Dad",
        score: 15000,
        lines: 36,
        level: 5,
        startLevel: 2,
        durationMs: 210000,
        maxCombo: 4,
        tetrises: 3,
      }),
    });
    expect(s2.status).toBe(201);
    const j2 = (await s2.json()) as SubmitScoreResponse;
    expect(j2.isNewRecord).toBe(true);
    expect(j2.personalBest).toBe(15000);
    expect(j2.rank).toBe(1);

    // Lower score by Sarah: not a new record, rank 3
    const s3 = await api("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "sarah",
        score: 5000,
        lines: 10,
        level: 2,
        startLevel: 1,
        durationMs: 90000,
        maxCombo: 1,
        tetrises: 0,
      }),
    });
    expect(s3.status).toBe(201);
    const j3 = (await s3.json()) as SubmitScoreResponse;
    expect(j3.isNewRecord).toBe(false);
    expect(j3.personalBest).toBe(8000);
    expect(j3.rank).toBe(3);

    // New personal best for Sarah that beats Dad
    const s4 = await api("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "sarah",
        score: 22000,
        lines: 50,
        level: 6,
        startLevel: 1,
        durationMs: 310000,
        maxCombo: 6,
        tetrises: 5,
      }),
    });
    expect(s4.status).toBe(201);
    const j4 = (await s4.json()) as SubmitScoreResponse;
    expect(j4.isNewRecord).toBe(true);
    expect(j4.personalBest).toBe(22000);
    expect(j4.rank).toBe(1);

    // Verify leaderboard response
    const lbRes = await api("/api/leaderboard?limit=10&username=SARAH");
    expect(lbRes.status).toBe(200);
    const lb = (await lbRes.json()) as LeaderboardResponse;
    expect(lb.scores.map((entry) => entry.score)).toEqual([22000, 15000, 8000, 5000]);
    expect(lb.topPlayers.map((p) => [p.displayName, p.bestScore, p.gamesPlayed])).toEqual([
      ["Sarah", 22000, 3],
      ["Dad", 15000, 1],
    ]);
    expect(lb.player).toMatchObject({
      username: "sarah",
      displayName: "Sarah",
      bestScore: 22000,
      gamesPlayed: 3,
    });
    expect(lb.playerRank).toBe(1);
  });

  it("validates score payloads and leaderboard limits cleanly", async () => {
    const badScores = [
      { username: "ab", score: -1, lines: 0, level: 1, startLevel: 1, durationMs: 0, maxCombo: 0, tetrises: 0 },
      { username: "ab", score: 100.5, lines: 0, level: 1, startLevel: 1, durationMs: 0, maxCombo: 0, tetrises: 0 },
      { username: "ab", score: 100, lines: 0, level: 2, startLevel: 5, durationMs: 0, maxCombo: 0, tetrises: 0 },
      { username: "ab", score: 100, lines: 0, level: 0, startLevel: 1, durationMs: 0, maxCombo: 0, tetrises: 0 },
      { username: "x", score: 100, lines: 0, level: 1, startLevel: 1, durationMs: 0, maxCombo: 0, tetrises: 0 },
    ];

    for (const payload of badScores) {
      const res = await api("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(400);
    }

    const badLimit = await api("/api/leaderboard?limit=0");
    expect(badLimit.status).toBe(400);

    const unknownPlayer = await api("/api/leaderboard?username=nonexistent");
    expect(unknownPlayer.status).toBe(200);
    const lb = (await unknownPlayer.json()) as LeaderboardResponse;
    expect(lb.player).toBeNull();
    expect(lb.playerRank).toBeNull();
  });

  it("handles CORS preflight, HTTP methods, 404 API routes, DO errors, and ASSETS fallback", async () => {
    const preflight = await api("/api/scores", { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain("POST");

    const wrongMethod = await api("/api/health", { method: "POST" });
    expect(wrongMethod.status).toBe(405);

    const unknownApi = await api("/api/unknown");
    expect(unknownApi.status).toBe(404);

    // Non-API requests delegate to env.ASSETS.fetch
    const home = await api("/");
    expect(home.status).toBe(200);
    expect(await home.text()).toBe("asset:/");
    expect(assetsFetchSpy).toHaveBeenCalledTimes(1);

    // Error handling when DO stub throws
    const brokenEnv: Env = {
      LEADERBOARD_DO: {
        idFromName: () => ({ toString: () => "global-leaderboard" }) as DurableObjectId,
        get: () =>
          ({
            fetch: async () => {
              throw new Error("DO unavailable");
            },
          }) as unknown as DurableObjectStub<LeaderboardDO>,
      } as unknown as DurableObjectNamespace<LeaderboardDO>,
    };
    const errRes = await worker.fetch(new Request("https://lumino.test/api/health"), brokenEnv);
    expect(errRes.status).toBe(500);
    expect(errRes.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await errRes.json()).toEqual({
      error: "DO unavailable",
      code: "WORKER_ERROR",
    });
  });
});

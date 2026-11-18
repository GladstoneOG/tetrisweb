import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unstable_startWorker } from "wrangler";
import type {
  HealthResponse,
  LeaderboardResponse,
  LoginResponse,
  SubmitScoreResponse,
} from "../../src/shared/types";

type DevWorker = Awaited<ReturnType<typeof unstable_startWorker>>;

describe("Cloudflare Worker + Durable Object SQLite (workerd E2E)", () => {
  let tmpDir: string;
  let devWorker: DevWorker;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumino-tetris-e2e-"));
    fs.writeFileSync(
      path.join(tmpDir, "index.html"),
      "<!doctype html><html><body>Lumino Tetris SPA</body></html>",
    );
    fs.writeFileSync(path.join(tmpDir, "hello.txt"), "static-asset-ok");

    const baseToml = fs.readFileSync(path.resolve("wrangler.toml"), "utf8");
    const workerMain = path.resolve("worker/index.ts").replace(/\\/g, "/");
    const assetsDir = tmpDir.replace(/\\/g, "/");

    const patchedToml = baseToml
      .replace('main = "worker/index.ts"', `main = "${workerMain}"`)
      .replace('directory = "./dist"', `directory = "${assetsDir}"`);

    const tmpToml = path.join(tmpDir, "wrangler.toml");
    fs.writeFileSync(tmpToml, patchedToml);

    devWorker = await unstable_startWorker({
      config: tmpToml,
      dev: {
        server: { port: 0 },
        persist: false,
        logLevel: "error",
      },
    });
  }, 30_000);

  afterAll(async () => {
    if (devWorker) {
      await devWorker.dispose();
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("persists players and scores in LeaderboardDO SQLite and serves static + SPA assets", async () => {
    const healthRes = await devWorker.fetch("http://localhost/api/health");
    expect(healthRes.status).toBe(200);
    expect(healthRes.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await healthRes.json()) as HealthResponse).toEqual({
      ok: true,
      storage: "durable-object-sqlite",
    });

    const loginRes = await devWorker.fetch("http://localhost/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "  CosmicMom  " }),
    });
    expect(loginRes.status).toBe(200);
    const loginData = (await loginRes.json()) as LoginResponse;
    expect(loginData.player).toMatchObject({
      username: "cosmicmom",
      displayName: "CosmicMom",
      bestScore: 0,
      gamesPlayed: 0,
    });

    const scoreRes = await devWorker.fetch("http://localhost/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "cosmicmom",
        score: 9600,
        lines: 20,
        level: 3,
        startLevel: 1,
        durationMs: 145000,
        maxCombo: 3,
        tetrises: 2,
      }),
    });
    expect(scoreRes.status).toBe(201);
    const scoreData = (await scoreRes.json()) as SubmitScoreResponse;
    expect(scoreData.isNewRecord).toBe(true);
    expect(scoreData.personalBest).toBe(9600);
    expect(scoreData.rank).toBe(1);
    expect(scoreData.entry.displayName).toBe("CosmicMom");

    const lbRes = await devWorker.fetch("http://localhost/api/leaderboard?limit=10&username=cosmicmom");
    expect(lbRes.status).toBe(200);
    const lbData = (await lbRes.json()) as LeaderboardResponse;
    expect(lbData.scores).toHaveLength(1);
    expect(lbData.topPlayers).toHaveLength(1);
    expect(lbData.player?.bestScore).toBe(9600);
    expect(lbData.playerRank).toBe(1);

    // Static asset served directly
    const assetRes = await devWorker.fetch("http://localhost/hello.txt");
    expect(assetRes.status).toBe(200);
    expect(await assetRes.text()).toBe("static-asset-ok");

    // Unknown non-API route falls back to SPA index.html
    const spaRes = await devWorker.fetch("http://localhost/leaderboard");
    expect(spaRes.status).toBe(200);
    expect(await spaRes.text()).toContain("Lumino Tetris SPA");
  }, 30_000);
});

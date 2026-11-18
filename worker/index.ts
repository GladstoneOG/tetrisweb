import { LeaderboardDO } from "./leaderboard-do";

export { LeaderboardDO };

export interface Env {
  LEADERBOARD_DO: DurableObjectNamespace<LeaderboardDO>;
  ASSETS?: Fetcher;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      if (request.method.toUpperCase() === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: CORS_HEADERS,
        });
      }

      try {
        const id = env.LEADERBOARD_DO.idFromName("global-leaderboard");
        const stub = env.LEADERBOARD_DO.get(id);
        const doResponse = await stub.fetch(request);
        return withCors(doResponse);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal server error.";
        return withCors(
          new Response(JSON.stringify({ error: message, code: "WORKER_ERROR" }), {
            status: 500,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          }),
        );
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

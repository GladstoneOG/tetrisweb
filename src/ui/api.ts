/**
 * Typed client for the Lumino Tetris Cloudflare Worker API.
 * All calls time out quickly so an offline / unreachable backend never blocks play.
 */
import type {
  ApiErrorResponse,
  LeaderboardResponse,
  LoginRequest,
  LoginResponse,
  SubmitScoreRequest,
  SubmitScoreResponse,
} from '../shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike | null;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
    this.timeoutMs = Math.max(500, options.timeoutMs ?? 6000);
    this.fetchImpl =
      options.fetchImpl ??
      (typeof fetch === 'function' ? (input: string, init?: RequestInit) => fetch(input, init) : null);
  }

  public login(username: string): Promise<LoginResponse> {
    const body: LoginRequest = { username };
    return this.request<LoginResponse>('/api/login', { method: 'POST', body: JSON.stringify(body) });
  }

  public submitScore(payload: SubmitScoreRequest): Promise<SubmitScoreResponse> {
    return this.request<SubmitScoreResponse>('/api/scores', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public getLeaderboard(limit = 50, username?: string | null): Promise<LeaderboardResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (username) params.set('username', username);
    return this.request<LeaderboardResponse>(`/api/leaderboard?${params.toString()}`, { method: 'GET' });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.fetchImpl) {
      throw new ApiError('Network unavailable', 0, 'NO_FETCH');
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        signal: controller?.signal,
      });
    } catch (err) {
      throw new ApiError(
        err instanceof Error && err.name === 'AbortError' ? 'Request timed out' : 'Network unavailable',
        0,
        'NETWORK'
      );
    } finally {
      clearTimeout(timer);
    }

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const errBody = (data ?? {}) as Partial<ApiErrorResponse>;
      throw new ApiError(errBody.error || `Request failed (${res.status})`, res.status, errBody.code);
    }
    if (data === null || typeof data !== 'object') {
      throw new ApiError('Unexpected server response', res.status, 'BAD_RESPONSE');
    }
    return data as T;
  }
}

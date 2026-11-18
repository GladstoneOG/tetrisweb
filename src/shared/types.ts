export interface PlayerProfile {
  username: string;
  displayName: string;
  bestScore: number;
  gamesPlayed: number;
  createdAt: number;
  lastSeenAt: number;
}

export interface LeaderboardEntry {
  id: number;
  username: string;
  displayName: string;
  score: number;
  lines: number;
  level: number;
  startLevel: number;
  durationMs: number;
  maxCombo: number;
  tetrises: number;
  createdAt: number;
}

export interface LoginRequest {
  username: string;
}

export interface LoginResponse {
  player: PlayerProfile;
}

export interface SubmitScoreRequest {
  username: string;
  score: number;
  lines: number;
  level: number;
  startLevel: number;
  durationMs: number;
  maxCombo: number;
  tetrises: number;
}

export interface SubmitScoreResponse {
  entry: LeaderboardEntry;
  personalBest: number;
  isNewRecord: boolean;
  rank: number;
}

export interface LeaderboardResponse {
  scores: LeaderboardEntry[];
  topPlayers: PlayerProfile[];
  player: PlayerProfile | null;
  playerRank: number | null;
}

export interface HealthResponse {
  ok: boolean;
  storage: string;
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
}

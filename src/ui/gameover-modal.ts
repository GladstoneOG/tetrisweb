/** Game Over dialog: score submission, personal best / rank celebration, stats, and actions. */
import type { GameSnapshot } from '../engine/types';
import type { SubmitScoreResponse } from '../shared/types';
import type { ApiClient } from './api';
import { formatDuration, formatNumber, h } from './dom';
import { createIcon } from './icons';
import { Modal } from './modal';

export interface GameOverCallbacks {
  onPlayAgain: () => void;
  onOpenLeaderboard: () => void;
  onMainMenu: () => void;
  onScoreSubmitted?: (response: SubmitScoreResponse) => void;
}

export interface GameOverContext {
  snapshot: GameSnapshot;
  username: string;
  displayName: string;
  previousBest: number;
}

export class GameOverModal {
  public readonly modal: Modal;
  private readonly api: ApiClient;
  private readonly callbacks: GameOverCallbacks;
  private readonly badgeEl: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private submitToken = 0;

  constructor(api: ApiClient, callbacks: GameOverCallbacks) {
    this.api = api;
    this.callbacks = callbacks;
    this.modal = new Modal({
      id: 'gameover-modal',
      title: 'Game Over',
      dismissible: false,
      className: 'gameover-card',
    });

    this.badgeEl = h('div', { class: 'gameover-badge' });
    this.scoreEl = h('div', { class: 'gameover-score num' });
    this.statusEl = h('div', { class: 'gameover-status' });
    this.statsEl = h('div', { class: 'gameover-stats' });

    const playAgainBtn = h('button', {
      class: 'btn btn-primary btn-lg',
      type: 'button',
      'data-action': 'play-again',
      'data-autofocus': true,
      text: 'Play Again',
    });
    playAgainBtn.addEventListener('click', callbacks.onPlayAgain);

    const lbBtn = h(
      'button',
      {
        class: 'btn btn-secondary',
        type: 'button',
        'data-action': 'leaderboard',
      },
      createIcon('trophy', { size: 17 }),
      h('span', { text: 'Leaderboard' })
    );
    lbBtn.addEventListener('click', callbacks.onOpenLeaderboard);

    const menuBtn = h('button', {
      class: 'btn btn-ghost',
      type: 'button',
      'data-action': 'main-menu',
      text: 'Main Menu',
    });
    menuBtn.addEventListener('click', callbacks.onMainMenu);

    this.modal.body.append(
      this.badgeEl,
      h('div', { class: 'gameover-score-wrap' }, h('span', { class: 'label', text: 'FINAL SCORE' }), this.scoreEl),
      this.statusEl,
      this.statsEl,
      h('div', { class: 'gameover-actions' }, playAgainBtn, h('div', { class: 'gameover-subactions' }, lbBtn, menuBtn))
    );
  }

  public isOpen(): boolean {
    return this.modal.isOpen();
  }

  public close(): void {
    this.submitToken += 1;
    this.modal.close();
  }

  public async openAndSubmit(ctx: GameOverContext): Promise<void> {
    const token = ++this.submitToken;
    const { snapshot, previousBest } = ctx;
    const localRecord = snapshot.score > previousBest && snapshot.score > 0;
    const bestSoFar = Math.max(previousBest, snapshot.score);

    this.modal.titleEl.textContent = localRecord ? 'New Personal Best!' : 'Great Run!';
    this.scoreEl.textContent = formatNumber(snapshot.score);
    this.setBadge(localRecord ? 'Personal Best' : `${ctx.displayName}`, localRecord, localRecord);
    this.statusEl.replaceChildren(h('span', { class: 'spinner' }), 'Saving to leaderboard…');
    this.renderStats(snapshot, bestSoFar);
    this.modal.open();

    try {
      const res = await this.api.submitScore({
        username: ctx.username,
        score: Math.max(0, Math.floor(snapshot.score)),
        lines: Math.max(0, Math.floor(snapshot.lines)),
        level: Math.max(1, Math.floor(snapshot.level)),
        startLevel: Math.max(1, Math.floor(snapshot.startLevel)),
        durationMs: Math.max(0, Math.floor(snapshot.durationMs)),
        maxCombo: Math.max(0, Math.floor(snapshot.maxCombo)),
        tetrises: Math.max(0, Math.floor(snapshot.tetrises)),
      });
      if (token !== this.submitToken) return;

      this.callbacks.onScoreSubmitted?.(res);
      this.renderStats(snapshot, res.personalBest);

      const parts: string[] = [];
      if (res.isNewRecord) {
        this.modal.titleEl.textContent = 'New Personal Best!';
        parts.push('New Personal Best!');
      }
      if (res.rank > 0) {
        parts.push(`Global Rank #${res.rank}`);
      }
      this.setBadge(parts.join(' • ') || 'Score Saved', res.isNewRecord || res.rank <= 3, res.isNewRecord);
      this.statusEl.textContent =
        res.rank <= 10
          ? `Top 10 finish (#${res.rank} worldwide)!`
          : `Saved to global leaderboard (#${res.rank}).`;
      this.statusEl.className = 'gameover-status is-success';
    } catch {
      if (token !== this.submitToken) return;
      this.statusEl.textContent = 'Saved on this device (leaderboard offline).';
      this.statusEl.className = 'gameover-status is-offline';
    }
  }

  private setBadge(text: string, celebrate: boolean, withStar = false): void {
    if (withStar && text) {
      this.badgeEl.replaceChildren(createIcon('star', { size: 14 }), h('span', { text }));
    } else {
      this.badgeEl.textContent = text;
    }
    this.badgeEl.classList.toggle('is-celebrate', celebrate);
    this.badgeEl.hidden = !text;
  }

  private renderStats(snapshot: GameSnapshot, best: number): void {
    const items: Array<[string, string]> = [
      ['Best', formatNumber(best)],
      ['Lines', formatNumber(snapshot.lines)],
      ['Level', String(snapshot.level)],
      ['Time', formatDuration(snapshot.durationMs)],
      ['Tetrises', String(snapshot.tetrises)],
      ['Max Combo', snapshot.maxCombo > 0 ? `${snapshot.maxCombo}x` : '—'],
    ];
    this.statsEl.replaceChildren(
      ...items.map(([label, val]) =>
        h('div', { class: 'stat-tile' }, h('span', { class: 'stat-tile-label', text: label }), h('span', { class: 'stat-tile-val num', text: val }))
      )
    );
  }
}

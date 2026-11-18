/** Leaderboard dialog: Top Global Scores, Top Players, and the player's Personal Best. */
import type { LeaderboardResponse } from '../shared/types';
import type { ApiClient } from './api';
import { formatNumber, h } from './dom';
import { createIcon } from './icons';

type Tab = 'scores' | 'players';

export class LeaderboardModal {
  public readonly element: HTMLElement;
  private readonly modalCard: HTMLElement;
  private readonly content: HTMLElement;
  private readonly personal: HTMLElement;
  private readonly tabButtons: Record<Tab, HTMLButtonElement>;
  private readonly api: ApiClient;
  private readonly getUsername: () => string | null;
  private readonly getLocalBest: () => number;
  private openState = false;
  private tab: Tab = 'scores';
  private data: LeaderboardResponse | null = null;
  private requestToken = 0;
  private onCloseCb: (() => void) | null = null;

  constructor(api: ApiClient, getUsername: () => string | null, getLocalBest: () => number) {
    this.api = api;
    this.getUsername = getUsername;
    this.getLocalBest = getLocalBest;

    this.tabButtons = {
      scores: h('button', { class: 'tab is-active', type: 'button', role: 'tab', 'data-tab': 'scores', text: 'Top Scores' }),
      players: h('button', { class: 'tab', type: 'button', role: 'tab', 'data-tab': 'players', text: 'Top Players' }),
    };
    (Object.keys(this.tabButtons) as Tab[]).forEach((t) =>
      this.tabButtons[t].addEventListener('click', () => this.setTab(t))
    );

    const closeBtn = h(
      'button',
      { class: 'icon-btn modal-close', type: 'button', 'aria-label': 'Close leaderboard' },
      createIcon('close', { size: 18 })
    );
    closeBtn.addEventListener('click', () => this.close());

    this.personal = h('div', { class: 'personal-best' });
    this.content = h('div', { class: 'leaderboard-content', role: 'tabpanel' });

    this.modalCard = h(
      'div',
      { class: 'modal-card glass leaderboard-card' },
      h(
        'div',
        { class: 'modal-head' },
        h(
          'h2',
          { class: 'modal-title modal-title-with-icon', id: 'leaderboard-title' },
          createIcon('trophy', { size: 20 }),
          h('span', { text: 'Leaderboard' })
        ),
        closeBtn
      ),
      this.personal,
      h('div', { class: 'tabs', role: 'tablist' }, this.tabButtons.scores, this.tabButtons.players),
      this.content
    );

    this.element = h(
      'div',
      {
        class: 'modal-overlay',
        id: 'leaderboard-modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'leaderboard-title',
        'aria-hidden': 'true',
        'data-no-gesture': true,
      },
      this.modalCard
    );
    this.element.addEventListener('pointerdown', (e) => {
      if (e.target === this.element) {
        e.preventDefault();
        this.close();
      }
    });
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    });
  }

  public isOpen(): boolean {
    return this.openState;
  }

  public async open(onClose?: () => void): Promise<void> {
    this.onCloseCb = onClose ?? null;
    this.openState = true;
    this.element.classList.add('is-open');
    this.element.setAttribute('aria-hidden', 'false');
    this.setTab('scores');
    try {
      this.modalCard.querySelector<HTMLElement>('.modal-close')?.focus({ preventScroll: true });
    } catch {
      // ignore
    }
    await this.refresh();
  }

  public close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.requestToken += 1;
    this.element.classList.remove('is-open');
    this.element.setAttribute('aria-hidden', 'true');
    const cb = this.onCloseCb;
    this.onCloseCb = null;
    cb?.();
  }

  public async refresh(): Promise<void> {
    const token = ++this.requestToken;
    this.data = null;
    this.renderPersonal();
    this.content.replaceChildren(h('div', { class: 'lb-status' }, h('span', { class: 'spinner' }), 'Loading scores…'));
    try {
      const data = await this.api.getLeaderboard(50, this.getUsername());
      if (token !== this.requestToken) return;
      this.data = data;
      this.renderPersonal();
      this.renderContent();
    } catch {
      if (token !== this.requestToken) return;
      const retry = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Try again' });
      retry.addEventListener('click', () => void this.refresh());
      this.content.replaceChildren(
        h(
          'div',
          { class: 'lb-status is-error' },
          h('p', { text: 'The leaderboard is out of reach right now.' }),
          h('p', { class: 'muted', text: 'Your scores are still saved on this device.' }),
          retry
        )
      );
    }
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    (Object.keys(this.tabButtons) as Tab[]).forEach((t) => {
      this.tabButtons[t].classList.toggle('is-active', t === tab);
      this.tabButtons[t].setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    if (this.data) this.renderContent();
  }

  private renderPersonal(): void {
    const username = this.getUsername();
    if (!username) {
      this.personal.replaceChildren();
      return;
    }
    const remoteBest = this.data?.player?.bestScore ?? 0;
    const best = Math.max(remoteBest, this.getLocalBest());
    const rank = this.data?.playerRank;
    const name = this.data?.player?.displayName ?? username;
    this.personal.replaceChildren(
      h('div', { class: 'pb-label', text: 'Your Personal Best' }),
      h('div', { class: 'pb-name', text: name }),
      h('div', { class: 'pb-score num', text: formatNumber(best) }),
      h('div', { class: 'pb-rank', text: rank ? `Global rank #${rank}` : this.data ? 'Unranked — play a game!' : '' })
    );
  }

  private renderContent(): void {
    const data = this.data;
    if (!data) return;
    const me = (this.getUsername() ?? '').toLowerCase();

    if (this.tab === 'scores') {
      if (data.scores.length === 0) {
        this.content.replaceChildren(h('div', { class: 'lb-status', text: 'No scores yet — be the first legend!' }));
        return;
      }
      const tbody = h('tbody');
      data.scores.forEach((s, i) => {
        tbody.append(
          h(
            'tr',
            { class: s.username === me ? 'is-me' : '' },
            h('td', { class: 'rank' }, rankBadge(i + 1)),
            h('td', { class: 'player', text: s.displayName }),
            h('td', { class: 'num', text: formatNumber(s.score) }),
            h('td', { class: 'num hide-xs', text: formatNumber(s.lines) }),
            h('td', { class: 'num hide-xs', text: String(s.level) })
          )
        );
      });
      this.content.replaceChildren(
        h(
          'table',
          { class: 'lb-table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { text: '#' }),
              h('th', { text: 'Player' }),
              h('th', { class: 'num', text: 'Score' }),
              h('th', { class: 'num hide-xs', text: 'Lines' }),
              h('th', { class: 'num hide-xs', text: 'Lvl' })
            )
          ),
          tbody
        )
      );
      return;
    }

    if (data.topPlayers.length === 0) {
      this.content.replaceChildren(h('div', { class: 'lb-status', text: 'No players yet.' }));
      return;
    }
    const tbody = h('tbody');
    data.topPlayers.forEach((p, i) => {
      tbody.append(
        h(
          'tr',
          { class: p.username === me ? 'is-me' : '' },
          h('td', { class: 'rank' }, rankBadge(i + 1)),
          h('td', { class: 'player', text: p.displayName }),
          h('td', { class: 'num', text: formatNumber(p.bestScore) }),
          h('td', { class: 'num hide-xs', text: formatNumber(p.gamesPlayed) })
        )
      );
    });
    this.content.replaceChildren(
      h(
        'table',
        { class: 'lb-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { text: '#' }),
            h('th', { text: 'Player' }),
            h('th', { class: 'num', text: 'Best' }),
            h('th', { class: 'num hide-xs', text: 'Games' })
          )
        ),
        tbody
      )
    );
  }
}

function rankBadge(rank: number): HTMLElement {
  const medal = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
  return h('span', { class: `rank-badge ${medal}`.trim(), text: String(rank) });
}

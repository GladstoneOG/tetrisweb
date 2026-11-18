/** Pause dialog: Resume, Ghost Piece, Music / SFX toggles, Exit to Main Menu. */
import { h } from './dom';
import { createIcon } from './icons';
import { controlsLegend, createToggle, Modal } from './modal';

export interface PauseModalCallbacks {
  onResume: () => void;
  onGhostChange: (enabled: boolean) => void;
  onMusicChange: (enabled: boolean) => void;
  onSfxChange: (enabled: boolean) => void;
  onExit: () => void;
}

export interface PauseModalState {
  ghostEnabled: boolean;
  musicOn: boolean;
  sfxOn: boolean;
}

export class PauseModal {
  public readonly modal: Modal;
  private readonly ghostToggle: ReturnType<typeof createToggle>;
  private readonly musicToggle: ReturnType<typeof createToggle>;
  private readonly sfxToggle: ReturnType<typeof createToggle>;

  constructor(callbacks: PauseModalCallbacks) {
    this.modal = new Modal({
      id: 'pause-modal',
      title: 'Paused',
      dismissible: true,
      onDismiss: callbacks.onResume,
      className: 'pause-card',
    });

    const resumeBtn = h(
      'button',
      {
        class: 'btn btn-primary btn-lg',
        type: 'button',
        'data-action': 'resume',
        'data-autofocus': true,
      },
      createIcon('play', { size: 18 }),
      h('span', { text: 'Resume' })
    );
    resumeBtn.addEventListener('click', callbacks.onResume);

    this.ghostToggle = createToggle('Ghost Piece', true, callbacks.onGhostChange, { name: 'ghost', icon: 'ghost' });
    this.musicToggle = createToggle('Music', true, callbacks.onMusicChange, { name: 'music', icon: 'musicNote' });
    this.sfxToggle = createToggle('Sound Effects', true, callbacks.onSfxChange, { name: 'sfx', icon: 'volumeOn' });

    const exitBtn = h('button', {
      class: 'btn btn-ghost',
      type: 'button',
      'data-action': 'exit',
      text: 'Exit to Main Menu',
    });
    exitBtn.addEventListener('click', callbacks.onExit);

    const legend = h(
      'details',
      { class: 'legend-details' },
      h('summary', { class: 'legend-summary' }, h('span', { text: 'Controls' }), createIcon('chevronDown', { className: 'summary-chevron', size: 16 })),
      controlsLegend(true)
    );

    this.modal.body.append(
      resumeBtn,
      h('div', { class: 'settings-group' }, this.ghostToggle.element, this.musicToggle.element, this.sfxToggle.element),
      legend,
      exitBtn
    );
  }

  public open(state: PauseModalState): void {
    this.ghostToggle.set(state.ghostEnabled);
    this.musicToggle.set(state.musicOn);
    this.sfxToggle.set(state.sfxOn);
    this.modal.open();
  }

  public close(): void {
    this.modal.close();
  }

  public isOpen(): boolean {
    return this.modal.isOpen();
  }
}

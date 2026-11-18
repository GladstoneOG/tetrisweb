/** Exit confirmation dialog triggered from the top-left Exit Door button on the Main Menu. */
import { h } from './dom';
import { createIcon } from './icons';
import { Modal } from './modal';

export interface ExitModalCallbacks {
  onConfirmExit: () => void;
  onCancel: () => void;
}

export class ExitModal {
  public readonly modal: Modal;

  constructor(callbacks: ExitModalCallbacks) {
    this.modal = new Modal({
      id: 'exit-modal',
      title: 'Exit Game?',
      dismissible: true,
      onDismiss: callbacks.onCancel,
      className: 'exit-card',
    });

    const promptEl = h('p', {
      class: 'exit-prompt',
      text: 'Leave the game and return to your browser?',
    });

    const confirmBtn = h(
      'button',
      {
        class: 'btn btn-primary btn-lg exit-confirm-btn',
        type: 'button',
        'data-action': 'confirm-exit',
      },
      createIcon('exitDoor', { size: 18 }),
      h('span', { text: 'Confirm Exit' })
    );
    confirmBtn.addEventListener('click', callbacks.onConfirmExit);

    const noBtn = h('button', {
      class: 'btn btn-secondary btn-lg exit-cancel-btn',
      type: 'button',
      'data-action': 'cancel-exit',
      'data-autofocus': true,
      text: 'No',
    });
    noBtn.addEventListener('click', callbacks.onCancel);

    this.modal.body.append(
      promptEl,
      h('div', { class: 'exit-actions' }, confirmBtn, noBtn)
    );
  }

  public open(): void {
    this.modal.open();
  }

  public close(): void {
    this.modal.close();
  }

  public isOpen(): boolean {
    return this.modal.isOpen();
  }
}

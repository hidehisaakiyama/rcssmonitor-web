// A dialog that stays open beside the field, like rcssmonitor's
// configuration and player type windows: not modal, moved by dragging its
// title, closed with its button or Escape.
import { el } from './dialog';

export class Panel {
  readonly dialog: HTMLDialogElement;
  readonly body: HTMLElement;
  /** Called before the panel is shown, to bring its content up to date. */
  onShow: (() => void) | null = null;

  constructor(parent: HTMLElement, id: string, title: string) {
    this.dialog = el('dialog', 'panel');
    this.dialog.id = id;
    this.dialog.setAttribute('aria-labelledby', `${id}-title`);
    const header = el('div', 'panel-header');
    const heading = el('h2', 'panel-title', title);
    heading.id = `${id}-title`;
    const close = el('button', 'panel-close', '×');
    close.type = 'button';
    close.id = `${id}-close`;
    close.title = 'Close (Escape)';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());
    header.append(heading, close);
    this.body = el('div', 'panel-body');
    this.dialog.append(header, this.body);
    this.dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.attachDrag(header);
    parent.append(this.dialog);
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  show(): void {
    this.onShow?.();
    if (!this.dialog.open) {
      this.dialog.show();
      this.keepInWindow();
    }
  }

  close(): void {
    this.dialog.close();
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.show();
    }
  }

  private attachDrag(handle: HTMLElement): void {
    let start: { x: number; y: number; left: number; top: number } | null = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) {
        return;
      }
      const r = this.dialog.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (start) {
        this.moveTo(start.left + e.clientX - start.x, start.top + e.clientY - start.y);
      }
    });
    const end = () => {
      start = null;
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  private moveTo(left: number, top: number): void {
    const r = this.dialog.getBoundingClientRect();
    const x = Math.max(0, Math.min(left, window.innerWidth - r.width));
    const y = Math.max(0, Math.min(top, window.innerHeight - 32));
    Object.assign(this.dialog.style, { left: `${x}px`, top: `${y}px`, right: 'auto' });
  }

  private keepInWindow(): void {
    const r = this.dialog.getBoundingClientRect();
    if (r.right > window.innerWidth || r.top < 0) {
      this.moveTo(r.left, r.top);
    }
  }
}

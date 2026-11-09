// The status bar (rcssmonitor MainWindow::createStatusBar). Like QStatusBar,
// a temporary message (showMessage) hides the normal text until it times
// out; the connection state and the mouse position stay on the right.
import type { LiveState } from '../io/live/client';

export class StatusBar {
  readonly element: HTMLElement;
  readonly progress: HTMLProgressElement;
  /** The normal text: the log summary, etc. */
  private readonly text: HTMLSpanElement;
  private readonly message: HTMLSpanElement;
  private readonly connection: HTMLSpanElement;
  private readonly mousePos: HTMLSpanElement;
  private messageTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const span = (id: string, className: string) => {
      const s = document.createElement('span');
      s.id = id;
      s.className = className;
      return s;
    };
    this.text = span('load-result', 'status-message');
    this.message = span('status-message', 'status-message');
    this.message.hidden = true;
    // Both texts are announced; the temporary one is the newer.
    this.text.setAttribute('role', 'status');
    this.message.setAttribute('role', 'status');
    this.progress = document.createElement('progress');
    Object.assign(this.progress, { id: 'load-progress', max: 1, value: 0, hidden: true });
    this.connection = span('connection-status', 'connection-status');
    this.connection.hidden = true;
    this.mousePos = span('mouse-pos', 'mouse-pos');

    this.element = document.createElement('footer');
    this.element.className = 'statusbar';
    this.element.append(this.text, this.message, this.progress, this.connection, this.mousePos);
  }

  /** Sets the normal text, with an optional tool tip. */
  setText(text: string, title = ''): void {
    this.text.textContent = text;
    this.text.title = title;
  }

  /** Shows a temporary message; 0 keeps it until the next message or clearMessage(). */
  showMessage(text: string, timeout = 0): void {
    clearTimeout(this.messageTimer);
    this.message.textContent = text;
    this.message.title = text;
    this.message.hidden = false;
    this.text.hidden = true;
    this.messageTimer = timeout > 0 ? setTimeout(() => this.clearMessage(), timeout) : undefined;
  }

  clearMessage(): void {
    clearTimeout(this.messageTimer);
    this.messageTimer = undefined;
    this.message.hidden = true;
    this.text.hidden = false;
  }

  setConnection(state: LiveState, url: string): void {
    const label: Record<LiveState, string> = {
      idle: '',
      connecting: 'Connecting',
      connected: 'Connected',
      waiting: 'Reconnecting',
    };
    this.connection.hidden = state === 'idle';
    this.connection.dataset['state'] = state;
    this.connection.textContent = state === 'idle' ? '' : `${label[state]}: ${url}`;
  }

  setMousePos(text: string): void {
    this.mousePos.textContent = text;
  }
}

// The application window: tool bar, field view and status bar, and the
// wiring between the log loader, the live connection, the log player and
// the view (rcssmonitor src/main_window.cpp).
import type { GameStore } from '../core/game-store';
import { describeFormat } from '../io/format';
import { LiveClient, type LiveState } from '../io/live/client';
import { loadLogFile, type LoadedLog } from '../io/log-loader';
import {
  connectionFromUrl,
  loadConnection,
  saveConnection,
  type ConnectionSettings,
} from '../options/connection';
import { Playback } from '../playback/playback';
import { ViewState } from '../view/view-state';
import { ContextMenu } from './context-menu';
import { showConnectDialog } from './dialogs/connect-dialog';
import { FieldView } from './field-view';
import { Referee } from './referee';
import { handleMonitorKey, handlePlayerKey, handleViewKey } from './shortcuts';
import { StatusBar } from './statusbar';
import { Toolbar } from './toolbar';

const TITLE = 'rcssmonitor-web';

export class App {
  readonly view = new ViewState();
  readonly playback = new Playback();
  readonly field: FieldView;
  readonly live: LiveClient;
  readonly referee: Referee;
  readonly status = new StatusBar();
  private readonly root: HTMLElement;
  private readonly toolbar: Toolbar;
  private readonly fileInput: HTMLInputElement;
  private readonly menu = new ContextMenu();
  private connection: ConnectionSettings = loadConnection();
  private dialogOpen = false;
  private loading = false;
  private storeRevision = -1;
  private wheelDelta = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.field = new FieldView(this.view);
    this.live = new LiveClient({
      state: (s) => this.liveStateChanged(s),
      game: (store) => this.liveGame(store),
      message: (text, timeout) => this.status.showMessage(text, timeout),
    });
    this.referee = new Referee(this.live, this.status, root, () =>
      this.store?.frame(this.playback.index),
    );

    const p = this.playback;
    this.toolbar = new Toolbar({
      open: () => this.fileInput.click(),
      connect: () => void this.connectTo(),
      disconnect: () => this.disconnect(),
      kickOff: () => this.referee.kickOff(),
      live: () => this.goLive(),
      togglePlay: () => p.togglePlay(),
      stepBackward: () => p.stepBackward(),
      stepForward: () => p.stepForward(),
      decelerate: () => p.decelerate(),
      accelerate: () => p.accelerate(),
      previousScore: () => p.goToPreviousScore(),
      nextScore: () => p.goToNextScore(),
      toggleLoop: () => {
        p.loop = !p.loop;
        this.updateToolbar();
      },
      seek: (i) => p.goToIndex(i),
      goToCycle: (c) => p.goToCycle(c),
    });

    this.fileInput = document.createElement('input');
    Object.assign(this.fileInput, {
      type: 'file',
      id: 'rcg-file',
      accept: '.rcg,.gz',
      hidden: true,
    });
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (file) {
        void this.open(file);
      }
    });

    root.append(this.toolbar.element, this.fileInput, this.field.element, this.status.element);
    this.status.setText(
      'Open a game log (.rcg / .rcg.gz) with the open button, Ctrl+O or by dropping it here, ' +
        'or connect to rcssserver (server::ws_port).',
    );

    p.onChange(() => {
      this.field.setFrameIndex(p.index);
      this.updateToolbar();
    });
    this.field.onTick = (now) => this.tick(now);
    this.field.onPointerField = (pos) => {
      this.status.setMousePos(pos ? `(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})` : '');
    };
    this.field.element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const point = this.field.fieldAt(e.clientX, e.clientY);
      this.menu.show(this.referee.menuItems(point), e.clientX, e.clientY);
    });

    window.addEventListener('keydown', (e) => this.keydown(e));
    // Say (dispbye) when the page goes away.
    window.addEventListener('pagehide', () => this.live.disconnect());
    this.field.element.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.attachDrop(root);
    this.updateToolbar();
  }

  get store(): GameStore | null {
    return this.playback.store;
  }

  /** Applies URL parameters (rcssmonitor's command line options), e.g. ?connect=1&port=6080. */
  applyUrlParams(params: URLSearchParams): void {
    const { settings, connect } = connectionFromUrl(this.connection, params);
    this.connection = settings;
    if (connect) {
      this.connect(settings, false);
    }
  }

  async open(file: File): Promise<void> {
    if (this.loading) {
      return;
    }
    // rcssmonitor disconnects before opening a log.
    this.disconnect();
    this.loading = true;
    this.status.progress.hidden = false;
    this.status.progress.value = 0;
    this.status.clearMessage();
    this.status.setText(`Reading ${file.name}…`);
    try {
      const log = await loadLogFile(await file.arrayBuffer(), {
        progress: (phase, fraction, store) => {
          this.status.progress.value = fraction;
          this.status.setText(
            phase === 'decompress'
              ? `Decompressing ${file.name}… ${Math.round(fraction * 100)}%`
              : `Parsing ${file.name}… cycle ${store.lastFrame?.time ?? 0}`,
          );
        },
      });
      this.setStore(log.store);
      document.title = `${file.name} - ${TITLE}`;
      this.status.setText(
        `${file.name}: ${summaryLine(log)}`,
        log.warnings.map((w) => `line ${w.line}: ${w.message}`).join('\n'),
      );
    } catch (error) {
      this.status.setText(
        `${file.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.loading = false;
      this.status.progress.hidden = true;
    }
  }

  /** Shows a game from its first frame with the whole field (MainWindow::openGameLogFile). */
  setStore(store: GameStore | null): void {
    this.view.fitToScreen();
    this.field.setStore(store);
    this.storeRevision = store?.revision ?? -1;
    this.playback.setStore(store);
  }

  /** Connects with the settings; saves them if asked to. */
  connect(settings: ConnectionSettings, save = true): void {
    this.connection = settings;
    if (save) {
      saveConnection(settings);
    }
    this.live.autoReconnect = settings.autoReconnect;
    this.live.reconnectWait = settings.reconnectWait;
    this.live.connect(settings);
  }

  /** Connect to ...: asks where (MainWindow::connectMonitorTo). */
  async connectTo(): Promise<void> {
    if (this.dialogOpen) {
      return;
    }
    this.dialogOpen = true;
    try {
      const settings = await showConnectDialog(this.root, this.connection);
      if (settings) {
        this.connect(settings);
      }
    } finally {
      this.dialogOpen = false;
    }
  }

  disconnect(): void {
    if (this.live.state !== 'idle') {
      this.live.disconnect();
      this.status.showMessage('Disconnected.', 3000);
    }
  }

  /** Live mode (Ctrl+L): only while connected, as in rcssmonitor. */
  private goLive(): void {
    if (this.live.state === 'connected') {
      this.playback.setLive();
    }
  }

  /** A connection was accepted: show its game, following the newest frame. */
  private liveGame(store: GameStore): void {
    this.status.setText(`Live game from ${this.live.url}`);
    document.title = `${this.live.url} - ${TITLE}`;
    this.setStore(store);
    this.playback.setLive();
  }

  private liveStateChanged(state: LiveState): void {
    this.status.setConnection(state, this.live.url);
    if (state !== 'connected' && this.playback.live) {
      // No more frames: the game stays to look at, like a log.
      this.playback.stop();
    }
    this.updateToolbar();
  }

  private tick(now: number): void {
    const store = this.playback.store;
    if (store && store.revision !== this.storeRevision) {
      this.storeRevision = store.revision;
      this.playback.framesAdded();
      this.updateToolbar();
    }
    this.playback.tick(now);
  }

  private updateToolbar(): void {
    const p = this.playback;
    this.toolbar.update({
      frameCount: p.frameCount,
      index: p.index,
      frame: p.store?.frame(p.index),
      playing: p.playing,
      interval: p.interval,
      loop: p.loop,
      live: p.live,
      connection: this.live.state,
    });
  }

  private keydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLInputElement && target.type !== 'range') {
      return;
    }
    // Keys in an open dialog or the pop-up menu belong to them.
    if (target?.closest('dialog[open], .context-menu') || this.menu.isOpen) {
      return;
    }
    // Let a focused button take Space and Enter.
    if (target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) {
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      this.fileInput.click();
      return;
    }
    const monitor = {
      // Connect (Ctrl+C): to the last server, without asking. Like the
      // action in rcssmonitor, it does nothing while connected.
      connect: () => {
        if (this.live.state === 'idle') {
          this.connect(this.connection);
        }
      },
      live: () => this.goLive(),
      kickOff: () => this.referee.kickOff(),
    };
    if (
      handleMonitorKey(monitor, e) ||
      handlePlayerKey(this.playback, e) ||
      handleViewKey(this.view, e)
    ) {
      e.preventDefault();
    }
  }

  /** The wheel steps frames: down is forward (MainWindow::wheelEvent). */
  private wheel(e: WheelEvent): void {
    if (!this.store) {
      return;
    }
    e.preventDefault();
    if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
      this.step(e.deltaY);
      return;
    }
    // Touch pads send many small pixel deltas: step once per 50 pixels.
    this.wheelDelta += e.deltaY;
    while (Math.abs(this.wheelDelta) >= 50) {
      this.step(this.wheelDelta);
      this.wheelDelta -= Math.sign(this.wheelDelta) * 50;
    }
  }

  private step(delta: number): void {
    if (delta > 0) {
      this.playback.stepForward();
    } else if (delta < 0) {
      this.playback.stepBackward();
    }
  }

  private attachDrop(root: HTMLElement): void {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    let depth = 0;
    root.addEventListener('dragenter', (e) => {
      if (hasFiles(e)) {
        ++depth;
        root.classList.add('drop-target');
      }
    });
    root.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        root.classList.remove('drop-target');
      }
    });
    root.addEventListener('dragover', (e) => {
      if (hasFiles(e)) {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'copy';
        }
      }
    });
    root.addEventListener('drop', (e) => {
      depth = 0;
      root.classList.remove('drop-target');
      const file = e.dataTransfer?.files[0];
      if (file) {
        e.preventDefault();
        void this.open(file);
      }
    });
  }
}

function summaryLine({ store, result: r }: LoadedLog): string {
  const first = store.frame(0);
  const last = store.lastFrame;
  const [l, rt] = last?.teams ?? [];
  const warnings = r.warnings > 0 ? `, ${r.warnings} warnings` : '';
  return (
    `${describeFormat(r.info.format)}${r.info.gzip ? ' (gzip)' : ''}, ` +
    `${store.frameCount.toLocaleString('en')} frames, ` +
    `cycles ${first?.time ?? 0}-${last?.time ?? 0}, ` +
    `${l?.name || '(no name)'} ${l?.score ?? 0}-${rt?.score ?? 0} ${rt?.name || '(no name)'}` +
    warnings
  );
}

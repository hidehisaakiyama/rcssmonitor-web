// The application window: tool bar, field view and status bar, and the
// wiring between the log loader, the log player and the view
// (rcssmonitor src/main_window.cpp).
import type { GameStore } from '../core/game-store';
import { describeFormat } from '../io/format';
import { loadLogFile, type LoadedLog } from '../io/log-loader';
import { Playback } from '../playback/playback';
import { ViewState } from '../view/view-state';
import { FieldView } from './field-view';
import { handlePlayerKey, handleViewKey } from './shortcuts';
import { Toolbar } from './toolbar';

const TITLE = 'rcssmonitor-web';

export class App {
  readonly view = new ViewState();
  readonly playback = new Playback();
  readonly field: FieldView;
  private readonly toolbar: Toolbar;
  private readonly fileInput: HTMLInputElement;
  private readonly status: HTMLSpanElement;
  private readonly progress: HTMLProgressElement;
  private readonly mousePos: HTMLSpanElement;
  private loading = false;
  private storeRevision = -1;
  private wheelDelta = 0;

  constructor(root: HTMLElement) {
    this.field = new FieldView(this.view);

    const p = this.playback;
    this.toolbar = new Toolbar({
      open: () => this.fileInput.click(),
      live: () => p.setLive(),
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

    this.status = document.createElement('span');
    this.status.id = 'load-result';
    this.status.className = 'status-message';
    this.status.setAttribute('role', 'status');
    this.progress = document.createElement('progress');
    Object.assign(this.progress, { id: 'load-progress', max: 1, value: 0, hidden: true });
    this.mousePos = document.createElement('span');
    this.mousePos.id = 'mouse-pos';
    this.mousePos.className = 'mouse-pos';
    const statusbar = document.createElement('footer');
    statusbar.className = 'statusbar';
    statusbar.append(this.status, this.progress, this.mousePos);

    root.append(this.toolbar.element, this.fileInput, this.field.element, statusbar);
    this.status.textContent =
      'Open a game log (.rcg / .rcg.gz): the open button, Ctrl+O, or drop a file here.';

    p.onChange(() => {
      this.field.setFrameIndex(p.index);
      this.updateToolbar();
    });
    this.field.onTick = (now) => this.tick(now);
    this.field.onPointerField = (pos) => {
      this.mousePos.textContent = pos ? `(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})` : '';
    };

    window.addEventListener('keydown', (e) => this.keydown(e));
    this.field.element.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.attachDrop(root);
    this.updateToolbar();
  }

  get store(): GameStore | null {
    return this.playback.store;
  }

  async open(file: File): Promise<void> {
    if (this.loading) {
      return;
    }
    this.loading = true;
    this.progress.hidden = false;
    this.progress.value = 0;
    this.status.title = '';
    this.status.textContent = `Reading ${file.name}…`;
    try {
      const log = await loadLogFile(await file.arrayBuffer(), {
        progress: (phase, fraction, store) => {
          this.progress.value = fraction;
          this.status.textContent =
            phase === 'decompress'
              ? `Decompressing ${file.name}… ${Math.round(fraction * 100)}%`
              : `Parsing ${file.name}… cycle ${store.lastFrame?.time ?? 0}`;
        },
      });
      this.setStore(log.store);
      document.title = `${file.name} - ${TITLE}`;
      this.status.textContent = `${file.name}: ${summaryLine(log)}`;
      if (log.result.warnings > 0) {
        this.status.title = log.warnings.map((w) => `line ${w.line}: ${w.message}`).join('\n');
      }
    } catch (error) {
      this.status.textContent = `${file.name}: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.loading = false;
      this.progress.hidden = true;
    }
  }

  /** Shows a game from its first frame with the whole field (MainWindow::openGameLogFile). */
  setStore(store: GameStore | null): void {
    this.view.fitToScreen();
    this.field.setStore(store);
    this.storeRevision = store?.revision ?? -1;
    this.playback.setStore(store);
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
    });
  }

  private keydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLInputElement && target.type !== 'range') {
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
    if (handlePlayerKey(this.playback, e) || handleViewKey(this.view, e)) {
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

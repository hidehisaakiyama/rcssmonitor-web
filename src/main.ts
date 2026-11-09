import type { GameStore } from './core/game-store';
import { describeFormat } from './io/format';
import { loadLogFile, type LoadedLog } from './io/log-loader';
import { FieldView } from './ui/field-view';
import { handleViewKey } from './ui/shortcuts';
import { scoreBoardText } from './view/hud/score-board';
import { ViewState } from './view/view-state';

// Phase 2: the field view with a minimal toolbar. The log player controls
// (Phase 3) and the menus and dialogs (Phase 5) come later.

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const app = document.getElementById('app');
if (!app) {
  throw new Error('#app not found');
}

const view = new ViewState();
const field = new FieldView(view);

const input = el('input', { type: 'file', id: 'rcg-file', accept: '.rcg,.gz', hidden: true });
const openButton = el('button', { type: 'button', id: 'open-button' }, 'Open log…');
const slider = el('input', {
  type: 'range',
  id: 'frame-slider',
  min: '0',
  max: '0',
  value: '0',
  disabled: true,
});
slider.setAttribute('aria-label', 'Frame');
const frameLabel = el('span', { id: 'frame-label', className: 'frame-label' });
const progress = el('progress', { id: 'load-progress', max: 1, value: 0, hidden: true });
const status = el('span', { id: 'load-result', className: 'status-message' });
status.setAttribute('role', 'status');
const mousePos = el('span', { id: 'mouse-pos', className: 'mouse-pos' });

app.append(
  el('header', { className: 'toolbar' }, openButton, input, slider, frameLabel, progress),
  field.element,
  el('footer', { className: 'statusbar' }, status, mousePos),
);
status.textContent = 'Open a game log (.rcg / .rcg.gz) to watch it.';

openButton.addEventListener('click', () => input.click());
input.addEventListener('change', () => {
  const file = input.files?.[0];
  if (file) {
    void open(file);
  }
  input.value = '';
});

slider.addEventListener('input', () => showFrame(Number(slider.value)));

field.onPointerField = (p) => {
  mousePos.textContent = p ? `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})` : '';
};

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (target instanceof HTMLInputElement && target.type !== 'range') {
    return;
  }
  if (frameKey(e) || handleViewKey(view, e)) {
    e.preventDefault();
  }
});

/** Frame stepping for now; the log player of Phase 3 replaces it. */
function frameKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || !field.gameStore) {
    return false;
  }
  const last = field.gameStore.frameCount - 1;
  switch (e.key) {
    case 'ArrowLeft':
      showFrame(field.frameIndex - 1);
      return true;
    case 'ArrowRight':
      showFrame(field.frameIndex + 1);
      return true;
    case 'Home':
      showFrame(0);
      return true;
    case 'End':
      showFrame(last);
      return true;
    default:
      return false;
  }
}

function showFrame(index: number): void {
  field.setFrameIndex(index);
  updateFrameLabel();
}

function updateFrameLabel(): void {
  const store = field.gameStore;
  const frame = store?.frame(field.frameIndex);
  slider.value = String(field.frameIndex);
  frameLabel.textContent =
    store && frame
      ? `${frame.time}${frame.stime > 0 ? `.${frame.stime}` : ''} ` +
        `(${field.frameIndex + 1} / ${store.frameCount})`
      : '';
}

async function open(file: File): Promise<void> {
  progress.hidden = false;
  progress.value = 0;
  status.textContent = `Reading ${file.name}…`;
  try {
    const log = await loadLogFile(await file.arrayBuffer(), {
      progress: (phase, fraction, store) => {
        progress.value = fraction;
        status.textContent =
          phase === 'decompress'
            ? `Decompressing ${file.name}… ${Math.round(fraction * 100)}%`
            : `Parsing ${file.name}… cycle ${store.lastFrame?.time ?? 0}`;
      },
    });
    setStore(log.store);
    status.textContent = `${file.name}: ${summaryLine(log)}`;
    if (log.result.warnings > 0) {
      status.title = log.warnings.map((w) => `line ${w.line}: ${w.message}`).join('\n');
    }
  } catch (error) {
    status.textContent = `${file.name}: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    progress.hidden = true;
  }
}

function setStore(store: GameStore): void {
  field.setStore(store);
  slider.max = String(Math.max(0, store.frameCount - 1));
  slider.disabled = store.frameCount === 0;
  updateFrameLabel();
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

// Hooks for the end-to-end tests and for debugging from the console.
declare global {
  interface Window {
    rcssmonitorWeb?: unknown;
  }
}
window.rcssmonitorWeb = {
  view,
  field,
  showFrame,
  scoreBoard: () => (field.gameStore ? scoreBoardText(field.gameStore, field.frameIndex) : ''),
  renderNow: () => field.renderNow(),
};

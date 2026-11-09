import { Side } from './core/constants';
import type { GameStore } from './core/game-store';
import { describeFormat } from './io/format';
import { loadLogFile, type LoadedLog } from './io/log-loader';

// Phase 1: loads a game log in the Worker and shows a summary of it.
// The field view replaces this page in Phase 2.

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

const input = el('input', { type: 'file', id: 'rcg-file', accept: '.rcg,.gz' });
const progress = el('progress', { id: 'load-progress', max: 1, value: 0, hidden: true });
const result = el('p', { id: 'load-result' });
result.setAttribute('role', 'status');
const details = el('dl', { id: 'log-details', className: 'details' });

app.append(
  el('h1', {}, 'rcssmonitor-web'),
  el('p', { className: 'muted' }, 'Early development. Open a game log to see its summary.'),
  el('label', {}, 'Game log (.rcg / .rcg.gz) ', input),
  progress,
  result,
  details,
);

input.addEventListener('change', () => {
  const file = input.files?.[0];
  if (file) {
    void open(file);
  }
});

async function open(file: File): Promise<void> {
  details.replaceChildren();
  progress.hidden = false;
  progress.value = 0;
  result.textContent = `Reading ${file.name}…`;
  const started = performance.now();
  try {
    const log = await loadLogFile(await file.arrayBuffer(), {
      progress: (phase, fraction, store) => {
        progress.value = fraction;
        result.textContent =
          phase === 'decompress'
            ? `Decompressing ${file.name}… ${Math.round(fraction * 100)}%`
            : `Parsing ${file.name}… cycle ${store.lastFrame?.time ?? 0}`;
      },
    });
    result.textContent = `${file.name}: ${summaryLine(log)}`;
    showDetails(log, performance.now() - started);
  } catch (error) {
    result.textContent = `${file.name}: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    progress.hidden = true;
  }
}

function summaryLine({ store, result: r }: LoadedLog): string {
  const first = store.frame(0);
  const last = store.lastFrame;
  const [l, rt] = last?.teams ?? [];
  return (
    `${describeFormat(r.info.format)}${r.info.gzip ? ' (gzip)' : ''}, ` +
    `${store.frameCount.toLocaleString('en')} frames, ` +
    `cycles ${first?.time ?? 0}-${last?.time ?? 0}, ` +
    `${l?.name || '(no name)'} ${l?.score ?? 0}-${rt?.score ?? 0} ${rt?.name || '(no name)'}`
  );
}

function showDetails({ store, result: r, warnings }: LoadedLog, ms: number): void {
  const rows: [string, string][] = [
    ['Server', store.serverVersion || 'unknown'],
    ['Size', `${r.info.size.toLocaleString('en')} bytes uncompressed`],
    ['Records', r.records.toLocaleString('en')],
    ['Score changes', scoreChanges(store)],
    ['Penalty shoot-out', penalties(store)],
    ['Team logos', logos(store)],
    ['Player types', String(store.playerTypes.length)],
    ['Messages', String(store.messages.length)],
    ['Warnings', warningText(r.warnings, warnings)],
    ['Load time', `${Math.round(ms)} ms`],
  ];
  details.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

function scoreChanges(store: GameStore): string {
  if (store.scoreChanges.length === 0) {
    return 'none';
  }
  return store.scoreChanges
    .map((i) => {
      const f = store.frame(i);
      return f ? `${f.time} (${f.teams[0].score}-${f.teams[1].score})` : '';
    })
    .join(', ');
}

function penalties(store: GameStore): string {
  const marks = (side: Side) =>
    store
      .penaltyKicks(side)
      .map((k) => (k.scored ? 'o' : 'x'))
      .join('');
  const l = marks(Side.Left);
  const r = marks(Side.Right);
  return l === '' && r === '' ? 'none' : `${l} : ${r}`;
}

function logos(store: GameStore): string {
  return store.teamGraphics
    .map(
      (g, i) => `${i === 0 ? 'left' : 'right'} ${g.isEmpty() ? 'none' : `${g.width}x${g.height}`}`,
    )
    .join(', ');
}

function warningText(count: number, first: LoadedLog['warnings']): string {
  if (count === 0) {
    return 'none';
  }
  const sample = first
    .slice(0, 3)
    .map((w) => `line ${w.line}: ${w.message}`)
    .join('; ');
  return `${count} (${sample}${count > 3 ? '; …' : ''})`;
}

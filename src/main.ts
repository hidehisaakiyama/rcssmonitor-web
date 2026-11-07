import { describeFormat } from './io/format';
import { inspectRcg } from './io/inspect';

// Phase 0 skeleton: proves the build, the inline worker and gzip handling.
// It is replaced by the monitor UI in later phases.

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
const result = el('p', { id: 'load-result' });
result.setAttribute('role', 'status');

app.append(
  el('h1', {}, 'rcssmonitor-web'),
  el('p', { className: 'muted' }, 'Early development. Open a game log to check its format.'),
  el('label', {}, 'Game log (.rcg / .rcg.gz) ', input),
  result,
);

input.addEventListener('change', () => {
  const file = input.files?.[0];
  if (!file) {
    return;
  }
  result.textContent = `Reading ${file.name}…`;
  file
    .arrayBuffer()
    .then(inspectRcg)
    .then((r) => {
      result.textContent = r.ok
        ? `${file.name}: ${describeFormat(r.format)}, ${r.gzip ? 'gzip, ' : ''}` +
          `${r.size.toLocaleString('en')} bytes`
        : `${file.name}: ${r.error}`;
    })
    .catch((error: unknown) => {
      result.textContent = `${file.name}: ${String(error)}`;
    });
});

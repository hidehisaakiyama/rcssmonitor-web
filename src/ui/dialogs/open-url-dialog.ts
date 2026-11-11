// File > Open Game Log from URL (not in rcssmonitor): asks for the URL of a
// log to download and open. A URL relative to the page is taken too, and a
// GitHub file page is read from its raw file (io/fetch-log.ts).
import { isMixedContent, parseLogUrl } from '../../io/fetch-log';
import { el, formDialog, row, runDialog } from './dialog';

export function showOpenUrlDialog(parent: HTMLElement, initial: string): Promise<string | null> {
  const d = formDialog('open-url-dialog', 'Open a game log from a URL', 'Open');

  const input = el('input');
  Object.assign(input, {
    id: 'open-url',
    type: 'text',
    value: initial,
    placeholder: 'https://example.com/game.rcg.gz',
    autocomplete: 'off',
    spellcheck: false,
    required: true,
  });
  // The URL opened last is there to be changed or replaced.
  input.addEventListener('focus', () => input.select(), { once: true });

  const warning = el('p', 'dialog-warning');
  warning.id = 'open-url-warning';
  const update = () => {
    let error = '';
    let mixed = false;
    if (input.value !== '') {
      try {
        mixed = isMixedContent(parseLogUrl(input.value, location.href), location.href);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    // OK does not close the dialog while the URL is not one to open.
    input.setCustomValidity(error);
    warning.textContent = mixed
      ? 'This page is served over https, and the browser blocks http:// URLs to other ' +
        'machines. Download the file and open it instead.'
      : '';
    warning.hidden = !mixed;
  };
  input.addEventListener('input', update);
  update();

  d.buttons.before(
    row(
      'URL',
      input,
      '.rcg or .rcg.gz. The server must let other sites read it (CORS). ' +
        'GitHub file pages work too (public repositories, also with Git LFS).',
    ),
    warning,
  );

  return runDialog(parent, d, () => input.value.trim());
}

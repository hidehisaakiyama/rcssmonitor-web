// Help > Shortcut Keys (MainWindow::printShortcutKeys) and Help > About
// (MainWindow::about).
import { keyLabel, MOUSE_ACTIONS, SHORTCUTS } from '../shortcuts';
import { el, formDialog, runDialog } from './dialog';
import { Panel } from './panel';

/** Set by the build (vite.config.ts). */
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

export const APP_NAME = 'rcssmonitor-web';
export const SOURCE_URL = 'https://github.com/hidehisaakiyama/rcssmonitor-web';
const SIMULATOR_URL = 'https://rcsoccersim.github.io/';

export function appVersion(): string {
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
  const commit = typeof __APP_COMMIT__ === 'string' && __APP_COMMIT__ ? ` (${__APP_COMMIT__})` : '';
  return `${version}${commit}`;
}

export function createShortcutDialog(parent: HTMLElement): Panel {
  const panel = new Panel(parent, 'shortcut-dialog', 'Shortcut Keys');
  const table = el('table', 'shortcut-table');
  table.id = 'shortcut-table';
  const head = el('tr');
  head.append(el('th', '', 'Key'), el('th', '', 'Action'));
  table.createTHead().append(head);
  const body = table.createTBody();
  let group = '';
  const addGroup = (name: string) => {
    const tr = el('tr', 'shortcut-group');
    const th = el('th', '', name);
    th.colSpan = 2;
    th.scope = 'colgroup';
    tr.append(th);
    body.append(tr);
  };
  for (const s of SHORTCUTS) {
    if (s.group !== group) {
      group = s.group;
      addGroup(group);
    }
    const tr = el('tr');
    const keys =
      s.keys.length > 4
        ? `${keyLabel(s.keys[0] ?? { key: '' })} … ${keyLabel(s.keys.at(-1) ?? { key: '' })}`
        : s.keys.map(keyLabel).join(', ');
    tr.append(el('td', 'shortcut-key', keys), el('td', '', s.action));
    body.append(tr);
  }
  addGroup('Mouse');
  for (const [what, action] of MOUSE_ACTIONS) {
    const tr = el('tr');
    tr.append(el('td', 'shortcut-key', what), el('td', '', action));
    body.append(tr);
  }
  panel.body.append(table);
  return panel;
}

export async function showAboutDialog(parent: HTMLElement): Promise<void> {
  const d = formDialog('about-dialog', `About ${APP_NAME}`, 'OK');
  d.buttons.firstElementChild?.remove(); // no Cancel
  const link = (href: string) => {
    const a = el('a', '', href);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  };
  const p = (...content: (string | HTMLElement)[]) => {
    const e = el('p');
    e.append(...content);
    return e;
  };
  const version = el('p', 'about-version', `${APP_NAME} ${appVersion()}`);
  version.id = 'about-version';
  d.buttons.before(
    version,
    p(
      'A browser version of the RoboCup Soccer Simulator Monitor (rcssmonitor), which is used ' +
        'to view the simulation as it takes place by connecting to the rcssserver or to view the ' +
        'playback of a simulation by loading a game log file.',
    ),
    p('The RoboCup Soccer Simulator Official Web Page: ', link(SIMULATOR_URL)),
    p('Source code: ', link(SOURCE_URL)),
    p('Author: The RoboCup Soccer Simulator Maintenance Committee.'),
    p('License: GPL-3.0-or-later. Parts are ported from rcssmonitor.'),
  );
  await runDialog(parent, d, () => true);
}

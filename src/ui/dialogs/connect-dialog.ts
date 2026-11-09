// "Connect to ..." (rcssmonitor src/connect_dialog.cpp). There is no
// transport choice: the browser connects with WebSocket only. The automatic
// reconnection, a command line option in rcssmonitor, is set here too.
import { isValidPort, isValidWait, type ConnectionSettings } from '../../options/connection';
import { el, formDialog, row, runDialog } from './dialog';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function showConnectDialog(
  parent: HTMLElement,
  initial: ConnectionSettings,
): Promise<ConnectionSettings | null> {
  const d = formDialog('connect-dialog', 'Connect to the server', 'Connect');

  const input = (id: string, type: string, value: string) => {
    const i = el('input');
    Object.assign(i, { id, type, value, autocomplete: 'off', spellcheck: false });
    return i;
  };
  const host = input('connect-host', 'text', initial.host);
  host.required = true;
  const port = input('connect-port', 'number', String(initial.port));
  Object.assign(port, { min: '1', max: '65535', required: true });
  const path = input('connect-path', 'text', initial.path);
  path.placeholder = '/monitor';
  const reconnect = input('connect-auto-reconnect', 'checkbox', '');
  reconnect.checked = initial.autoReconnect;
  const wait = input('connect-reconnect-wait', 'number', String(initial.reconnectWait));
  Object.assign(wait, { min: '1', max: '3600', required: true });

  const reconnectRow = el('div', 'dialog-row dialog-check');
  const reconnectLabel = el('label', '', 'Reconnect automatically');
  reconnectLabel.htmlFor = reconnect.id;
  reconnectRow.append(reconnect, reconnectLabel);

  const warning = el('p', 'dialog-warning');
  warning.id = 'connect-warning';
  const update = () => {
    wait.disabled = !reconnect.checked;
    // https pages may not open ws:// to other hosts (docs/protocol.md §9).
    const h = host.value.trim().toLowerCase();
    warning.textContent =
      location.protocol === 'https:' && h !== '' && !LOCAL_HOSTS.has(h)
        ? 'This page is served over https, and the browser may block ws:// to a host other ' +
          'than localhost. For a server on the LAN, open the single-file HTML instead.'
        : '';
    warning.hidden = warning.textContent === '';
  };
  host.addEventListener('input', update);
  reconnect.addEventListener('change', update);
  update();

  d.buttons.before(
    row('Host', host),
    row('Port', port, 'server::ws_port'),
    row('Path', path, '/monitor or /player'),
    reconnectRow,
    row('Wait', wait, 'seconds without data before reconnecting'),
    warning,
  );

  return runDialog(parent, d, () => {
    const p = Number(port.value);
    const w = Number(wait.value);
    return {
      host: host.value.trim(),
      port: isValidPort(p) ? p : initial.port,
      path: path.value.trim() || '/monitor',
      autoReconnect: reconnect.checked,
      reconnectWait: isValidWait(w) ? w : initial.reconnectWait,
    };
  });
}

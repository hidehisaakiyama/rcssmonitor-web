// A stand-in for rcssserver's WebSocket monitor port, for development and the
// end-to-end tests: it replays a game log to each monitor with the JSON
// monitor protocol and records the commands the monitors send. The replies
// follow rcssserver (docs/protocol.md); see tools/replay-server/README.md.
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { parseArgs } from 'node:util';
import { WebSocketServer, type WebSocket } from 'ws';
import { PlayMode, playModeFromString } from '../../src/core/constants';
import type { RcgRecord } from '../../src/core/records';
import { loadRcgBytes } from '../../src/io/load';
import { liveStream, type LiveStream } from './live-stream';

export interface ReplayServerOptions {
  /** Address to listen on. Default: all interfaces, as rcssserver. */
  readonly host?: string;
  /** 0 (default) picks a free port. */
  readonly port?: number;
  /** Default "/monitor". Other paths get 404. */
  readonly path?: string;
  /** Milliseconds per show. Default 100 (server::simulator_step). */
  readonly interval?: number;
  /** Starts over at the end of the log; otherwise the connection is closed there. */
  readonly loop?: boolean;
  /**
   * Sets server::coach in server_param and turns server::coach_w_referee
   * off with false. Default: the coach mode of the log (coach or
   * coach_w_referee), which decides whether change_mode and move are accepted.
   */
  readonly coach?: boolean;
  /** server::ws_allowed_origins. Empty (default): any origin. */
  readonly allowedOrigins?: readonly string[];
  /** server::max_monitors. 0 or less (default): no limit. */
  readonly maxMonitors?: number;
  readonly log?: (line: string) => void;
}

export interface ReceivedCommand {
  /** 1 for the first monitor that connected, and so on. */
  readonly monitor: number;
  readonly text: string;
}

interface Monitor {
  readonly id: number;
  readonly socket: WebSocket;
  initialized: boolean;
  /** Next step to send. */
  cursor: number;
  stepTimer?: ReturnType<typeof setInterval>;
  initDeadline?: ReturnType<typeof setTimeout>;
}

/** rcssserver closes a connection that has not sent dispinit within 10 s. */
const INIT_DEADLINE = 10_000;

export class ReplayServer {
  /** Commands received after dispinit, in order. */
  readonly commands: ReceivedCommand[] = [];
  private readonly stream: LiveStream;
  private readonly options: ReplayServerOptions;
  /** Accepts the coach mode commands. */
  readonly coachMode: boolean;
  private readonly http: Server;
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly monitors = new Set<Monitor>();
  private nextId = 1;
  private paused = false;

  /** Reads a game log (JSON or text, gzip or not). */
  static async fromFile(file: string, options: ReplayServerOptions = {}): Promise<ReplayServer> {
    const records: RcgRecord[] = [];
    await loadRcgBytes(new Uint8Array(await readFile(file)), { record: (r) => records.push(r) });
    return new ReplayServer(records, options);
  }

  constructor(records: Iterable<RcgRecord>, options: ReplayServerOptions = {}) {
    this.options = options;
    const coach = options.coach;
    this.stream = liveStream(records, {
      serverParam:
        coach === undefined
          ? {}
          : coach
            ? { coach: true }
            : { coach: false, coach_w_referee: false },
    });
    const sp = this.stream.serverParam;
    this.coachMode = sp?.['coach'] === true || sp?.['coach_w_referee'] === true;
    this.http = createServer((_req, res) => {
      // Not a WebSocket upgrade request.
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('400 Bad Request\n');
    });
    this.http.on('upgrade', (req, socket, head) => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      const origin = req.headers.origin;
      const allowed = options.allowedOrigins ?? [];
      if (path !== (options.path ?? '/monitor')) {
        refuse(socket, '404 Not Found');
      } else if (origin !== undefined && allowed.length > 0 && !allowed.includes(origin)) {
        this.log(`refused: 403 Forbidden (path=${path} origin=${origin})`);
        refuse(socket, '403 Forbidden');
      } else {
        this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws));
      }
    });
  }

  /** Steps in the log. */
  get stepCount(): number {
    return this.stream.steps.length;
  }

  /** Monitors that sent dispinit and are still connected. */
  get monitorCount(): number {
    return [...this.monitors].filter((m) => m.initialized).length;
  }

  /** Resolves with the port. */
  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.options.port ?? 0, this.options.host, () => {
        resolve((this.http.address() as AddressInfo).port);
      });
    });
  }

  async close(): Promise<void> {
    this.dropMonitors();
    this.wss.close();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  /** Closes every connection without a close frame, as rcssserver does when it quits. */
  dropMonitors(): void {
    for (const m of this.monitors) {
      m.socket.terminate();
    }
  }

  /** Stops sending shows (the connections stay open), e.g. to test the monitor's timeout. */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  private accept(socket: WebSocket): void {
    const m: Monitor = { id: this.nextId++, socket, initialized: false, cursor: 0 };
    m.initDeadline = setTimeout(() => socket.terminate(), INIT_DEADLINE);
    this.monitors.add(m);
    socket.on('message', (data, isBinary) => {
      if (!isBinary) {
        this.receive(m, data.toString());
      }
    });
    socket.on('close', () => {
      clearInterval(m.stepTimer);
      clearTimeout(m.initDeadline);
      this.monitors.delete(m);
      if (m.initialized) {
        this.log(`monitor ${m.id} disconnected`);
      }
    });
    socket.on('error', () => {});
  }

  private receive(m: Monitor, data: string): void {
    const text = data.replace(/[\0\r\n]+$/, '');
    if (!m.initialized) {
      this.init(m, text);
      return;
    }
    this.commands.push({ monitor: m.id, text });
    this.log(`monitor ${m.id}: ${text}`);
    this.reply(m, text);
  }

  /** Stadium::parseMonitorInit: a refused monitor stays pending and may try again. */
  private init(m: Monitor, text: string): void {
    const match = /^\s*\(\s*dispinit(?:\s+version\s+([-+.\deE]+))?\s*\)\s*$/.exec(text);
    if (!match) {
      m.socket.send('(error unknown_command)');
      return;
    }
    const max = this.options.maxMonitors ?? 0;
    if (max > 0 && this.monitorCount >= max) {
      m.socket.send('(error no_more_monitor)');
      return;
    }
    if (match[1] === undefined || Number(match[1]) >= 0) {
      // rcssserver also speaks the S-expression protocols; this server only JSON.
      m.socket.send('(error illegal_client_version)');
      return;
    }
    m.initialized = true;
    clearTimeout(m.initDeadline);
    this.log(`monitor ${m.id} connected`);
    for (const message of this.stream.init) {
      m.socket.send(message);
    }
    m.stepTimer = setInterval(() => this.step(m), this.options.interval ?? 100);
  }

  private step(m: Monitor): void {
    if (this.paused) {
      return;
    }
    if (m.cursor >= this.stream.steps.length) {
      if (!this.options.loop || this.stream.steps.length === 0) {
        this.log(`monitor ${m.id}: end of the log`);
        m.socket.terminate();
        return;
      }
      m.cursor = 0;
    }
    for (const message of this.stream.steps[m.cursor]?.messages ?? []) {
      m.socket.send(message);
    }
    ++m.cursor;
  }

  /** Monitor::parseCommand. */
  private reply(m: Monitor, text: string): void {
    const command = /^\(\s*([a-z_]+)/.exec(text)?.[1] ?? '';
    switch (command) {
      case 'dispbye':
        // Monitor::disable(): no close frame.
        m.socket.terminate();
        return;
      case 'dispstart':
        return;
      case 'dispfoul':
        if (!/^\(dispfoul -?\d+ -?\d+ -?\d+\)$/.test(text)) {
          this.sendMsg(m, '(error illegal_command_form)');
        }
        return;
      case 'dispcard':
        if (!/^\(dispcard -?\d+ -?\d+ (yellow|red)\)$/.test(text)) {
          this.sendMsg(m, '(error illegal_command_form)');
        }
        return;
      case 'dispplayer':
      case 'dispdiscard':
        return;
      case 'compression':
        this.sendMsg(m, '(warning compression_unsupported)');
        return;
    }
    if (!this.coachMode) {
      this.sendMsg(m, '(error illegal_command_form)');
      return;
    }
    switch (command) {
      case 'change_mode': {
        const mode = /^\(change_mode ([-\w.+*/?<>]+)\)$/.exec(text)?.[1];
        if (mode === undefined) {
          this.sendMsg(m, '(error illegal_command_form)');
        } else if (playModeFromString(mode) === PlayMode.Null) {
          this.sendMsg(m, '(error illegal_mode)');
        } else {
          this.sendMsg(m, '(ok change_mode)');
        }
        return;
      }
      case 'move':
      case 'start':
      case 'recover':
        this.sendMsg(m, `(ok ${command})`);
        return;
      default:
        this.sendMsg(m, '(error illegal_command_form)');
    }
  }

  private sendMsg(m: Monitor, message: string): void {
    const step = this.stream.steps[Math.max(0, m.cursor - 1)];
    const time = step?.time ?? 0;
    const stime = step?.stime ?? 0;
    m.socket.send(
      JSON.stringify({ msg: { time, ...(stime > 0 ? { stime } : {}), board: 1, message } }),
    );
  }

  private log(line: string): void {
    this.options.log?.(line);
  }
}

/** Answers an upgrade request with an HTTP error and closes it, as rcssserver does. */
function refuse(socket: Duplex, status: string): void {
  const body = `${status}\n`;
  socket.end(
    `HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\n` +
      `Connection: close\r\n\r\n${body}`,
  );
}

const USAGE = `Usage: npm run replay-server -- [options] LOG

Replays a game log (.rcg / .rcg.gz) to monitors as rcssserver does with
server::ws_port, and prints the commands they send.

Options:
  --port N             port to listen on (default 6080)
  --host ADDRESS       address to listen on (default: all interfaces)
  --path PATH          request path (default /monitor)
  --interval MS        milliseconds per show (default 100)
  --loop               start over at the end of the log, instead of closing
  --coach, --no-coach  turn the coach mode on or off (default: as in the log);
                       it accepts change_mode and move (ball)
  --allowed-origins L  comma separated, like server::ws_allowed_origins
  --max-monitors N     like server::max_monitors
`;

/** The command line. Returns the server, or null after printing the usage. */
export async function main(argv: readonly string[]): Promise<ReplayServer | null> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    allowNegative: true,
    options: {
      port: { type: 'string', default: '6080' },
      host: { type: 'string' },
      path: { type: 'string', default: '/monitor' },
      interval: { type: 'string', default: '100' },
      loop: { type: 'boolean', default: false },
      coach: { type: 'boolean' },
      'allowed-origins': { type: 'string', default: '' },
      'max-monitors': { type: 'string', default: '0' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const file = positionals[0];
  if (values.help || file === undefined || positionals.length > 1) {
    process.stdout.write(USAGE);
    return null;
  }
  const path = values.path.startsWith('/') ? values.path : `/${values.path}`;
  const server = await ReplayServer.fromFile(file, {
    host: values.host,
    port: Number(values.port),
    path,
    interval: Number(values.interval),
    loop: values.loop,
    coach: values.coach,
    allowedOrigins: values['allowed-origins']
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
    maxMonitors: Number(values['max-monitors']),
    log: (line) => console.log(line),
  });
  const port = await server.listen();
  console.log(
    `${file}: ${server.stepCount} shows, ` +
      `${server.coachMode ? 'coach mode' : 'no coach mode'}, ` +
      `ws://${values.host ?? 'localhost'}:${port}${path}`,
  );
  return server;
}

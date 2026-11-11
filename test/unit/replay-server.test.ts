import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { Frame } from '../../src/core/frame';
import type { GameStore } from '../../src/core/game-store';
import type { RcgRecord } from '../../src/core/records';
import { LiveReceiver } from '../../src/io/live/protocol';
import { loadRcgBytes } from '../../src/io/load';
import { liveStream } from '../../tools/replay-server/live-stream';
import { ReplayServer } from '../../tools/replay-server/replay-server';
import { fixture, loadFixture } from './helpers';

async function records(name: string): Promise<RcgRecord[]> {
  const out: RcgRecord[] = [];
  await loadRcgBytes(fixture(name), { record: (r) => out.push(r) });
  return out;
}

/** The store a monitor builds from the live messages of a log. */
function receiveAll(recs: RcgRecord[]): GameStore {
  const stream = liveStream(recs);
  const receiver = new LiveReceiver();
  for (const m of [...stream.init, ...stream.steps.flatMap((s) => s.messages)]) {
    expect(receiver.receive(m).kind).toBe('json');
  }
  expect(receiver.warnings).toBe(0);
  return receiver.store;
}

/** The HTTP status of a WebSocket upgrade request. */
function upgradeStatus(port: number, path: string, origin?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...(origin === undefined ? {} : { Origin: origin }),
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

/** A frame without the command counts, which the live protocol lacks; JSON writes -0 as 0. */
const comparable = (f: Frame | undefined): unknown =>
  f &&
  JSON.parse(JSON.stringify(f, (key, value: unknown) => (key === 'counts' ? undefined : value)));

describe('live stream of a log', () => {
  for (const name of ['json-sample.rcg.gz', 'text-v5-sample.rcg.gz', 'json-pk.rcg.gz']) {
    it(`gives the frames of the log: ${name}`, async () => {
      const { store: log } = await loadFixture(name);
      const live = receiveAll(await records(name));
      expect(live.frameCount).toBe(log.frameCount);
      live.frames.forEach((f, i) => {
        expect(comparable(f)).toEqual(comparable(log.frame(i)));
      });
      expect(live.scoreChanges).toEqual(log.scoreChanges);
      expect(live.playerTypes).toEqual(log.playerTypes);
      expect(live.serverParam).toEqual(log.serverParam);
      expect(live.teamGraphics.map((t) => [t.width, t.height])).toEqual(
        log.teamGraphics.map((t) => [t.width, t.height]),
      );
      expect(live.messages.map((m) => m.message)).toEqual(log.messages.map((m) => m.message));
    });
  }

  it('passes the ball height of the planned 2.5D simulator through', async () => {
    const recs = await records('json-pk.rcg.gz');
    const flying = recs.map((r) =>
      r.type === 'show'
        ? { ...r, show: { ...r.show, ball: { ...r.show.ball, z: 2.5, vz: 0.1 } } }
        : r,
    );
    const live = receiveAll(flying);
    expect(live.frame(0)?.ball).toMatchObject({ z: 2.5, vz: 0.1 });
  });

  it('sends the logos and messages before the first show after it', async () => {
    const stream = liveStream(await records('json-sample.rcg.gz'));
    expect(stream.init).toHaveLength(20); // server_param, player_param, 18 types
    const first = stream.steps[0]?.messages ?? [];
    expect(first[0]).toMatch(/^\{"show":\{"time":1,"mode":"kick_off_l","team":/);
    expect(first.filter((m) => m.startsWith('{"team_graphic"'))).toHaveLength(256);
    expect(stream.steps).toHaveLength(267);
  });
});

describe('ReplayServer', () => {
  let server: ReplayServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  /** Connects with Node's WebSocket and collects the messages. */
  async function monitor(port: number, path = '/monitor') {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    const received: string[] = [];
    let closed: number | null = null;
    ws.onmessage = (e) => received.push(String(e.data));
    ws.onclose = (e) => (closed = e.code);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('cannot connect'));
    });
    return { ws, received, closed: () => closed };
  }

  it('answers dispinit like rcssserver', async () => {
    server = new ReplayServer(await records('json-pk.rcg.gz'), {
      host: '127.0.0.1',
      interval: 5,
      maxMonitors: 1,
    });
    const port = await server.listen();
    const a = await monitor(port);
    a.ws.send('(dispstart)');
    a.ws.send('(dispinit version 5)');
    a.ws.send('(dispinit version -1)');
    await expect.poll(() => a.received.length).toBeGreaterThan(22);
    expect(a.received.slice(0, 2)).toEqual([
      '(error unknown_command)',
      '(error illegal_client_version)',
    ]);
    expect(a.received[2]).toMatch(/^\{"server_param":/);
    expect(a.received[22]).toMatch(/^\{"show":\{"time":5998,/);
    expect(server.monitorCount).toBe(1);

    const b = await monitor(port);
    b.ws.send('(dispinit version -1)');
    await expect.poll(() => b.received).toEqual(['(error no_more_monitor)']);

    // The log has 43 shows; then the server closes without a close frame.
    await expect.poll(() => a.closed(), { timeout: 3000 }).toBe(1006);
    expect(a.received.filter((m) => m.startsWith('{"show"'))).toHaveLength(43);
    b.ws.close();
  });

  it('records the commands and replies as rcssserver', async () => {
    server = new ReplayServer(await records('json-pk.rcg.gz'), {
      host: '127.0.0.1',
      interval: 50,
      coach: false,
    });
    expect(server.coachMode).toBe(false);
    const port = await server.listen();
    const m = await monitor(port);
    m.ws.send('(dispinit version -1)');
    await expect.poll(() => server?.monitorCount).toBe(1);
    for (const c of ['(dispfoul 160 -80 0)', '(dispcard 1 3 red)', '(change_mode play_on)']) {
      m.ws.send(c);
    }
    await expect
      .poll(() => m.received.filter((r) => r.startsWith('{"msg"')))
      .toEqual([expect.stringContaining('"message":"(error illegal_command_form)"')]);
    m.ws.send('(dispbye)');
    await expect.poll(() => m.closed()).toBe(1006);
    expect(server.commands).toEqual([
      { monitor: 1, text: '(dispfoul 160 -80 0)' },
      { monitor: 1, text: '(dispcard 1 3 red)' },
      { monitor: 1, text: '(change_mode play_on)' },
      { monitor: 1, text: '(dispbye)' },
    ]);
  });

  it('accepts the coach mode commands in the coach mode', async () => {
    // The game of the fixtures ran with server::coach_w_referee.
    expect(new ReplayServer(await records('json-pk.rcg.gz')).coachMode).toBe(true);
    server = new ReplayServer(await records('json-pk.rcg.gz'), {
      host: '127.0.0.1',
      coach: true,
    });
    const port = await server.listen();
    const m = await monitor(port);
    m.ws.send('(dispinit version -1)');
    await expect.poll(() => m.received.length).toBeGreaterThan(0);
    expect(m.received[0]).toContain('"coach":true');
    m.ws.send('(move (ball) 0 0 0 0 0)');
    m.ws.send('(change_mode no_such_mode)');
    await expect
      .poll(() => m.received.filter((r) => r.startsWith('{"msg"')).map((r) => JSON.parse(r)))
      .toEqual([
        { msg: expect.objectContaining({ message: '(ok move)' }) },
        { msg: expect.objectContaining({ message: '(error illegal_mode)' }) },
      ]);
    m.ws.close();
  });

  it('refuses other paths and origins with HTTP errors', async () => {
    server = new ReplayServer([], { host: '127.0.0.1', allowedOrigins: ['http://a.invalid'] });
    const port = await server.listen();
    expect(await upgradeStatus(port, '/monitor')).toBe(101); // no Origin: always accepted
    expect(await upgradeStatus(port, '/monitor', 'http://a.invalid')).toBe(101);
    expect(await upgradeStatus(port, '/monitor', 'null')).toBe(403);
    expect(await upgradeStatus(port, '/monitor/', 'http://a.invalid')).toBe(404);
    expect(await upgradeStatus(port, '/coach')).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/monitor`)).status).toBe(400);
  });
});

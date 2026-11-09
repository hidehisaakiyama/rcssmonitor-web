import { afterEach, describe, expect, it } from 'vitest';
import type { GameStore } from '../../src/core/game-store';
import type { RcgRecord } from '../../src/core/records';
import { LiveClient, liveUrl, normalizePath, type LiveState } from '../../src/io/live/client';
import { loadRcgBytes } from '../../src/io/load';
import { ReplayServer, type ReplayServerOptions } from '../../tools/replay-server/replay-server';
import { fixture } from './helpers';

const records: RcgRecord[] = [];
await loadRcgBytes(fixture('json-pk.rcg.gz'), { record: (r) => records.push(r) });

describe('live URL', () => {
  it('is built from the host, the port and the path', () => {
    expect(liveUrl({ host: 'localhost', port: 6080, path: '/monitor' })).toBe(
      'ws://localhost:6080/monitor',
    );
    expect(liveUrl({ host: ' 192.168.0.10 ', port: 6080, path: 'player' })).toBe(
      'ws://192.168.0.10:6080/player',
    );
    expect(liveUrl({ host: '::1', port: 6080, path: '/monitor' })).toBe('ws://[::1]:6080/monitor');
    expect(normalizePath(' /monitor ')).toBe('/monitor');
  });
});

describe('LiveClient', () => {
  const servers: ReplayServer[] = [];
  const clients: LiveClient[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) {
      c.disconnect();
    }
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  async function startServer(options: ReplayServerOptions = {}) {
    const server = new ReplayServer(records, { host: '127.0.0.1', interval: 20, ...options });
    servers.push(server);
    return { server, port: await server.listen() };
  }

  function startClient() {
    const log = { states: [] as LiveState[], games: [] as GameStore[], messages: [] as string[] };
    const client = new LiveClient({
      state: (s) => log.states.push(s),
      game: (g) => log.games.push(g),
      message: (m) => log.messages.push(m),
    });
    clients.push(client);
    return { client, ...log };
  }

  const target = (port: number, path = '/monitor') => ({ host: '127.0.0.1', port, path });

  it('receives a game, sends commands and says dispbye', async () => {
    const { server, port } = await startServer({ coach: false });
    const c = startClient();
    c.client.connect(target(port));
    expect(c.client.state).toBe('connecting');
    await expect.poll(() => c.games[0]?.frameCount ?? 0).toBeGreaterThan(3);
    expect(c.states).toEqual(['connecting', 'connected']);
    expect(c.messages).toEqual([
      `Connecting to ws://127.0.0.1:${port}/monitor ...`,
      `Connected to ws://127.0.0.1:${port}/monitor`,
    ]);
    expect(c.client.store).toBe(c.games[0]);
    expect(c.games[0]?.playerTypes).toHaveLength(18);

    expect(c.client.send('(dispstart)')).toBe(true);
    expect(c.client.send(`(${'x'.repeat(8191)})`)).toBe(false); // too long
    // Not in the coach mode: the server answers in a msg.
    c.client.send('(change_mode play_on)');
    await expect.poll(() => c.messages).toContain('(error illegal_command_form)');

    c.client.disconnect();
    expect(c.client.state).toBe('idle');
    expect(c.client.send('(dispstart)')).toBe(false);
    await expect
      .poll(() => server.commands.map((x) => x.text))
      .toEqual(['(dispstart)', '(change_mode play_on)', '(dispbye)']);
  });

  it('tells a refusal by the server', async () => {
    const { port } = await startServer({ maxMonitors: 1 });
    const a = startClient();
    a.client.connect(target(port));
    await expect.poll(() => a.client.state).toBe('connected');
    const b = startClient();
    b.client.connect(target(port));
    await expect.poll(() => b.client.state).toBe('idle');
    expect(b.messages).toContain('Connection refused by the server: (error no_more_monitor)');
    expect(b.games).toHaveLength(0);
  });

  it('tells a failure to connect', async () => {
    const { port } = await startServer();
    const c = startClient();
    c.client.connect(target(port, '/coach')); // 404
    await expect.poll(() => c.client.state).toBe('idle');
    expect(c.messages.at(-1)).toMatch(
      new RegExp(`^Failed to connect to ws://127\\.0\\.0\\.1:${port}/coach\\.`),
    );
  });

  it('disconnects after the timeout without data', async () => {
    const { server, port } = await startServer();
    const c = startClient();
    c.client.timeout = 300;
    c.client.connect(target(port));
    await expect.poll(() => c.client.state).toBe('connected');
    server.pause();
    await expect.poll(() => c.client.state, { timeout: 2000 }).toBe('idle');
    expect(c.messages.at(-1)).toBe('No response from the server.');
    // The socket was still open, so it said dispbye.
    await expect.poll(() => server.commands.map((x) => x.text)).toEqual(['(dispbye)']);
  });

  it('notices the server going away, and reconnects in the auto reconnect mode', async () => {
    const { server, port } = await startServer({ loop: true });
    const c = startClient();
    c.client.autoReconnect = true;
    c.client.reconnectDelay = 50;
    c.client.connect(target(port));
    await expect.poll(() => c.games.length).toBe(1);
    server.dropMonitors();
    await expect.poll(() => c.games.length).toBe(2);
    expect(c.states).toEqual(['connecting', 'connected', 'waiting', 'connecting', 'connected']);
    expect(c.messages).toContain('Disconnected from the server.');
    expect(c.games[1]).not.toBe(c.games[0]);

    // Without the auto reconnect mode, it stays disconnected.
    c.client.autoReconnect = false;
    server.dropMonitors();
    await expect.poll(() => c.client.state).toBe('idle');
  });

  it('stops reconnecting when the user disconnects', async () => {
    const { port } = await startServer();
    await servers.pop()?.close(); // nothing listens there now
    const c = startClient();
    c.client.autoReconnect = true;
    c.client.reconnectDelay = 20;
    c.client.connect(target(port));
    await expect.poll(() => c.states.filter((s) => s === 'waiting').length).toBeGreaterThan(1);
    c.client.disconnect();
    const count = c.states.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(c.client.state).toBe('idle');
    expect(c.states.length).toBe(count);
  });
});

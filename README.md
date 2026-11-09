# rcssmonitor-web

A browser-based monitor for the [RoboCup Soccer Simulator](https://github.com/rcsoccersim) 2D server (rcssserver).

**Status: early development (Phase 4).** Game logs can be opened (button, Ctrl+O or drag and drop) and played on a 2D field drawn like rcssmonitor, with rcssmonitor's player controls. Live games can be watched by connecting to rcssserver over WebSocket, with the referee commands of rcssmonitor (kick off, drop ball, free kicks, cards, play mode changes). The settings and the menus come next.

## Goals

- Watch live games by connecting to rcssserver over WebSocket using the JSON monitor protocol (`(dispinit version -1)`).
- Replay game logs (`.rcg` / `.rcg.gz`) in JSON and text (v4–v6) formats.
- Follow the features and look of [rcssmonitor](https://github.com/rcsoccersim/rcssmonitor) as closely as possible, including the referee controls.
- Add a 3D view later.

It is meant for servers on the same machine or the local network. It does not support connections over the Internet or TLS (`wss://`).

## Distribution (planned)

- **Single HTML file** attached to each release. Open it from disk (`file://`) to connect to a server anywhere on your LAN.
- **GitHub Pages**: for servers on `localhost` and for replaying logs. A page served over HTTPS cannot open plain `ws://` connections to other machines.

## Server requirements

A rcssserver build with WebSocket support (the asio-based 19.x series). The WebSocket port is disabled by default; enable it when starting the server:

```sh
rcssserver server::ws_port=6080
```

If `server::ws_allowed_origins` is set, it must include the origin of the page. A page opened from disk sends `Origin: null` (`"server::ws_allowed_origins='null'"`).

Changing the play mode from the monitor needs the coach mode (`server::coach=true` or `server::coach_w_referee=true`).

## Connecting

Use the connect button (host, port and path; the default is `localhost:6080/monitor`), or Ctrl+C to connect again to the last server. URL parameters connect at start-up, like rcssmonitor's command line options:

```
rcssmonitor-web.html?connect=1&host=192.168.0.10&port=6080&path=/monitor&auto_reconnect_mode=on&auto_reconnect_wait=5
```

While connected, the view follows the newest frame (live mode, Ctrl+L); step back to look at earlier frames. The referee commands are in the pop-up menu of the field (right click) and on the tool bar (kick off, Ctrl+K).

## Development

Requires Node.js 24 (see `.nvmrc`).

```sh
npm ci                # install dependencies
npm run dev           # start the development server
npm run build         # multi-file build for GitHub Pages (dist/)
npm run build:single  # single-file build (dist-single/rcssmonitor-web.html)
npm run lint          # ESLint
npm run format:check  # Prettier
npm run typecheck     # TypeScript
npm test              # unit tests (Vitest)
npx playwright install chromium firefox  # once, for the end-to-end tests
npm run test:e2e      # end-to-end tests on the single-file build (run build:single first)
npm run replay-server -- test/fixtures/json-sample.rcg.gz  # a stand-in server on port 6080
```

The replay server plays a game log to monitors as rcssserver does with `server::ws_port`, and prints the commands it receives. See [tools/replay-server/README.md](tools/replay-server/README.md).

See [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) (Japanese) for the plan, [docs/protocol.md](docs/protocol.md) for the protocol notes, and [docs/parity.md](docs/parity.md) for the feature comparison with rcssmonitor.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE). Parts of the drawing and log-parsing logic are ported from rcssmonitor, which is also licensed under the GPL.

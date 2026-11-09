# rcssmonitor-web

A browser-based monitor for the [RoboCup Soccer Simulator](https://github.com/rcsoccersim) 2D server (rcssserver).

**Status: early development (Phase 1).** Game logs can be loaded and summarized, but there is no field view yet.

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

If `server::ws_allowed_origins` is set, it must include the origin of the page. A page opened from disk sends `Origin: null`.

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
```

See [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) (Japanese) for the plan, [docs/protocol.md](docs/protocol.md) for the protocol notes, and [docs/parity.md](docs/parity.md) for the feature comparison with rcssmonitor.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE). Parts of the drawing and log-parsing logic are ported from rcssmonitor, which is also licensed under the GPL.

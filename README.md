# rcssmonitor-web

A browser-based monitor for the [RoboCup Soccer Simulator](https://github.com/rcsoccersim) 2D server (rcssserver).

It follows the features and the look of [rcssmonitor](https://github.com/rcsoccersim/rcssmonitor):

- Watch live games by connecting to rcssserver over WebSocket with the JSON monitor protocol (`(dispinit version -1)`), with rcssmonitor's referee commands (kick off, drop ball, free kicks, cards, play mode changes).
- Replay game logs (`.rcg` / `.rcg.gz`) in JSON and text (v4–v6) formats, with rcssmonitor's player controls.
- The 2D field drawn like rcssmonitor, its preference dialog (Show, Canvas, Color, Font), the player type list and its keyboard shortcuts.

A 3D view is planned. It is meant for servers on the same machine or the local network; connections over the Internet and TLS (`wss://`) are not supported.

## Getting it

> **Beta.** The current release is the pre-release 20.0.0-beta.1. The major version follows rcssserver: version 20 is the asio-based rcssserver, the first with WebSocket connections. The stable 20.0.0 will come when the repository moves to the [rcsoccersim](https://github.com/rcsoccersim) organization, and the GitHub Pages address will change then.

- **Single HTML file**: download `rcssmonitor-web-vX.Y.Z.html` from the [releases](https://github.com/hidehisaakiyama/rcssmonitor-web/releases) and open it from disk (`file://`). It replays logs and connects to servers anywhere on your LAN.
- **GitHub Pages**: https://hidehisaakiyama.github.io/rcssmonitor-web/ for replaying logs and for servers on `localhost`. A page served over HTTPS cannot open plain `ws://` connections to other machines.
- **Your own web server**: unpack `rcssmonitor-web-vX.Y.Z-dist.zip` from the releases.

It runs in current Chrome and Firefox. Settings are kept in the browser (localStorage).

## Server requirements

A rcssserver build with WebSocket support: the asio-based rcssserver, to be released as version 20 (its development builds report 19.0.0). The WebSocket port is disabled by default; enable it when starting the server:

```sh
rcssserver server::ws_port=6080
```

If `server::ws_allowed_origins` is set, it must include the origin of the page. A page opened from disk sends `Origin: null` (`"server::ws_allowed_origins='null'"`).

Changing the play mode from the monitor needs the coach mode (`server::coach=true` or `server::coach_w_referee=true`).

## Usage

- **Logs**: File > Open Game Log (Ctrl+O), the open button, or drop a file on the window.
- **Live**: Monitor > Connect to ... (host, port and path; the default is `localhost:6080/monitor`), or Monitor > Connect (Ctrl+C) to connect again to the last server. While connected, the view follows the newest frame (live mode, Ctrl+L); step back to look at earlier frames.
- **Referee**: the Referee menu, and the pop-up menu of the field (right click) for commands at a point. In 3D, a right click on a player aims at that player (for the cards) and its feet; on the ground, at the point on the pitch or its margin.
- **View**: View > Preference (Ctrl+V), View > Player Type List (Ctrl+H), Help > Shortcut Keys.
- **3D view**: View > 3D View (D), with six cameras under View > 3D Camera (E for the next one): free (drag to turn, Shift+drag to move, wheel to zoom), broadcast, top, behind either goal, and the selected player's. It needs WebGL. The overlays of the Show tab are drawn on the ground as in 2D (the focus point, the catch, tackle and kick areas, pointto, the offside lines, the ball's path, the player types), but not the stamina. The player camera looks over the player's shoulder, turns smoothly with its face and draws only what rcssserver tells the player; the Player Camera tab of View > Preference sets other styles (e.g. at the eyes, or drawing everything). The goal nets, the boards around the pitch and the banners floating behind the goals are in the team colors (the boards and the banners can be hidden), and a compass and a minimap can be shown (the 3D tab of View > Preference).

URL parameters stand in for rcssmonitor's command line options, with the same names (also written with `-`). For example:

```
rcssmonitor-web.html?connect=1&server_host=192.168.0.10&server_port=6080&auto_reconnect_mode=on
rcssmonitor-web.html?show_view_area=on&show-offside-line=on&grid_step=10&field_brush=1fa01f&timer_interval=50
```

Values given in the URL apply to that page; they are not saved unless changed afterwards. See [docs/parity.md](docs/parity.md) for the full list and for how each rcssmonitor feature and key is handled.

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

See [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) (Japanese) for the plan, [docs/protocol.md](docs/protocol.md) for the protocol notes, [docs/parity.md](docs/parity.md) for the feature comparison with rcssmonitor, and [docs/release.md](docs/release.md) for making a release.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE). Parts of the drawing and log-parsing logic are ported from rcssmonitor, which is also licensed under the GPL.

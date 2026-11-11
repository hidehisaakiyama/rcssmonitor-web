# rcssmonitor-web

A browser-based monitor for the [RoboCup Soccer Simulator](https://github.com/rcsoccersim) 2D server (rcssserver).

It follows the features and the look of [rcssmonitor](https://github.com/rcsoccersim/rcssmonitor):

- Watch live games by connecting to rcssserver over WebSocket with the JSON monitor protocol (`(dispinit version -1)`), with rcssmonitor's referee commands (kick off, drop ball, free kicks, cards, play mode changes).
- Replay game logs (`.rcg` / `.rcg.gz`) in JSON and text (v4–v6) formats, with rcssmonitor's player controls.
- The 2D field drawn like rcssmonitor, its preference dialog (Show, Canvas, Color, Font), the player type list and its keyboard shortcuts.

It adds a 3D view of the game (not in rcssmonitor): cameras from the broadcast angle to the selected player's eyes, the overlays of the 2D view, human figures, and more (see below).

It is meant for servers on the same machine or the local network; connections over the Internet and TLS (`wss://`) are not supported.

## Getting it

> **Beta.** The current release is the pre-release 20.0.0-beta.3. The major version follows rcssserver: version 20 is the asio-based rcssserver, the first with WebSocket connections. The stable 20.0.0 will come when the repository moves to the [rcsoccersim](https://github.com/rcsoccersim) organization, and the GitHub Pages address will change then.

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

- **Logs**: File > Open Game Log (Ctrl+O), the open button, or drop a file on the window. File > Open Game Log from URL downloads a log from the web and opens it; so does the URL parameter `log` (below). The server of the log must let other sites read it (CORS), and a page served over HTTPS cannot read `http://` URLs other than `localhost`. Files in public GitHub repositories can be given by their page (`https://github.com/OWNER/REPO/blob/BRANCH/PATH`) or raw link; they are read from `raw.githubusercontent.com`, or from `media.githubusercontent.com` if stored with Git LFS. When the log cannot be read, the status bar offers a link to download it; open the saved file.
- **Live**: Monitor > Connect to ... (host, port and path; the default is `localhost:6080/monitor`), or Monitor > Connect (Ctrl+C) to connect again to the last server. While connected, the view follows the newest frame (live mode, Ctrl+L); step back to look at earlier frames.
- **Referee**: the Referee menu, and the pop-up menu of the field (right click) for commands at a point. In 3D, a right click on a player aims at that player (for the cards) and its feet; on the ground, at the point on the pitch or its margin.
- **View**: View > Preference (Ctrl+V), View > Player Type List (Ctrl+H), Help > Shortcut Keys.
- **3D view**: View > 3D View (D), with eight cameras under View > 3D Camera (E for the next one): free (drag to turn, Shift+drag to move, wheel to zoom), broadcast, two close-ups that follow the ball or the selected player from nearer (12 m by default; the wheel or the 3D tab of View > Preference changes the distance, and the tab the elevation), top, behind either goal, and the selected player's. I puts the free camera where it sees the whole pitch from the side, Ctrl+I at the next of nine viewpoints of the whole pitch (from the far side, behind either goal, high above, the four corners; also in View > 3D Camera and the tool bar). It needs WebGL. As in 2D, lines in the circle on the ground show each player's body and face directions, and the overlays of the Show tab are drawn on the ground (the focus point, the catch, tackle and kick areas, pointto, the offside lines, the ball's path, the player types), and the stamina and its capacity are bars above the heads. The player camera looks over the player's shoulder, turns smoothly with its face and draws only what rcssserver tells the player; the Player Camera tab of View > Preference sets other styles (e.g. at the eyes, or drawing everything). The goal nets, the boards around the pitch and the banners floating behind the goals are in the team colors (the boards and the banners can be hidden), and a compass and a minimap can be shown (the 3D tab of View > Preference). The players and the goals cast shadows from the sun (the 3D tab: Shadows; not from the top camera). The grass is mowed in stripes, a sky and simple stands along the touch lines surround the pitch, and the ball has the pentagons of a football and rolls (each can be hidden in the 3D tab). To find a small ball, a ring on the ground (0.7 m by default) and a trail like a contrail over its last cycles go with it (the 3D tab: Ball). The players can be drawn as human figures (the CC0 Mannequin by Quaternius) that walk, run, kick, tackle, catch and fall when fouled by the log (also when stepping back) (the 3D tab: Players).

URL parameters stand in for rcssmonitor's command line options, with the same names (also written with `-`). For example:

```
rcssmonitor-web.html?connect=1&server_host=192.168.0.10&server_port=6080&auto_reconnect_mode=on
rcssmonitor-web.html?show_view_area=on&show-offside-line=on&grid_step=10&field_brush=1fa01f&timer_interval=50
https://hidehisaakiyama.github.io/rcssmonitor-web/?log=https://example.org/logs/game.rcg.gz
```

`log` opens the log at that URL, as a log file on rcssmonitor's command line does (it comes before `connect`). A link with it shows a game in one click. Escape `&`, `#` and `+` in the log's URL (`encodeURIComponent`).

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

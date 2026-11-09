# rcssmonitor-web 開発計画

| 項目 | 内容 |
|---|---|
| 作成日 | 2026-11-07 |
| 対象 | 新規プロジェクト rcssmonitor-web (`/home/akiyama/work/src/rcsoccersim/rcssmonitor-web`, GitHub では `rcsoccersim/rcssmonitor-web` を想定) |
| 参照したソース | rcssmonitor (feature/support-tcp-ws), `rcssserver-19.x-asio/` (asio 版 rcssserver 19.x の作業ツリー) |
| ライセンス | GPL-3.0-or-later (rcssmonitor の描画・rcg 解析ロジックを移植するため) |

## 1. 背景と目的

asio 版 rcssserver が TCP / WebSocket での接続に対応し、rcssmonitor もそれに合わせて改修した。WebSocket が使えるようになったことで、インストール不要でブラウザから使えるモニタを提供できる。

- rcssmonitor (Qt/C++) とはコードを共有しない別プロジェクトとして、ブラウザ版モニタを新規に開発する。
- 機能は rcssmonitor になるべく準拠する。ライブ観戦、ログ再生、審判操作、表示設定を含む。
- 運用は localhost か LAN 内のサーバへの接続を想定する。インターネット越しの接続や TLS (`wss://`) は対象外。
- 将来 3D 表示を加える。そのため、試合状態・再生・描画を分離し、2D と 3D が同じモデルを共有できる構成にする。

## 2. 決定事項

| 項目 | 決定 |
|---|---|
| 言語・ビルド | TypeScript (strict) + Vite。Node.js 24 LTS、npm |
| UI | フレームワークなし (素の TypeScript + DOM、ダイアログは `<dialog>`) |
| 2D 描画 | Canvas 2D。rcssmonitor の描画を忠実に移植する |
| 3D 描画 | Three.js (Phase 6)。動的 import で別チャンクにする |
| ライブ接続 | WebSocket + JSON モニタプロトコル (`(dispinit version -1)`) のみ |
| ログ形式 | JSON rcg とテキスト rcg v4〜v6 (gzip 可)。バイナリ v1〜v3 は対象外 |
| 配布 | (a) file:// で開ける単一 HTML をリリースに添付 (LAN 接続用)<br>(b) GitHub Pages (localhost 接続とログ再生用) |
| テスト | Vitest (単体)、Playwright (E2E、Chromium と Firefox) |

## 3. 設計に効くサーバ側の仕様

調査結果のうち、設計を左右するものだけを挙げる。詳細は Phase 0 で `docs/protocol.md` にまとめる。

**接続と配信順**
- 接続先は `ws://host:ws_port/monitor`。`server::ws_port` の既定値は 0 (無効) なので、サーバ起動時に指定が必要。
- 接続後 10 秒以内に `(dispinit version -1)` を送る。
- その後の受信順は `server_param` → `player_param` → `player_type` (タイプ数ぶん) → 毎サイクルの `show`。`team_graphic` は `show` の直後に届き、`msg` は随時届く。
- 「接続成功」を示す応答はない。最初の JSON フレームが `server_param` になる。

**エラー応答**
- エラーは JSON ではなく S 式のテキストで届く (`(error no_more_monitor)` など)。先頭が `{` でないフレームはエラーとして扱う。
- サーバ側から切断したときは close フレームが送られないので、close コードは 1006 になる。

**ライブの show とログの show の違い**
- ライブの `show` は `mode` と `team` を含む。`playmode` / `team` メッセージは単独では届かない。
- ログの `show` は `mode` / `team` を含まないので、直前の `playmode` / `team` レコードの値を使う。
- ライブの `show` にはコマンド回数がなく、`fdist` / `fdir` がある。ログの `show` はその逆。

**時刻**
- `stime` は 0 より大きいときだけ含まれる。フレームの順序は `(time, stime)` で決める。
- テキスト rcg には `stime` がない。同じ `time` の `show` が繰り返されるので、その回数から `stime` を推定する。

**選手データ**
- `players` は常に 22 要素ある。接続していない選手も `state: 0` で含まれる。
- 状態ビット、PlayMode の文字列表、Side の値は `rcssserver-19.x-asio/src/types.h` と `rcss/rcg/types.h` に従う。

**審判コマンド**
- `(dispstart)`。
- `(dispfoul X Y SIDE)`: X と Y はメートルを 16 倍して丸めた整数。SIDE は 1 / -1 / 0 (0 はドロップボール)。
- `(dispcard SIDE UNUM yellow|red)`。
- `(change_mode ...)` と `(move (ball) ...)` は、サーバが `coach` または `coach_w_referee` で動いているときだけ受け付けられる。
- サーバへ送るメッセージは 8191 バイト以内にする。

**Origin 検査**
- `server::ws_allowed_origins` が空 (既定) なら、すべての Origin を受け付ける。
- 設定されている場合、file:// のページが送る Origin `null` を許可リストに含める必要がある (Chrome 157、Firefox 157 で確認)。

**JSON rcg のファイル形式**
- `[` で始まり、レコードを 1 行 1 つで並べ、`,\n` で区切る。
- サーバが異常終了すると、末尾の `]` が欠ける。

## 4. アーキテクチャ

### 4.1 ディレクトリ構成

```
rcssmonitor-web/
  index.html
  src/
    main.ts               起動。URL パラメータを読み、各部を結線する
    core/                 DOM / Canvas に依存しない層。Worker、Node、テストからも使う
      constants.ts        PlayMode、状態ビット、Side、フィールド寸法 (105×68 など)
      params.ts           ServerParam / PlayerParam / PlayerType (既定値表 + Record)
      frame.ts            Frame / Ball / Player の型と述語 (isKicking、isCollided など)
      game-store.ts       フレーム列、得点変化 index、PK 履歴、チームグラフィック、パラメータ
      team-graphic.ts     XPM タイル (8×8、最大 256×64) の組み立て
      geometry.ts         Vec2、角度、直線、円 (player_painter が使う計算)
    io/
      load.ts             gzip の判定と展開 (1f 8b → DecompressionStream)、形式判定
      rcg-json.ts         JSON rcg の行単位パーサ
      rcg-text.ts         テキスト v4〜v6 パーサ (parser_v4.cpp の移植)
      rcg.worker.ts       解析 Worker。進捗とフレームをまとめて送る
      live/
        connection.ts     WebSocket、dispinit、エラー応答、無通信タイムアウト、自動再接続
        protocol.ts       ライブ JSON メッセージを GameStore に入れる
        commands.ts       審判コマンドの組み立てと検証
    playback/
      playback.ts         現在位置、ライブモード、速度、ループ、得点ジャンプ、補間用の連続時刻
    view/
      view-state.ts       表示トグル、選手選択、フォーカス、ズーム
      renderer.ts         FieldRenderer インタフェース
      hud/                スコアボードとチームロゴ (2D / 3D 共通のオーバーレイ)
      render2d/           viewport、field、player、ball、offside、measure
      render3d/           Phase 6
    ui/                   メニュー、ツールバー、スライダー、ステータスバー、ショートカット、dialogs/
    options/              設定項目の定義、localStorage への保存、URL パラメータ
  tools/replay-server/    開発・CI 用の擬似サーバ (Node + ws)。rcg をライブの JSON プロトコルで流す
  test/unit, test/e2e, test/fixtures
  docs/DEVELOPMENT_PLAN.md (本書), docs/protocol.md, docs/parity.md
```

**依存の規則**: `core/` と `io/` は DOM や Canvas を参照しない。ESLint の import 制限で強制する。こうしておくと、パーサを Worker、擬似サーバ、単体テストで共有できる。

### 4.2 データモデル

```ts
interface Frame {
  time: number; stime: number;
  mode: PlayMode;
  teams: [TeamInfo, TeamInfo];          // name, score, penScore, penMiss (PK の値。届かなければ 0)
  ball: { x: number; y: number; vx: number; vy: number };
  players: PlayerState[];               // 22 要素。左 unum-1、右 11+unum-1 の位置に置く
}
```

- `PlayerState` の任意項目は C++ 版のような番兵値ではなく `undefined` で表す。対象は `point`、`focusPoint`、`capacity`、`attention`、`counts`。
- フレームはまず素のオブジェクトで持つ。全長のログ (約 6,200 フレーム) でメモリを測り、300 MB を超えるようなら struct-of-arrays に切り替える。
- rcssmonitor にある 65,535 フレームの上限は設けない。この上限があるとライブ表示が止まる。
- `GameStore` は追記専用にする。ライブ受信とログ読み込みで同じ API を使う。

### 4.3 再生と時間 (3D を見越した設計)

- `Playback` は「整数のフレーム位置」に加えて「連続時刻 (位置 + 補間係数 α)」を返す。
- 2D は α を使わず、rcssmonitor と同じく離散的に表示する。3D は前後のフレームを補間する。
- 再生は rAF ループの中で経過時間からフレームを進める。これで最短 5 ms 間隔の高速再生にも対応できる。
- ライブモードでは受信のたびに最新フレームへ移る。3D では 1 サイクル遅らせて補間する。

### 4.4 描画

```ts
interface FieldRenderer {
  mount(container: HTMLElement): void;
  resize(width: number, height: number): void;
  render(scene: SceneSnapshot): void;   // frame, next, alpha, params, types, viewState
  screenToField(x: number, y: number): Vec2 | null;  // 審判操作と計測に使う
  dispose(): void;
}
```

- `Render2D` が rcssmonitor の painter 群を移植したもの。`Render3D` は Phase 6 で追加する。
- スコアボードとチームロゴは HUD レイヤに分ける。両方のレンダラで使い、2D ではロゴ帯とスコアボードのぶんだけ描画領域を空ける。
- 座標系は x が右、y が下 (画面と同じ)、角度は画面上で時計回り。3D では (x, y) を Three.js の (X, Z) に対応させる。

### 4.5 設定

- 項目名は rcssmonitor の設定名とコマンドラインオプションに合わせる (`show_player_number` など)。
- localStorage に保存する。読み書きはすべて try/catch で包み、file:// や保存できない環境でも既定値で動くようにする。
- URL パラメータがコマンドラインオプションの代わりになる。例: `?connect=1&host=192.168.0.10&port=6002&path=/monitor&show_view_area=1`。
- Pages 版の既定の接続先は `localhost` にする。

### 4.6 配布ビルド

| 出力 | 中身 | 用途 |
|---|---|---|
| `dist/` | 分割ビルド。Three.js は別チャンク | GitHub Pages |
| `dist-single/rcssmonitor-web.html` | vite-plugin-singlefile で 1 ファイルにまとめる。Worker は classic 形式 (IIFE) でインライン化する (Chrome は file:// で module Worker を起動しない) | file:// で開いて LAN 接続 |

- タグを付けると GitHub Actions が単一 HTML と `dist` の zip をリリースに添付し、Pages を更新する。

## 5. フェーズ計画

各フェーズの終わりに、`docs/parity.md` (rcssmonitor との機能対応表) の状態を更新する。

### Phase 0: 基盤と制約の検証

**作業**
- リポジトリを作る (`LICENSE` は GPL-3.0、`README.md` は英語)。
- Vite + TypeScript (strict)、ESLint + Prettier、Vitest、Playwright を入れる。
- GitHub Actions を用意する (lint、型検査、単体テスト、2 種類のビルド)。
- 調査結果を `docs/protocol.md` に、機能一覧を `docs/parity.md` に書く。
- テスト用の小さなフィクスチャを作る。素材は既存の 2 本のログで、ヘッダ、序盤 200 サイクル、得点の前後、`stime` が進む区間を含める。全長のログはコミットせず、ローカルの性能試験に使う。PK 戦はどちらのログにもないので、Phase 1 で合成する。
- 検証用ページで次を確かめる。
  - file:// で開いた単一 HTML から、`ws://localhost` と `ws://<LAN の IP>` に接続できるか。
  - file:// の単一 HTML で、インライン Worker、DecompressionStream、localStorage が動くか。
  - file:// から接続したときに送られる Origin の値。サーバの stderr のログで確認する。
  - https のページから `ws://localhost` に接続できるか (Chrome、Firefox。可能なら Safari も)。Chrome の Local Network Access の許可プロンプトが出るかどうかも見る。

**完了条件**: CI が通る。検証の結果を `docs/protocol.md` に記録し、配布方式の前提が成り立つことを確認できている。

### Phase 1: データモデルとログ読み込み

**作業**
- `core/` 一式 (定数、パラメータの既定値表、Frame、GameStore、チームグラフィックの組み立て)。
- JSON rcg パーサ。行単位で読み、末尾の `]` 欠けを許容する。未知のキーはエラーにせず読み飛ばす。
- テキスト rcg v4〜v6 パーサ。`rcss/rcg/parser_v4.cpp` を移植する。注意点は次のとおり。
  - 状態値は 16 進数で書かれている。
  - `px py` は省略されることがあり、有無は位置で判断する。
  - コマンド回数は 11 個の場合と 12 個の場合がある。
  - チームグラフィックは msg 行に入っていて、引用符の入れ子がある。
  - `stime` は同じ time の繰り返し回数から推定する。
- gzip の判定と展開、Worker での解析 (進捗表示つき)。
- 得点変化 index と PK 履歴の作成。`src/disp_holder.cpp` の処理を移植する。

**完了条件**: 両フィクスチャの単体テストが通る (フレーム数、特定フレームの値、PlayMode の並び、得点変化の位置、ロゴの寸法)。全長ログ 2 本を 3 秒程度で読み込める。

### Phase 2: 2D 描画

**作業**
- viewport: 拡大縮小 (×1.5 刻み、1〜400 px/m)、全体表示 (I)、ダブルクリックでの中心移動、ドラッグでの移動、フォーカス (ボール / 選択選手 / 固定)。
- フィールド (`src/field_painter.cpp`): ライン、ゴール、フラグ、グリッド、keepaway 領域。
- 選手 (`src/player_painter.cpp`):
  - 外円と体の円、状態に応じた色 (kick、tackle、catch、collision、foul、card、illegal defense)。
  - スタミナの濃淡、effort / recovery の輪。
  - 体の向きと首の向き、視野 (選択選手は 20 / 40 / 60 m の弧)、フォーカス点。
  - キャッチ範囲、タックル範囲と確率、キック加速範囲、pointto、ラベル。
- ボール、ボールの予測軌道、オフサイドライン、計測ツール (中ボタンでのドラッグ。Shift+ドラッグでも使えるようにする)。
- HUD: スコアボード (書式と PK の o/x 表示は `src/score_board_painter.cpp` に合わせる)、チームロゴ。
- 選手選択: 1〜0、- / Ctrl+数字、A / L / R / U。

**完了条件**: 同じフレームを rcssmonitor と並べて見比べ、差がない。Playwright のスクリーンショット回帰テストを作る。

### Phase 3: ログプレイヤー

**作業**
- ファイルを開く (Ctrl+O、ドラッグ＆ドロップ、ファイル選択)。
- 再生と停止 (Space)、1 フレーム送りと戻し (←、→、ホイール)、速度変更 (Ctrl+↑ / ↓、5〜5000 ms)。
- 前後の得点へジャンプ (G / Ctrl+G、50 フレーム手前に移動)、先頭と末尾 (Home / End)、ループ再生。
- フレーム位置のスライダー、ツールバー。
- rcssmonitor では UI のないサイクル指定ジャンプも、入力欄を付けて提供する。

**完了条件**: 再生、スライダー操作、得点ジャンプの E2E テストが通る。

### Phase 4: ライブ接続と審判操作

**作業**
- 接続と切断。
  - 接続ダイアログ (host、port、path)、Ctrl+C での既定の接続先への接続、切断時の `(dispbye)`。
  - エラー応答 (`(error ...)`) を表示する。
  - 5 秒間データが届かなければ切断する。自動再接続 (待ち時間は設定可能) も用意する。
- ライブモード (Ctrl+L)。ライブ中も過去のフレームへ戻って見られるようにする。
- 審判操作。
  - Kick Off (Ctrl+K)。
  - 右クリックメニュー: Drop Ball、Free Kick Left / Right、Yellow / Red Card、Change Playmode。
  - Change Playmode では `src/main_window.cpp` と同じくモードに応じてボール位置を補正する。サーバが coach モードでなければ実行しない。
  - カードは unum が 1〜11 かを送信前に検証する (サーバ側に範囲検査がないため)。
- `tools/replay-server`。
  - rcg を読み、`server_param` → `player_param` → `player_type` → `show` (`mode` / `team` を埋め込む) の順にライブ形式で配信する。
  - 受信したコマンドを記録する。CI の E2E テストで使う。
- `msg` で届く `(error ...)` / `(warning ...)` を、ステータスバーに短く表示する。

**完了条件**
- 擬似サーバに対する E2E テストが通る (接続、受信、ライブ追従、切断、コマンド送信)。
- 実際の asio 版 rcssserver に対する手動試験が通る (§7)。

### Phase 5: 設定・ダイアログ・初回リリース (v1.0)

**作業**
- 設定ダイアログ。rcssmonitor と同じ 4 タブ (Show、Canvas、Color、Font)。色 35 項目、フォント 3 種類。
- 選手タイプ一覧 (16 列、列ごとに並べ替え)、ショートカット一覧、About。
- メニューバー、ツールバー、ステータスバーの表示切替、全画面 (F11 は Fullscreen API で扱う)。
- キー割り当ての互換表。ブラウザが予約していて横取りできないキー (Ctrl+N / T / W など) は代わりのキーを決め、`docs/parity.md` に書く。
- Qt 固有の機能 (Window Style、About Qt、終了、auto quit) は対象外にする。
- リリース手順を整える (単一 HTML、zip、Pages)。

**完了条件**: `docs/parity.md` の対象項目がすべて「済」になる。v1.0 のタグを付け、成果物がリリースに添付される。

### Phase 6: 3D 表示

**作業**
- Three.js を動的 import する。`FieldRenderer` を実装し、2D と 3D を切り替えられるようにする。
- フィールドは、2D の field painter を OffscreenCanvas に描いてテクスチャとして使う。
- 選手は簡易モデル (円柱またはカプセル + 背番号スプライト) をインスタンス描画する。体と首の向き、状態の強調、視野コーンを表す。
- ボールは球で、地面に置く (2D シミュレーションには高さの情報がない)。
- 補間: 位置は線形、角度は最短の回り方向で補う。PlayMode の切替や大きな瞬間移動の前後では補間しない。
- カメラ: 真上 (正射影)、中継風 (ボールを滑らかに追う)、ゴール裏、選手視点 (body+neck、視野幅)、自由視点 (OrbitControls)。
- 審判操作は、レイを地面に当てて座標を求めることで 3D でも使えるようにする。HUD は 2D と共通。
- 人型モデルとアニメーション (glTF) は、ライセンスを確認したうえで後から加える。

**完了条件**: 1920×1080 で 60 fps を保てる。2D と 3D を切り替えても選択状態や再生位置が保たれる。

### 将来の拡張 (rcssmonitor にない機能。v1.0 の対象外)

- ドラッグで選手を移動する (`(dispplayer SIDE UNUM X Y ANG)`。ANG は 16 倍せず整数の度で送る)。
- ボールや選手の軌跡表示、msg の一覧パネル、`stime` の表示。
- バイナリ rcg (v1〜v3)、URL を指定してログを開く機能 (`?log=`)。
- rcssserver 自身による静的ファイル配信 (同じオリジンになり、Origin や mixed content の問題がなくなる)。

## 6. 移植時に直す rcssmonitor の不具合 (rcssmonitor 側にも Issue として報告する)

| 不具合 | 場所 |
|---|---|
| 65,535 フレームを超えるとライブ表示が止まる | `src/disp_holder.cpp:65,249` |
| JSON パーサで view quality が bool として扱われる | `rcss/rcg/parser_simdjson.cpp:478` |
| JSON の未知のキーで解析全体が中断する | `rcss/rcg/parser_simdjson.cpp:85-164` |
| `foul_push_r` が PM_Null に対応づけられる | `rcss/rcg/util.cpp:854-855` |
| Change Playmode の back_pass を選んでも何も送られない | `src/main_window.cpp:2394-2429` |
| 設定ダイアログの "Fix" が Auto-right になる | `src/config_dialog.cpp:2441` |
| Illegal Defense の色の初期値が Pointto の色になる | `src/config_dialog.cpp:1258-1260` |
| テキスト rcg のチームグラフィックで 15 文字を超える文字列が壊れる | `rcss/rcg/parser_v4.cpp:625-709` |
| オフサイドラインが x = 0 とボールの間にしか引かれない (選手の side の文字を列挙値 `LEFT` / `RIGHT` と比べている) | `src/player_painter.cpp:1034,1061` |
| 左のキーパーのキャッチ範囲に右のキーパーの色を使う (同じ比較の誤り) | `src/player_painter.cpp:545,563` |

asio 版サーバで見つかった問題 (サーバ側で対応を検討する):

- `dispcard` / `dispdiscard` の unum に範囲検査がない (`stadium.cpp:1131-1153`)。
- `change_player_type` の比較文字列に括弧が欠けていて、到達できない (`monitor.cpp:392`)。
- JSON 文字列のエスケープが `"` と `\` だけで、制御文字が入ると不正な JSON になる。

## 7. 検証方法

**単体テスト (Vitest、CI で実行)**
- パーサ: フィクスチャのフレーム数、特定フレームの値、PlayMode の並び、得点変化の位置、チームグラフィックの寸法。
- 全長ログのテストはファイルがあるときだけ実行する。JSON は show 6,209 件、テキストは `(show` 行の数と一致することを確かめる。
- 審判コマンドの文字列 (16 倍の丸め、side の符号、unum の検証)、change_mode のボール位置補正。

**E2E テスト (Playwright、Chromium と Firefox、CI で実行)**
- ログ読み込み → 再生 → スライダー → 得点ジャンプ → スクリーンショット比較。
- 擬似サーバに接続 → フレームが進む → ライブ追従 → 審判コマンドが擬似サーバに届く → 切断。

**手動試験 (各フェーズの終わり)**
- `rcssserver server::ws_port=6080 server::coach_w_referee=true` で起動したサーバに、2 チームを接続して確かめる。
  - 同じサーバに Qt 版 rcssmonitor (`--server-transport ws`) も接続し、表示を並べて比べる。
  - LAN 内の別マシンから、file:// で開いた単一 HTML で接続する。
  - Pages 版から localhost に接続する。
- `ws_allowed_origins` を設定した状態で、拒否されたときの表示と、許可したときの接続を確かめる。

**性能**: 全長ログを 3 秒程度で読み込める。再生中、2D は 60 fps を保てる。ログを読み込んだ後のメモリ使用量を記録する。

## 8. 承認後に行うこと (Phase 0 の着手)

1. `/home/akiyama/work/src/rcsoccersim/rcssmonitor-web` を作り、`git init` する (既定ブランチは main)。本書を `docs/DEVELOPMENT_PLAN.md` として置く。
2. Node.js を用意する。現在の shell では `node` が見つからないので、nvm などの有無を確認し、導入が必要な場合は先に相談する。
3. 雛形を作る: `package.json`、`tsconfig.json`、`vite.config.ts` (2 種類のビルド)、ESLint、Prettier、Vitest、Playwright、`LICENSE` (GPL-3.0)、`README.md`、CI のワークフロー。
4. `docs/protocol.md` と `docs/parity.md` の初版を書き、フィクスチャを作る。
5. 制約を確かめる検証用ページを作り、ローカルで確認できる範囲 (file://、localhost、Worker、DecompressionStream) を確かめる。LAN の別マシンや Safari での確認は、手順を書いてユーザに依頼する。
6. 最初のコミットと GitHub へのリポジトリ作成は、内容を確認してもらってから行う。

## 9. フェーズの結果

### Phase 1 (2026-11-09)

**完了条件の確認**
- 単体テスト 103 件 (両フィクスチャのフレーム数、特定フレームの値、PlayMode の並び、得点変化の位置、ロゴの寸法、PK 履歴を含む) と E2E テストが通る。
- 全長ログ 2 本を読み込める。show の件数は JSON 6,209、テキスト 8,406 で、ファイルの件数と一致する。

| 計測 | JSON (6,209 フレーム) | テキスト v5 (8,406 フレーム) |
|---|---|---|
| Node (解析のみ) | 334 ms | 350 ms |
| Chromium (単一 HTML、Worker 経由) | 312 ms | 499 ms |
| Firefox (単一 HTML、Worker 経由) | 514 ms | 648 ms |
| 読み込み後のヒープ増加 (Node) | 72 MB | 100 MB |

メモリが 300 MB を大きく下回るので、フレームは素のオブジェクトのままにする (§4.2)。

**計画からの変更と、実装で決めたこと**
- パーサは `RcgRecord` (素のオブジェクト) を出し、`GameStore.apply()` がそれを適用する。Worker はレコードを show 200 件ごとにまとめて送る。ライブ受信 (Phase 4) も同じレコードを使う。
- `GameStore.scoreChanges` は、得点が前のフレームと変わった最初のフレームを指す。rcssmonitor はその 1 つ前のフレームを記録している。PK 履歴は rcssmonitor と同じく、プレイモードの変化で記録する。
- パラメータの既定値表は、rcssmonitor の表ではなく、asio 版 rcssserver 19.0.0 が実際に送る値から作った (rcssmonitor の表は約 40 項目が古い)。
- テキスト rcg の `stime` は、同じ cycle の show 行の出現順 (0 から) で推定する。
- 不正な行は飛ばして警告にし、読み込みを続ける。
- PK 戦のフィクスチャを JSON とテキストの両方で合成した。ライブの JSON メッセージのフィクスチャも、実際のサーバから取得して加えた。
- 読み込みの画面は仮のもの (要約の表示のみ)。フィールドの描画は Phase 2、ファイルを開く操作の仕上げは Phase 3 で行う。

### Phase 2 (2026-11-09)

**完了条件の確認**
- rcssmonitor と同じフレームを、同じ大きさのキャンバスで描いて比べた。比べたのは 7 場面で、既定の表示、表示を多数有効にした状態、カード、拡大とボール追従、グリッドと keepaway、テキストログの得点、PK のスコアボード。
  - 拡大率と中心は画素単位で一致した。残る違いは、フォントの字形、円弧の端の 1 画素、HUD の重なりの順、rcssmonitor の不具合を直した部分 (オフサイドライン、キャッチ範囲の色) だけ。
  - 手順と結果は `tools/parity/README.md` に書いた。rcssmonitor は Qt の VNC プラグインで画面なしに動かし、VNC で画面を取得する。`HOME` を一時ディレクトリにするので、利用者の `~/.rcssmonitor.conf` には触れない。
- Playwright のスクリーンショット回帰テストを 7 枚 (Chromium と Firefox) 作った。文字は同梱した DejaVu Sans の ASCII 部分集合で描き、環境に依存しないようにした。マウスとキー操作の E2E テストも加えた。

**計画からの変更と、実装で決めたこと**
- `QtPainter` (`src/view/render2d/qt-painter.ts`) で QPainter の描き方を再現し、painter を 1 呼び出しずつ移植した。
  - 座標は整数。Qt と同じく、角度は 1/16 度で反時計回りに数える。
  - アンチエイリアスなしの円と円弧は、Canvas では描けないので 1 画素ずつ描く。
- フォントの寸法は、rcssmonitor の実測に合わせて丸める。ポイントからの換算は整数に丸め、ascent は切り捨て、descent は切り上げ。
- HUD (スコアボード、ロゴ、計測ツール) は、フィールドのキャンバスに重ねた別のキャンバスに描く。
- ログプレイヤー (Phase 3) の前でもフレームを見られるよう、仮のスライダーと ← / → / Home / End を付けた。
- E2E テストとデバッグのために、`window.rcssmonitorWeb` に表示状態と操作の入口を置いた。

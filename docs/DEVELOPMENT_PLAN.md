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
| 版番号 | メジャーを rcssserver にそろえ、対応するサーバ (プロトコル) を示す。asio 版の rcssserver は 20 として出る予定なので 20。正式版の前のベータは `20.0.0-beta.N` (2026-11-09 に決定) |
| ブランチ | `main` はリリースした状態でタグを付ける。`develop` に開発を集め、機能は `feature/*`、リリース済みの版の急ぎの修正は `hotfix/*` で行う (`docs/release.md`。2026-11-09 に決定) |

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
        client.ts         WebSocket、dispinit、エラー応答、無通信タイムアウト、自動再接続
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
  ball: { x: number; y: number; vx: number; vy: number;
          z?: number; vz?: number };      // 高さと鉛直方向の速度 (Phase 6。2.5 次元シミュレータ用)
  players: PlayerState[];               // 22 要素。左 unum-1、右 11+unum-1 の位置に置く
}
```

- `PlayerState` の任意項目は C++ 版のような番兵値ではなく `undefined` で表す。対象は `point`、`focusPoint`、`capacity`、`attention`、`counts`。
- ボールの `z` と `vz` も任意項目で、今のサーバとログにはない (ボールは地面の上)。ボールが空中を飛ぶ 2.5 次元シミュレータ (rcssserver で計画中) に備えて Phase 6 で加える。単位はメートルと m/サイクルで、上が正。JSON のキー名は仮に `ball.z` / `ball.vz` とし、サーバの形式が決まったら合わせる。
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
- 座標系は x が右、y が下 (画面と同じ)、角度は画面上で時計回り。3D では (x, y) を Three.js の (X, Z) に対応させ、ボールの高さ z を Y にする。

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

### Phase 5: 設定・ダイアログ・リリースの準備

**作業**
- 設定ダイアログ。rcssmonitor と同じ 4 タブ (Show、Canvas、Color、Font)。色 35 項目、フォント 3 種類。
- 選手タイプ一覧 (16 列、列ごとに並べ替え)、ショートカット一覧、About。
- メニューバー、ツールバー、ステータスバーの表示切替、全画面 (F11 は Fullscreen API で扱う)。
- キー割り当ての互換表。ブラウザが予約していて横取りできないキー (Ctrl+N / T / W など) は代わりのキーを決め、`docs/parity.md` に書く。
- Qt 固有の機能 (Window Style、About Qt、終了、auto quit) は対象外にする。
- リリース手順を整える (単一 HTML、zip、Pages)。

**完了条件**: `docs/parity.md` の対象項目がすべて「済」か「対象外」になる。リリースのワークフローと手順がそろう。

### プレリリース 20.0.0-beta.1 (個人リポジトリ)

タグの push で公開され、取り消しが利かないので、Phase 5 から分けた。まず個人リポジトリでベータとして公開し、試してもらう。

**作業**
- GitHub の設定をする。Pages の Source を「GitHub Actions」にし、`github-pages` 環境にタグの規則 `v*` を加える (2026-11-09 にユーザが設定済み)。
- タグ `v20.0.0-beta.1` を付けて push し、Pre-release の印の付いたリリースと、その添付ファイル、Pages を確かめる (`docs/release.md`)。

**完了条件**: タグ `v20.0.0-beta.1` の Pre-release に単一 HTML と dist の zip が添付され、Pages (`https://hidehisaakiyama.github.io/rcssmonitor-web/`) が公開される。

### 正式リリース 20.0.0 (rcsoccersim の Organization へ移転した後)

**作業**
- 公開の前に、手で確かめる (ベータの段階では環境の準備が要るので後回しにした)。
  - ふだん使うブラウザ (Chrome、Firefox。可能なら Safari も) で、ブラウザの機能と重なるキーを横取りできるか。対象は Ctrl+1〜0、Ctrl+-、Ctrl+L / K / H / M / S / P / F、F11 (`docs/parity.md` §8)。
  - LAN 内の別のマシンから、単一 HTML で接続できるか。
  - Pages 版から localhost のサーバに接続できるか (Chrome のローカルネットワークの許可を含む)。
- リポジトリを移す。Pages の URL は変わり、古い URL からは転送されない (`docs/release.md` の「リポジトリを移したとき」)。移した先で GitHub の設定を確かめ、README、`docs/`、About のリンクを新しい場所に書き換える。
- 版を 20.0.0 にし、README のベータの注記を消し、リリースノートを書く。
- タグ `v20.0.0` を付けて push し、リリースの添付ファイルと、新しい場所の Pages を確かめる。

**完了条件**: rcsoccersim/rcssmonitor-web でタグ `v20.0.0` のリリースに単一 HTML と dist の zip が添付され、Pages が公開される。上の手動の確認の結果を §9 に記録する。

### Phase 6: 3D 表示

**作業**
- Three.js を動的 import する。`FieldRenderer` を実装し、2D と 3D を切り替えられるようにする。
- フィールドは、2D の field painter を OffscreenCanvas に描いてテクスチャとして使う。
- 選手は簡易モデル (円柱またはカプセル + 背番号スプライト) をインスタンス描画する。体と首の向き、状態の強調、視野コーンを表す。
- ボールは球で、高さ (`z`) があればその高さに、なければ地面に置く。2.5 次元シミュレータで空中を飛ぶボールを、形式が決まったときに少ない変更で表示できるようにしておく。
  - `BallState` に任意の `z` と `vz` を加え、JSON の `ball.z` / `ball.vz` があれば読む (§4.2。キー名は仮)。
  - 地面にボールの影を描く。高さがわかる目印になる。地面にあるボールにも描く。
  - ゴールに高さ (クロスバー) を持たせる。サーバのパラメータにあればそれを使い、なければ 2.44 m にする。ボールがクロスバーを越えたかが見えるように。
  - カメラはボールの地面上の位置を追い、ボールの高さで画面が揺れないようにする。
  - 補間は z も位置と同じく線形にする。
- 補間: 位置は線形、角度は最短の回り方向で補う。PlayMode の切替や大きな瞬間移動の前後では補間しない。
- カメラ: 真上 (正射影)、中継風 (ボールを滑らかに追う)、ゴール裏、選手視点 (body+neck、視野幅)、自由視点 (OrbitControls)。
- 選手視点のカメラの動きを、人が目で追える速さに抑える (区切り 2 の後に、ユーザの確認で要修正とされた)。
  - 今の実装: 目の高さ 1.65 m から、頭の向き (体 + 首) を毎フレームそのまま追い、視野の幅をすぐに横の画角にする (40〜120°)。首は ±90° の範囲で 1 サイクルに最大 180° 回せる (maxneckmoment) ので、補間しても向きが最大で毎秒 1800° 振れる。体も 1 サイクルに最大 180° 回る。視野の幅が変わると、画角も一瞬で変わる。
  - 比べるために、今の実装を残したうえで、次の 4 つの項目をそれぞれ選べるようにする。すべての組み合わせ (2 × 3 × 2 × 3 = 36 通り) を選べる。既定は今の実装 (`eye`、`head`、`instant`、`view`) にしておき、ユーザが実際の試合で比べたあとで、既定と残す選択肢を決める。
    - 視点 (設定 `player_camera_position`): `eye` は目の高さ (今の実装)。`shoulder` は肩越しで、選手の 6 m 後ろ、高さ 3 m から、前方 15 m、高さ 1 m の点を見る。肩越しでは選手自身も描く。
    - 向きの基準 (`player_camera_direction`): `head` は体 + 首 (今の実装)。`body` は体。`middle` は体 + 首 × 0.5。
    - 向きの動き (`player_camera_motion`): `instant` は毎フレームそのまま (今の実装)。`smooth` は、水平の向きを目標へ近い回り方向に時定数で近づけ、1 フレームの回転を「角速度の上限 × 経過時間」までに抑える。肩越しでは、カメラの位置も滑らかにした向きから決める。
    - 画角 (`player_camera_fov`): `view` は視野の幅をすぐに横の画角にする (今の実装)。`eased` は視野の幅に時定数でゆっくり合わせる。`fixed` は一定にする。実際の視野は地面の扇形 (V) で示す。
  - 数値も設定にする: 時定数 `player_camera_time_constant` (0.5 秒)、角速度の上限 `player_camera_max_turn` (毎秒 90°)、一定にするときの横の画角 `player_camera_fixed_fov` (90°)。
  - 選ぶ選手やカメラを変えたとき、選手が 1 サイクルで動けない距離 (3 m) を飛んだときは、滑らかにせずにすぐその向きにする。止めているときも、向き終わるまで描き続ける。
  - 設定ダイアログに「3D」タブを加え、そこで選ぶ (変更はすぐに効く)。URL パラメータと保存は、ほかの設定と同じ。
- 選手視点のカメラで、選手の知覚に合わせて描く物体を絞る選択肢を加える (設定 `player_camera_sight`。目と肩越しのどちらでも効く)。
  - `all`: すべて描く (今の実装。既定)。
  - `view`: 選手の視野の扇形 (頭の向きから左右に視野の幅の半分) の中にある選手とボールだけを描く。
  - `server`: rcssserver の視覚の規則 (`visualsenderplayer.cpp`) に近づける。距離と角度は、見る選手の位置と頭の向きから測る。
    - 扇形の中の選手とボールは見える。player_max_observation_length / ball_max_observation_length より遠いものは見えないが、既定はピッチの対角線の長さ (125.096 m) なので、ピッチの中ではいつも見える。
    - 背番号: unum_far_length (既定 20 m) までは見える。unum_too_far_length (既定 40 m) までは、遠いほど見えにくい。サーバは (距離 − 20) / (40 − 20) の確率で背番号を送らない。40 m より遠いと見えない。モニタでは乱数を使わず、背番号の不透明度を見える確率にする。
    - サーバは、背番号を送らない選手の体と顔の向きも送らない。unum_too_far_length より遠い選手は、向きの印を描かない。
    - チーム: team_far_length と team_too_far_length で、背番号と同じ規則で決まる。今のサーバ (v18 以降のクライアント) の既定はどちらもピッチの対角線の長さなので、チームはいつもわかる。v18 より前のクライアントでは 40 m と 60 m。チームがわからない選手は灰色で描く。
    - 扇形の外でも、visible_distance (既定 3 m) の中にある物体は、種類だけがわかる。選手は灰色で、背番号と向きの印なしに描く。ボールはそのまま描く。
    - 値は、見る選手の player_type から取る (v18 以降のログにある。なければ既定値)。visible_distance は server_param から取る。
  - 描かない選手の付属物 (背番号、カード、足元の円、視野の扇形) も描かない。フィールドとゴールはいつも描く。
  - 見えるかどうかは、表示しているサイクルのフレームで決め、補間の途中では変えない。カメラの向き (滑らかにしたもの) ではなく、ログにある選手の頭の向きと視野の幅で決める。
  - サーバと同じにならないところ:
    - サーバは雑音の入った距離で背番号とチームを送るか決めるが、モニタは本当の距離で決める。
    - 視覚の情報が届く間隔 (視野の幅で変わる) と、送られた時点からのずれは再現しない。
    - 低い視覚の質 (方向だけ) は扱わない。
- 審判操作は、レイを地面に当てて座標を求めることで 3D でも使えるようにする。HUD は 2D と共通。
- 人型モデルとアニメーション (glTF) は、ライセンスを確認したうえで後から加える。

**完了条件**: 1920×1080 で 60 fps を保てる。2D と 3D を切り替えても選択状態や再生位置が保たれる。`ball.z` を含む show (単体テストと擬似サーバで作るもの) では、ボールが空中に描かれ、影が地面に出る。選手視点のカメラについて、次のことを満たす。
- 4 つの項目のすべての組み合わせを選べる。今の実装も選べる。
- `smooth` では、向きが角速度の上限を超えて動かない (単体テスト。首を毎サイクル ±90° 往復させるなどの合成した向きの列で確かめる)。
- ユーザが実際の試合で比べ、追えるスタイルを既定に決める。
- `view` と `server` では、上の規則どおりに描き分ける (単体テストと E2E テスト)。

### 将来の拡張 (rcssmonitor にない機能。初回の正式リリース 20.0.0 の対象外)

- ドラッグで選手を移動する (`(dispplayer SIDE UNUM X Y ANG)`。ANG は 16 倍せず整数の度で送る)。
- ボールや選手の軌跡表示、msg の一覧パネル、`stime` の表示。
- バイナリ rcg (v1〜v3)、URL を指定してログを開く機能 (`?log=`)。
- rcssserver 自身による静的ファイル配信 (同じオリジンになり、Origin や mixed content の問題がなくなる)。
- 2.5 次元シミュレータ (ボールが空中を飛ぶ) への対応のうち、サーバの形式が決まるまで決められないもの。Phase 6 では、ボールの高さを受け取って 3D に描くところまでを用意する。
  - プロトコルとログの形式: JSON のキー名と単位、テキスト rcg の新しい版、選手にも高さ (ジャンプ、ヘディング、キーパーの飛びつき) があるか。
  - 2D 表示での高さの表し方 (影をずらす、大きさを変える、数値で出すなど)。rcssmonitor (Qt 版) と揃えて決める。
  - ボールの予測軌道。今は地面の上の減衰だけを計算している。重力や跳ね返りが入るなら、サーバの物理を移植する。
  - 審判操作 (ボールを置く高さ) と、空中のボールに対するキック範囲などの描き方。サーバの規則に合わせる。

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

### Phase 3 (2026-11-09)

**完了条件の確認**
- E2E テスト (Chromium と Firefox) が通る。対象は次のとおり。
  - 再生と停止、速度の変更、末尾で止まること
  - キー・ボタン・ホイールでのコマ送り、ループ
  - 得点ジャンプ、サイクル指定、スライダー
  - ドラッグ＆ドロップ、Ctrl+O
- `Playback` の単体テストで、時間による進み方、速度の上限と下限、ループ、ライブ追従、得点ジャンプの位置を確かめた。

**計画からの変更と、実装で決めたこと**
- `Playback` (`src/playback/playback.ts`) は DOM に依存しない。rAF の時刻を受け取り、経過した時間のぶんフレームを進める。
  - 5 ms 間隔でも正しい速さで進み、1 回の描画で 3〜4 フレーム進む。
  - 1 回の tick は 250 ms までしか数えないので、タブを裏に回した後に急に飛ばない。
  - 3D 用に、補間係数 α を `position()` で返す。
- 操作の結果は rcssmonitor に合わせた。
  - 再生を始め直すと既定の速さに戻る。
  - コマ送りと先頭・末尾は再生を止め、スライダー、得点ジャンプ、サイクル指定は止めない。
  - 末尾を越えようとしたところで止まる。
- 得点ジャンプは rcssmonitor と同じフレームに着く。`scoreChanges` は rcssmonitor の記録より 1 つ後のフレームなので、その 1 つ前から 50 を引く。テキストのフィクスチャでは、得点 (フレーム 249) の 50 手前の 198 に移る。
- rcssmonitor にない機能を加えた。ドラッグ＆ドロップ、ループのボタン、サイクル指定の入力欄、速度の表示。
- ツールバーのボタンはクリックしてもフォーカスを取らない。そのため、ボタンを押した後も Space や矢印キーが再生の操作として効く。
- アプリの結線は `src/ui/app.ts` にまとめた。`main.ts` は起動と E2E 用の入口だけにした。
- Chromium で Ctrl+O の E2E テストが失敗したことがある。原因は Playwright のファイル選択の横取りが非同期に有効になることで、アプリの不具合ではなかった (テストで 1 回ページとやり取りしてからキーを押す)。

### Phase 4 (2026-11-09)

**完了条件の確認**
- 擬似サーバに対する E2E テスト (Chromium と Firefox) が通る。対象は次のとおり。
  - 接続ダイアログでの接続、受信、ライブ追従 (コマ送りで戻り、Ctrl+L で最新に戻る)、キックオフ、切断 (`(dispbye)`)
  - URL パラメータでの接続、自動再接続、Ctrl+C での再接続
  - 接続できない (Origin の拒否)、拒否 (`(error no_more_monitor)`)、msg で届くエラー、サーバ側からの切断の表示
  - 右クリックメニューからの審判コマンド (ドロップボール、フリーキック、カード、Change Playmode) と、未接続や coach モードでないときに項目が無効になること
- 単体テストで次を確かめた。
  - コマンドの文字列 (16 倍の丸め、side の符号、unum の検証)、Change Playmode のボール位置の補正 (16 モードすべて)
  - ライブ受信 (実際のサーバから取ったフィクスチャ、msg の応答、制御文字の入った JSON)
  - 接続部: 擬似サーバに Node の WebSocket でつなぎ、受信、コマンド、無通信のタイムアウト、拒否、接続の失敗、再接続を確かめた
  - 擬似サーバの応答と、ログ → ライブ形式 → 受信の往復でフレームが一致すること (フィクスチャ 3 本)
- 実際の asio 版 rcssserver 19.0.0 (`server::ws_port`、`server::coach_w_referee=true`) に 2 チーム (HELIOS) をつなぎ、単一 HTML を file:// で開いて Chromium と Firefox で確かめた。

| 試験 | 結果 |
|---|---|
| 接続、ライブ受信 | 接続できた。チームロゴ (256 × 64) もライブで届いた |
| キックオフ (Ctrl+K) | kick_off_l から play_on へ |
| ドロップボール | ボールが右クリックした位置 (10, -4.94) に置かれた |
| フリーキック (左) | free_kick_l、ボールは (-20.06, 10) |
| イエローカード / レッドカード | 選手の状態にカードのビットが立った。レッドカードの選手は退場した |
| Change Playmode | corner_kick_r でボールが (-51.5, 33) へ。back_pass_l (rcssmonitor では送られないもの) でボールが (-36, -20.16) へ |
| サーバを SIGSTOP で止める | 5.3 秒後に "No response from the server." として切断。Ctrl+C で接続し直せた |
| サーバの終了 | "Disconnected from the server." を表示。受信したフレームはそのまま見られる |
| `ws_allowed_origins='http://example.invalid'` | 接続できない旨を表示。サーバのログは `refused: 403 Forbidden (path=/monitor origin=null)` |
| `ws_allowed_origins='http://example.invalid,null'` | 接続できた |
| rcssmonitor (Qt 版、ws) との比較 | 同じサーバにつなぎ、キックオフ前の画面を比べた。選手の位置、ロゴ、スコアボードは一致した。違いは、2 枚を撮る間に変わった体の向きと、Phase 2 と同じフォントの字形だけ |

- まだ確かめていないこと: LAN 内の別のマシンからの接続、Pages 版から localhost への接続。どちらも正式リリース 20.0.0 の前に確かめる (§5)。

**計画からの変更と、実装で決めたこと**
- 接続部 `LiveClient` (`src/io/live/client.ts`) は DOM に依存しない。そのため、単体テストで Node の WebSocket から擬似サーバにつないで試せる。
- 新しい試合のデータ (`GameStore`) は、接続が受け入れられた時点 (最初の JSON メッセージが届いた時点) で作る。
  - rcssmonitor は接続を始めた時点でデータを消す。
  - Web 版では、再接続を待つ間も前の試合を見られ、接続に失敗しても開いていたログが残る。
- 最初のメッセージが JSON でなければ、拒否とみなして切断する。rcssmonitor は `(error` で始まるときだけ切断する。
- 審判操作の UI は次のようにした。
  - メニューバーは Phase 5 で作るので、接続、切断、キックオフのボタンはツールバーに置いた。
  - 右クリックメニューは、接続していないと項目を無効にして理由を示す。rcssmonitor は有効のまま表示して何もしない。
  - カードのダイアログでは、右クリックした位置から 3 m 以内の選手を最初から選んでおく。rcssmonitor は空欄から選ぶ。
  - Change Playmode は、server_param の `coach` / `coach_w_referee` が偽なら無効にして理由を示す。rcssmonitor は選んだ後にメッセージボックスを出す。
- サーバは文字列の制御文字をエスケープしないので、改行などが入ると不正な JSON になる。解析に失敗したときは、制御文字をエスケープして読み直す。
- Ctrl+C は、文字を選択している間はブラウザのコピーに譲る。
- 擬似サーバ (`tools/replay-server`) は TypeScript で書き、アプリのパーサを共有する。
  - コマンドラインからは Vite のモジュールランナー (`runnerImport`) で読み込む。テストからはプロセス内で起動する。
  - coach モードかどうかは、本物のサーバと同じく server_param の `coach` / `coach_w_referee` で決める。フィクスチャの元の試合では `coach_w_referee` が真だった。
  - 依存に `ws` 8.22.0 を加えた。最新の 8.22.2 は前日に公開されたばかりだったので避け、公開から 6 週間たった版にした。
- 実際のサーバで試してわかったことを `docs/protocol.md` に書いた。
  - ドロップボールはその場で play_on に変わるので、drop_ball の show は届かない。
  - `(move (ball) …)` の引数は `x y [ang [vx vy]]` だった (以前の記述を直した)。
  - rcssserver のコマンドラインでは、値の中に空白を入れられない。
- rcssserver は環境変数 `RCSS_CONF_DIR` で設定ディレクトリを変えられる。手動試験はこれで行い、`~/.rcssserver` には触れていない。
- `tools/parity/capture.sh` と `compare.mjs` を、ログの代わりにライブのサーバにもつなげるようにした (`ws://HOST:PORT`、`--live HOST:PORT`)。§7 の rcssmonitor との並べての比較に使う。
- 数値の書式 (printf の `%g` に当たる `formatG`) を `src/core/number-format.ts` に置き、`(move (ball) …)` と選手のラベルで共有した。
- Phase 5 で確かめること: Ctrl+C、Ctrl+L、Ctrl+K がふだん使うブラウザ (ヘッドレスでないもの) で横取りできるか。

### Phase 5 (2026-11-09)

**完了条件の確認**
- `docs/parity.md` の項目はすべて「済」か「対象外」になった。「将来」とした 2 項目 (選手のドラッグ移動、軌跡) は、初回の正式リリース 20.0.0 の対象外とした。
- キー割り当ての互換表を `docs/parity.md` の §8 に書いた。rcssmonitor のキーには、ブラウザが予約していて横取りできないもの (Ctrl+N / T / W、Ctrl+Tab など) がないので、代わりのキーは要らなかった。
- リリースのワークフロー (`.github/workflows/release.yml`) と手順 (`docs/release.md`) を用意した。
  - 版の確認と添付ファイルの作成は手元で試した。ワークフロー自体は GitHub 上でしか動かないので、最初のタグのときに確かめる。
  - 既存のタグを指定して手で実行し直せる。リポジトリを移した後に、新しい URL の Pages へ公開し直すため。
- 分割ビルドをサブパスに置いて HTTP で配信し (Pages と同じ形)、Chromium と Firefox で動くことを確かめた。
- 単体テストで次を確かめた。
  - 設定の保存と読み込み、値の検証、URL パラメータ (保存しないこと)、保存できない環境
  - ショートカット一覧と実際のキー処理が一致すること (どちらの向きにも)
  - 選手タイプ一覧の値と並べ替え
- E2E テスト (Chromium と Firefox) で、メニューバー (マウスと矢印キー)、バーの表示切替と保存、設定ダイアログの 4 タブ (変更の反映、キー操作への追従、再読み込み後の保存)、URL パラメータ、選手タイプ一覧の並べ替え、ショートカット一覧と About、全画面を確かめた。

**計画からの変更と、実装で決めたこと**
- タグ付け、リリースへの添付、Pages の公開を Phase 5 から分けた。公開は取り消しが利かず、Organization への移転との順番も決める必要があるため。
  - その後、版のメジャーを rcssserver にそろえることにした (§2)。個人リポジトリで 20.0.0-beta.1 をプレリリースし、移転した後に 20.0.0 を正式に出す (§5)。
  - Phase 4 で Phase 5 に回した確認 (ふだん使うブラウザでのキーの横取り) は、正式リリースの前に行う。
- 設定の項目名は rcssmonitor の設定名に合わせた (`show_player_number`、`field_brush`、`score_board_font` など)。保存先は localStorage で、URL パラメータも同じ名前で受け付ける (`-` 区切りでも書ける)。
  - URL で指定した値はそのページにだけ効き、保存しない。その後にユーザが変えた項目は保存する。共有されたリンクを開いても、開いた人の設定は変わらない。rcssmonitor は終了時に、コマンドラインで指定した値も保存する。
- 設定ダイアログ、選手タイプ一覧、ショートカット一覧は、rcssmonitor と同じく開いたまま操作できるウインドウ (モーダルでない `<dialog>`) にした。見出しをドラッグして動かせ、Escape で閉じる。
- 設定ダイアログの違い
  - Color タブに設定ファイルの 35 色すべてを並べる (rcssmonitor のダイアログは 30 色)。
  - Font タブはファミリ名を入力する形にした (ブラウザにはフォント選択のダイアログがない)。
  - Canvas Size はフィールドの大きさを固定する (ウインドウの大きさは変えられない)。
  - Anti Aliasing と Draw Info は置かない。
- メニューバーは rcssmonitor の 5 つのメニュー (Quit、Window Style、About Qt を除く) と同じ。Phase 4 でツールバーに置いた接続、切断、キックオフのボタンは残した。
- 全画面は Fullscreen API で、ブラウザの決まりにより Escape でも戻る。
- About には版 (package.json) とビルドのコミットを出す。版は 20.0.0-beta.1 にした (§2)。
- 直した rcssmonitor の不具合: "Fix" が Auto right になる、Illegal Defense の色の初期値、選手タイプ一覧で数値が 2 つある列が並べ替わらない。
- メニューバーの高さを整数の画素にした。小数だとその下のフィールドが画素の境目からずれ、スクリーンショットのテストの大きさが 1 画素変わった。

### プレリリース 20.0.0-beta.1 (2026-11-09)

**完了条件の確認**
- main のコミット `0cd6410` にタグ `v20.0.0-beta.1` を付けて push した。Release ワークフローの 3 つのジョブ (確認とビルド、リリース、Pages) が成功した (約 3 分)。
- リリースは Pre-release の印付きで公開され、単一 HTML (`rcssmonitor-web-v20.0.0-beta.1.html`) と dist の zip が添付された。本文は `docs/release-notes/v20.0.0-beta.1.md` から入った。
- Pages (`https://hidehisaakiyama.github.io/rcssmonitor-web/`) が公開された。
- 添付の単一 HTML をダウンロードして file:// で開いた場合と、Pages の場合の両方で、Chromium と Firefox でログを読み込めた。About の版は `20.0.0-beta.1 (0cd6410)`。

**その後に決めたこと**
- Phase 6 (3D 表示) を正式リリース 20.0.0 より先に進める。3D を 20.0.0 に含めるかは、まだ決めていない。
- ブランチの方針 (§2) を決め、main から `develop` を切った。Phase 6 は develop から切った `feature/3d-view` で進める。
- rcssserver で、ボールが空中を飛ぶ 2.5 次元シミュレータが計画されている。これに備えて、Phase 6 にボールの高さの受け入れ (`ball.z` / `ball.vz`、影、ゴールの高さ、高さで揺れないカメラ) を加えた (§4.2、§5)。形式が決まるまで決められないものは、将来の拡張に挙げた。

### Phase 6 (作業中)

**区切り 1: 3D の描画の土台 (2026-11-10)**
- 2D と 3D を、View > 3D View、ツールバーの「3D」ボタン、キー D で切り替える (rcssmonitor にない機能。キーは rcssmonitor で使われていない D にした)。選んだほうは設定 `view_3d` として保存する。
- 3D の部分 (three.js を含む) は動的 import で読み込む。分割ビルドでは、3D を初めて開いたときに別のファイル (約 570 kB、gzip で 140 kB) を読み込む。単一 HTML は three.js を含むので、約 140 kB から約 720 kB になった。
  - three.js は 0.186.1 (MIT)。最新の 0.187.0 は公開から 2 週間たっていなかったので避けた。
- フィールドは 2D の field painter で描いたテクスチャ (1 m を 24 画素、ペンを 3 倍にして線の幅を実物と同じ約 12 cm にする)。ライトの影響を受けないようにして 2D と同じ色にした。ゴールは 3D の枠 (ポスト、クロスバー 2.44 m、半透明のネット) で作る。
- 選手は、胴体、頭、足元の円 (キック範囲。設定の Player Size があればその大きさ)、体の向き (黒) と顔の向き (赤) の印を、部品ごとのインスタンス描画で描く。色は 2D と同じ (チーム、キーパー、未接続は黒)。背番号はスプライト。
- ボールは設定の Ball Size の大きさで、`ball.z` があればその高さに描き、地面に影を落とす。影は高いほど薄くなる。
- 既定のカメラは中継のようにタッチラインの外から見下ろす (仰角 32°)。距離は、ピッチの四隅が画面に収まる最短の距離を、投影の式から求める。マウスの左ドラッグで回転、Shift / Ctrl + 左ドラッグで移動、ホイールで拡大縮小する (3D ではホイールでコマ送りしない)。右ボタンは審判のメニューのために空けた。
- 右クリックの位置とマウス位置の表示は、カメラからの光線と地面の交点で求める。そのため 3D でも審判のメニューが使える。2D のマウス操作 (ドラッグでの移動、計測、ダブルクリック) は 2D だけで働く。
- 試験: 単体テスト (座標と向きの対応を three.js の回転で、カメラの距離をピッチの四隅の投影で確かめる。ボールの高さ、影、選手の大きさと色。擬似サーバがボールの高さを配信すること)。E2E テスト (切り替えでフレームと選手の選択が保たれる、設定の保存、高さのあるボールと影、3D での審判のメニュー、ホイール)。ヘッドレスのブラウザは WebGL をソフトウェアで描くので、画素ではなくシーンの状態を確かめる。
- 途中で見つけて直した 2D の不具合: keepaway の試合で、keepaway の領域が自動で描かれなかった。server_param の名前は `keepaway` だが、rcssmonitor の C++ のメンバ名 `keepaway_mode` で見ていた (Phase 2 の移植の誤り)。表示の設定で Keepaway Area を有効にすれば描かれていた。
- 次の区切り: カメラの切り替え (真上、中継風の追従、ゴール裏、選手視点)、補間、状態の強調と視野、性能の確認。

**区切り 2: カメラ、補間、状態の強調と視野、性能 (2026-11-10)**
- カメラは 6 つ: 自由 (マウスで回す)、中継風、真上 (正射影。2D と同じ向き)、左右のゴール裏、選択した選手の目。View > 3D Camera、ツールバーの一覧、キー E (次のカメラ) で切り替え、設定 `camera_3d` として保存する。既定は中継風。
  - 中継風とゴール裏はボールの地面上の位置を滑らかに追う (時定数 0.35 秒)。ボールの高さでは動かない。マウスでドラッグすると、その位置から自由のカメラになる。
  - 選手の目のカメラは、体と首の向きを見て、視野の幅を横の画角にする (120° まで)。その選手自身の体は描かない。選手を選んでいなければ中継風で、選び方をステータスバーで案内する。
- 補間: 再生中は前後のフレームの間を補う。位置は線形、体の向きは近い回り方向。プレイモードが変わるところと、1 サイクルで動けない距離 (選手 3 m、ボール 4 m) を飛んだものは補わない。ライブでは最新の 1 つ前のフレームから最新のフレームへ、1 ステップ (simulator_step) かけて動かす (§4.3 のとおり 1 サイクル遅れる)。
- 状態の色は 2D と同じ規則にした。2D の drawBody から判定を `src/view/player-style.ts` に切り出し、2D と 3D で共有する (2D のスクリーンショットのテストは変わらず通る)。
  - 足元の円は状態の色 (キックの失敗、キャッチ、タックル、衝突、ファウルなど) で塗り、強調するとき (キック、タックル、不正な守備、選択中) は縁を描く。体はスタミナに応じて暗くし、effort / recovery が下がると外側に輪を描く。
  - カードは背番号の横に黄色または赤の札で出す。
- 視野 (V): 全員の頭の向きに visible_distance の扇形を地面に描き、選択中の選手には 20 / 40 / 60 m の弧と境界の線を描く (2D と同じ)。
- 性能 (1920×1080 のウインドウ、キャンバス 1920×989、全長ログの再生中): Firefox (このマシンの GPU) は 60 fps (画面の更新の上限)。視野を全員分出して選手を選んだ状態 (描画命令 93 回) でも 60 fps。ヘッドレスの Chromium は WebGL を CPU だけで描く (SwiftShader) ので 33〜36 fps で、実際の環境の目安にはならない。
- 途中で見つけて直したこと: 真上のカメラに切り替えた直後、一度も描かないうちは座標の変換が狂った (three.js のカメラの行列は描画のときに更新される)。滑らかに追うカメラが、目標の 2 cm 手前で止まったとみなして描き直しをやめ、少しずれたまま残ることがあった。
- 試験: 単体テスト (補間、カメラの位置と画角、状態の色、カメラの設定)。E2E テスト (補間、6 つのカメラの切り替えと保存、真上でピッチ全体が見えること、選手の目の位置、ドラッグで自由になること、ライブで 1 サイクル遅れて描くこと)。
- ユーザの確認 (区切り 2 のコミットの後):
  - 選手視点のカメラの動きが激しすぎて、人の目では追えない。要修正として §5 の Phase 6 の作業と完了条件に加えた。
  - 2D のほかの重ね描き (キャッチ・タックル・キックの範囲、オフサイドライン、予測軌道など) を 3D に加えるかは、後でユーザが指示する。
  - 選手視点のカメラは、今の素朴な実装を残したうえで、視点、向きの基準、向きの動き、画角のすべての組み合わせを選べるようにして比べる。あわせて、選手の視野の外の物体を描かない選択肢と、サーバの視覚の規則 (背番号が見える距離、visible_distance の中の物体の知覚) を反映する選択肢を加える。§5 の Phase 6 に反映した。
  - rcssserver のソースで確かめたこと:
    - unum_far_length などの値は server_param ではなく、v18 から player_type の値になった (既定 20 m と 40 m)。
    - team_far_length と team_too_far_length は、2022 年にピッチの対角線の長さに変わった。今はチームがいつもわかる。
    - 背番号を送らない選手については、体と顔の向きも送らない。

**区切り 3: 選手のカメラのスタイルと、選手の知覚 (2026-11-10)**
- 選手のカメラを `src/view/render3d/player-camera.ts` に分けた。4 つの項目 (視点、向きの基準、向きの動き、画角) を選べ、すべての組み合わせ (36 通り) を試せる。既定は最初の素朴なカメラ (`eye`、`head`、`instant`、`view`) のまま。
  - `smooth` は、向きを目標へ近い回り方向に時定数で近づけ、1 フレームの回転を「角速度の上限 × 経過時間」までに抑える。`eased` の画角も同じ時定数で近づける。
  - 選ぶ選手、カメラ、スタイルを変えたときと、選手が 3 m より大きく飛んだときは、すぐにその向きにする。止めているときも、向き終わるまで描く。
  - 肩越しのときは、その選手自身も描く。
- 選手の知覚に合わせた描き方 (`all`、`view`、`server`) を `src/view/render3d/sight.ts` に書いた。選手のカメラのときだけ効き、表示しているサイクルのフレームで決める。
  - `server` では、チームがわからない選手を灰色にし、背番号は見える確率を不透明度にする。背番号が届かない選手には、向きの印を描かない。
  - 視野の外で visible_distance の中の選手は、灰色で描く。背番号、向きの印、足元の強調の輪、カード、視野の扇形は描かない。
  - 未接続の選手は、サーバが送らないので描かない (`all` では今までどおり黒で描く)。
- 設定ダイアログに 3D タブを加え、選手のカメラの項目と数値、知覚の描き方を選べるようにした。Default で最初のカメラに戻す。メニューは 1 段のサブメニューしか持てないので、ダイアログに置いた。
  - どの項目にもツールチップで中の計算を示し、選んでいる選択肢の説明を行の下に出す。数値の項目は、使う選択肢を注記に書く。
  - 設定 `player_camera_position`、`player_camera_direction`、`player_camera_motion`、`player_camera_fov`、`player_camera_sight`、`player_camera_time_constant`、`player_camera_max_turn`、`player_camera_fixed_fov` として保存し、URL パラメータでも指定できる。
- 試験:
  - 単体テスト: 最初のカメラが首の振りで毎秒 1800° 回ること。`smooth` が、首を毎サイクル ±90° 振っても、体が 1 サイクルに 170° 回っても、上限を超えないこと。90° の向き変えが 1.5 秒でほぼ終わること。画角の 3 つの方式、すぐに向き直す条件、知覚の規則、設定。
  - E2E テスト: 3D タブでの選択と保存、選択に合わせた説明とツールチップ、肩越しの位置、一定の画角。知覚の 3 つの描き方で描く選手、背番号、向きの印、ボールの数。選手のカメラ以外では絞らないこと。
- 次: ユーザが実際の試合で比べ、既定とするスタイルを決める。

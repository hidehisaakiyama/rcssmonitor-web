# rcssmonitor との機能対応表

rcssmonitor (Qt 版) の機能と、rcssmonitor-web での扱いをまとめた表。各フェーズの終わりに「状態」を更新する。

- 参照箇所は rcssmonitor リポジトリの `src/` からの相対パス。
- 状態の値は 未着手 / 作業中 / 済 / 対象外 のいずれか。

## 1. 接続とライブ表示

| 機能 | rcssmonitor | Phase | 状態 | 備考 |
|---|---|---|---|---|
| 既定の接続先に接続 (Ctrl+C) | main_window.cpp:295 | 4 | 未着手 | ブラウザのコピーと重なる。Phase 5 でキーを決める |
| 接続先を指定して接続 (Connect to ...) | connect_dialog.cpp | 4 | 未着手 | host、port、path。トランスポートの選択はない (WebSocket のみ) |
| 切断 (`(dispbye)`) | main_window.cpp:314 | 4 | 未着手 | |
| ライブモード (Ctrl+L) | main_window.cpp:330 | 4 | 作業中 | ライブ中も過去に戻れる。ツールバーのボタンと `Playback.setLive()` はある (ログでは末尾へ移る)。受信への追従は Phase 4 |
| 起動時に自動接続 | options.cpp:218 | 4 | 未着手 | URL パラメータ `connect=1`。既定は接続しない |
| 無通信 5 秒で切断 | monitor_client.cpp:319-338 | 4 | 未着手 | |
| 自動再接続と待ち時間 | monitor_client.cpp:345-360 | 4 | 未着手 | |
| 接続時のエラー応答 (`(error …)`) | monitor_client.cpp:241-253 | 4 | 未着手 | 表示してから切断する |
| プロトコル v1〜v5 (UDP / TCP) | monitor_client.cpp:81-93 | — | 対象外 | JSON (`-1`) のみ |

## 2. 審判操作

| 機能 | rcssmonitor | Phase | 状態 | 備考 |
|---|---|---|---|---|
| Kick Off (`(dispstart)`, Ctrl+K) | main_window.cpp:483 | 4 | 未着手 | |
| Drop Ball (右クリック) | field_canvas.cpp:273 | 4 | 未着手 | `(dispfoul X Y 0)` |
| Free Kick Left / Right (右クリック) | field_canvas.cpp:273 | 4 | 未着手 | `(dispfoul X Y ±1)` |
| Yellow / Red Card | main_window.cpp:2166-2267 | 4 | 未着手 | 送信前に unum が 1〜11 かを検証する |
| Change Playmode (ボール位置の補正つき) | main_window.cpp:2294-2454 | 4 | 未着手 | coach モードが必要。back_pass で何も送られない不具合は直す |
| 選手のドラッグ移動 (`dispplayer`) | (未使用) | 将来 | 未着手 | rcssmonitor でも UI がない |
| 選手の退場 (`dispdiscard`) | (未使用) | — | 対象外 | |

## 3. 描画

| 機能 | rcssmonitor | Phase | 状態 | 備考 |
|---|---|---|---|---|
| フィールド (ライン、ペナルティエリア、ゴール) | field_painter.cpp:108-334 | 2 | 済 | 単色の芝 (31,160,31)。円と円弧はアンチエイリアスなしで 1 画素ずつ描く |
| フラグ (Ctrl+F) | field_painter.cpp:341-575 | 2 | 済 | |
| グリッドと座標ラベル | field_painter.cpp:582-674 | 2 | 済 | 刻みの設定 UI は Phase 5 |
| keepaway 領域 | field_painter.cpp:141-151 | 2 | 済 | |
| スコアボード (Ctrl+S) | score_board_painter.cpp:78-224 | 2 | 済 | PK の o/x 表示を含む。HUD として選手の上に描く (rcssmonitor は下) |
| チームロゴ | team_graphic_painter.cpp:69-145 | 2 | 済 | 倍率の設定 UI は Phase 5 |
| 選手の外円と体の円、チーム色、キーパーの色 | player_painter.cpp:71-251 | 2 | 済 | 22 人すべてを描く (未接続は黒) |
| 状態の色 (kick、tackle、catch、collision、foul、illegal defense) | player_painter.cpp:256-298 | 2 | 済 | |
| スタミナの濃淡、effort / recovery の輪 (S で切替) | player_painter.cpp:306-355 | 2 | 済 | S はスタミナの数値の表示を切り替える |
| 体の向きと首の向き | player_painter.cpp:373-406 | 2 | 済 | |
| 視野 (V) | player_painter.cpp:413-494 | 2 | 済 | 選択選手は 20 / 40 / 60 m の弧 |
| 注視点 | player_painter.cpp:501-521 | 2 | 済 | ログには注視点がない (ライブとテキスト v6 のみ) |
| キャッチ範囲 (C) | player_painter.cpp:528-583 | 2 | 済 | 左のキーパーに右のキーパーの色を使う不具合を直した |
| タックル範囲と確率 (T) | player_painter.cpp:624-704 | 2 | 済 | |
| キック加速範囲 (K) | player_painter.cpp:711-877 | 2 | 済 | |
| pointto (Ctrl+A) | player_painter.cpp:884-897 | 2 | 済 | |
| 背番号、選手タイプ、スタミナのラベル、カード (N、H) | player_painter.cpp:904-1014 | 2 | 済 | |
| オフサイドライン (O) | player_painter.cpp:1021-1097 | 2 | 済 | 線が x = 0 とボールの間にしか引かれない不具合を直した |
| ボールと予測軌道 (Ctrl+B) | ball_painter.cpp:79-196 | 2 | 済 | 予測するサイクル数の設定 UI は Phase 5 |
| 選手の表示切替 (Ctrl+P) | config_dialog.cpp | 2 | 済 | |
| 計測ツール (中ボタンでドラッグ) | field_canvas.cpp:240-263, 414-499 | 2 | 済 | Shift+ドラッグも加えた |
| draw info (v1 の DRAW レコード) | draw_info_painter.cpp | — | 対象外 | バイナリ v1 にしかない |
| ボール・選手の軌跡 | (`#if 0` で無効) | 将来 | 未着手 | |
| アンチエイリアス | options | — | 対象外 | Canvas では常に有効 |

## 4. 表示の操作

| 機能 | rcssmonitor | Phase | 状態 | 備考 |
|---|---|---|---|---|
| 拡大と縮小 (Z、X / Ctrl+Z、×1.5 刻み、1〜400 px/m) | options.cpp:1557-1594 | 2 | 済 | |
| 全体表示 (I) | options.cpp:1601-1698 | 2 | 済 | |
| ダブルクリックで中心を移動 | field_canvas.cpp:134 | 2 | 済 | |
| 左ドラッグで移動 | field_canvas.cpp:214-233 | 2 | 済 | |
| フォーカス (B: ボール、P: 選択選手、固定) | field_canvas.cpp:357-381 | 2 | 済 | |
| 選手選択 (1〜0、-、Ctrl+数字) | config_dialog.cpp:2540 | 2 | 済 | Ctrl+数字はブラウザのタブ切替と重なる。Phase 5 で確かめる |
| 自動選択 (A、L、R) と解除 (U) | field_canvas.cpp:317-354 | 2 | 済 | |
| マウス位置の座標表示 (ステータスバー) | main_window.cpp:2533 | 2 | 済 | |
| キャンバスの大きさの指定 | config_dialog.cpp:1570 | 5 | 未着手 | 優先度は低い |

## 5. ログプレイヤー

| 機能 | rcssmonitor | Phase | 状態 | 備考 |
|---|---|---|---|---|
| ログを開く (Ctrl+O) | main_window.cpp:1743-1785 | 3 | 済 | ボタンと Ctrl+O のほか、ドラッグ＆ドロップでも開ける。開くと全体表示に戻り、先頭で止まる |
| JSON rcg、テキスト rcg v4〜v6、gzip | rcss/rcg/parser.cpp:56-131 | 1 | 済 | Worker で解析する。不正な行は飛ばして警告にする。テキスト rcg の `stime` は推定する |
| バイナリ rcg v1〜v3 | rcss/rcg/parser_v1〜v3 | 将来 | 対象外 | |
| 読み込みの進捗表示 | rcg_handler.cpp:59-123 | 1 | 済 | ステータスバーに展開と解析の進捗を出す |
| 再生と停止 (Space) | main_window.cpp:327-473 | 3 | 済 | 再生を始め直すと既定の速さ (100 ms) に戻る (rcssmonitor と同じ) |
| 1 フレーム送りと戻し (←、→、ホイール) | main_window.cpp:1315 | 3 | 済 | タッチパッドのホイールは 50 ピクセルごとに 1 フレーム進める |
| 速度の変更 (Ctrl+↑ / ↓、5〜5000 ms) | log_player.cpp:229-353 | 3 | 済 | 再生中だけ効く。今の間隔をツールバーに出す。表示より短い間隔は 1 回の描画で複数フレーム進める |
| 前後の得点へ移動 (G、Ctrl+G) | log_player.cpp:245-291 | 3 | 済 | 50 フレーム手前に移動する。rcssmonitor と同じフレームに着くよう、`scoreChanges` の 1 つ前から数える |
| 先頭と末尾 (Home、End) | main_window.cpp | 3 | 済 | |
| フレーム位置のスライダー | log_player_slider.cpp:76-145 | 3 | 済 | |
| ループ再生 | disp_holder.cpp:490-551 | 3 | 済 | ツールバーのボタンで切り替える (rcssmonitor はコマンドラインのオプションだけ) |
| サイクルを指定して移動 | (`goToCycle` は UI なし) | 3 | 済 | ツールバーの入力欄。そのサイクルがなければ次のサイクルへ移る |
| 自動終了 (auto quit) | log_player.cpp:134-146 | — | 対象外 | ブラウザでは終了できない |

## 6. 設定とダイアログ

| 機能 | rcssmonitor | Phase | 状態 | 備考 |
|---|---|---|---|---|
| 設定ダイアログ (Show、Canvas、Color、Font の 4 タブ) | config_dialog.cpp:246-342 | 5 | 未着手 | |
| 色 35 項目 | options.cpp:98-132 | 5 | 未着手 | Illegal Defense の色の初期値が Pointto の色になる不具合は直す |
| フォント (スコアボード、選手、計測) | options.cpp:326-328 | 5 | 未着手 | |
| 選手選択の "Fix" | config_dialog.cpp:2441 | 5 | 未着手 | Auto-right になる不具合は直す |
| 選手タイプ一覧 (Ctrl+H、16 列、並べ替え) | player_type_dialog.cpp:160-375 | 5 | 未着手 | ホイールで透明度を変える機能は対象外 |
| ショートカット一覧 | main_window.cpp:1655 | 5 | 未着手 | |
| メニューバー、ツールバー、ステータスバーの表示切替 | main_window.cpp:529-552 | 5 | 未着手 | |
| 全画面 (F11、Alt+Enter) | main_window.cpp:561-574 | 5 | 未着手 | Fullscreen API を使う |
| 設定の保存 (`~/.rcssmonitor.conf`) | options.cpp:333-855 | 5 | 未着手 | localStorage に保存する |
| コマンドラインオプション | options.cpp:862-1158 | 4〜5 | 未着手 | URL パラメータで代替する |
| Window Style、About Qt | main_window.cpp:577-590, 767-783 | — | 対象外 | Qt 固有 |
| 終了 (Ctrl+Q) | main_window.cpp:275 | — | 対象外 | |

## 7. rcssmonitor の不具合 (移植で直すもの)

| 不具合 | 場所 | 状態 |
|---|---|---|
| 65,535 フレームを超えるとライブ表示が止まる | disp_holder.cpp:65, 249 | 済 |
| JSON の `vq` が bool として扱われる | rcss/rcg/parser_simdjson.cpp:478 | 済 |
| JSON の未知のキーで解析全体が中断する | rcss/rcg/parser_simdjson.cpp:85-164 | 済 |
| JSON の選手を配列の順に格納している | rcss/rcg/parser_simdjson.cpp:447-525 | 済 |
| `foul_push_r` が PM_Null になる | rcss/rcg/util.cpp:854-855 | 済 |
| テキスト rcg のチームグラフィックで 16 文字以上の文字列が壊れる | rcss/rcg/parser_v4.cpp:625-709 | 済 |
| パラメータの既定値が古い (`player_speed_max` 1.2、`stamina_max` 4000 など約 40 項目)。`effort_inc` が対応表にない | rcss/rcg/types.cpp:547-760 | 済 |
| テキスト rcg に `(名前` で始まらない行が 1 行でもあると、ログ全体の読み込みが止まる | rcss/rcg/parser_v4.cpp:95-102, 123-128 | 済 |
| オフサイドラインが x = 0 とボールの間にしか引かれない (選手の side を列挙値と比べている) | player_painter.cpp:1034, 1061 | 済 |
| 左のキーパーのキャッチ範囲に右のキーパーの色を使う (同じ比較の誤り) | player_painter.cpp:545, 563 | 済 |
| Change Playmode の back_pass で何も送られない | main_window.cpp:2394-2429 | 未着手 |
| 設定ダイアログの "Fix" が Auto-right になる | config_dialog.cpp:2441 | 未着手 |
| Illegal Defense の色の初期値が Pointto の色 | config_dialog.cpp:1258-1260 | 未着手 |

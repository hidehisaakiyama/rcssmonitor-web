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
| ライブモード (Ctrl+L) | main_window.cpp:330 | 4 | 未着手 | ライブ中も過去に戻れる |
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
| フィールド (ライン、ペナルティエリア、ゴール) | field_painter.cpp:108-334 | 2 | 未着手 | 単色の芝 (31,160,31) |
| フラグ (Ctrl+F) | field_painter.cpp:341-575 | 2 | 未着手 | |
| グリッドと座標ラベル | field_painter.cpp:582-674 | 2 | 未着手 | |
| keepaway 領域 | field_painter.cpp:141-151 | 2 | 未着手 | |
| スコアボード (Ctrl+S) | score_board_painter.cpp:78-224 | 2 | 未着手 | PK の o/x 表示を含む |
| チームロゴ | team_graphic_painter.cpp:69-145 | 2 | 未着手 | 倍率の設定あり |
| 選手の外円と体の円、チーム色、キーパーの色 | player_painter.cpp:71-251 | 2 | 未着手 | 22 人すべてを描く (未接続は黒) |
| 状態の色 (kick、tackle、catch、collision、foul、illegal defense) | player_painter.cpp:256-298 | 2 | 未着手 | |
| スタミナの濃淡、effort / recovery の輪 (S で切替) | player_painter.cpp:306-355 | 2 | 未着手 | |
| 体の向きと首の向き | player_painter.cpp:373-406 | 2 | 未着手 | |
| 視野 (V) | player_painter.cpp:413-494 | 2 | 未着手 | 選択選手は 20 / 40 / 60 m の弧 |
| 注視点 | player_painter.cpp:501-521 | 2 | 未着手 | |
| キャッチ範囲 (C) | player_painter.cpp:528-583 | 2 | 未着手 | |
| タックル範囲と確率 (T) | player_painter.cpp:624-704 | 2 | 未着手 | |
| キック加速範囲 (K) | player_painter.cpp:711-877 | 2 | 未着手 | |
| pointto (Ctrl+A) | player_painter.cpp:884-897 | 2 | 未着手 | |
| 背番号、選手タイプ、スタミナのラベル、カード (N、H) | player_painter.cpp:904-1014 | 2 | 未着手 | |
| オフサイドライン (O) | player_painter.cpp:1021-1097 | 2 | 未着手 | |
| ボールと予測軌道 (Ctrl+B) | ball_painter.cpp:79-196 | 2 | 未着手 | |
| 選手の表示切替 (Ctrl+P) | config_dialog.cpp | 2 | 未着手 | |
| 計測ツール (中ボタンでドラッグ) | field_canvas.cpp:240-263, 414-499 | 2 | 未着手 | Shift+ドラッグも加える |
| draw info (v1 の DRAW レコード) | draw_info_painter.cpp | — | 対象外 | バイナリ v1 にしかない |
| ボール・選手の軌跡 | (`#if 0` で無効) | 将来 | 未着手 | |
| アンチエイリアス | options | — | 対象外 | Canvas では常に有効 |

## 4. 表示の操作

| 機能 | rcssmonitor | Phase | 状態 | 備考 |
|---|---|---|---|---|
| 拡大と縮小 (Z、X / Ctrl+Z、×1.5 刻み、1〜400 px/m) | options.cpp:1557-1594 | 2 | 未着手 | |
| 全体表示 (I) | options.cpp:1601-1698 | 2 | 未着手 | |
| ダブルクリックで中心を移動 | field_canvas.cpp:134 | 2 | 未着手 | |
| 左ドラッグで移動 | field_canvas.cpp:214-233 | 2 | 未着手 | |
| フォーカス (B: ボール、P: 選択選手、固定) | field_canvas.cpp:357-381 | 2 | 未着手 | |
| 選手選択 (1〜0、-、Ctrl+数字) | config_dialog.cpp:2540 | 2 | 未着手 | |
| 自動選択 (A、L、R) と解除 (U) | field_canvas.cpp:317-354 | 2 | 未着手 | |
| マウス位置の座標表示 (ステータスバー) | main_window.cpp:2533 | 2 | 未着手 | |
| キャンバスの大きさの指定 | config_dialog.cpp:1570 | 5 | 未着手 | 優先度は低い |

## 5. ログプレイヤー

| 機能 | rcssmonitor | Phase | 状態 | 備考 |
|---|---|---|---|---|
| ログを開く (Ctrl+O) | main_window.cpp:1743-1785 | 3 | 未着手 | ドラッグ＆ドロップも加える |
| JSON rcg、テキスト rcg v4〜v6、gzip | rcss/rcg/parser.cpp:56-131 | 1 | 未着手 | |
| バイナリ rcg v1〜v3 | rcss/rcg/parser_v1〜v3 | 将来 | 対象外 | |
| 読み込みの進捗表示 | rcg_handler.cpp:59-123 | 1 | 未着手 | |
| 再生と停止 (Space) | main_window.cpp:327-473 | 3 | 未着手 | |
| 1 フレーム送りと戻し (←、→、ホイール) | main_window.cpp:1315 | 3 | 未着手 | |
| 速度の変更 (Ctrl+↑ / ↓、5〜5000 ms) | log_player.cpp:229-353 | 3 | 未着手 | |
| 前後の得点へ移動 (G、Ctrl+G) | log_player.cpp:245-291 | 3 | 未着手 | 50 フレーム手前に移動する |
| 先頭と末尾 (Home、End) | main_window.cpp | 3 | 未着手 | |
| フレーム位置のスライダー | log_player_slider.cpp:76-145 | 3 | 未着手 | |
| ループ再生 | disp_holder.cpp:490-551 | 3 | 未着手 | |
| サイクルを指定して移動 | (`goToCycle` は UI なし) | 3 | 未着手 | 入力欄を付ける |
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
| 65,535 フレームを超えるとライブ表示が止まる | disp_holder.cpp:65, 249 | 未着手 |
| JSON の `vq` が bool として扱われる | rcss/rcg/parser_simdjson.cpp:478 | 未着手 |
| JSON の未知のキーで解析全体が中断する | rcss/rcg/parser_simdjson.cpp:85-164 | 未着手 |
| JSON の選手を配列の順に格納している | rcss/rcg/parser_simdjson.cpp:447-525 | 未着手 |
| `foul_push_r` が PM_Null になる | rcss/rcg/util.cpp:854-855 | 未着手 |
| テキスト rcg のチームグラフィックで 16 文字以上の文字列が壊れる | rcss/rcg/parser_v4.cpp:625-709 | 未着手 |
| Change Playmode の back_pass で何も送られない | main_window.cpp:2394-2429 | 未着手 |
| 設定ダイアログの "Fix" が Auto-right になる | config_dialog.cpp:2441 | 未着手 |
| Illegal Defense の色の初期値が Pointto の色 | config_dialog.cpp:1258-1260 | 未着手 |

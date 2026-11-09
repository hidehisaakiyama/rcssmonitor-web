# モニタプロトコルと rcg 形式のメモ

rcssmonitor-web が扱う、rcssserver のモニタ用 WebSocket / JSON プロトコルと、ゲームログ (rcg) の形式をまとめる。

- 出典は asio 版 rcssserver 19.x の作業ツリー (2026-11 時点) と rcssmonitor のソース。
- 参照箇所は `server/` (rcssserver の `src/`) と `monitor/` (rcssmonitor のリポジトリ直下) で示す。
- 行番号は調査時点のもので、変わりうる。

## 1. 接続

| 項目 | 内容 |
|---|---|
| URL | `ws://HOST:WS_PORT/monitor` |
| ポート | `server::ws_port`。既定値は 0 (無効) なので、サーバ起動時に指定が必要 |
| 待ち受け | 全インタフェース (IPv6 デュアルスタック、だめなら 0.0.0.0)。待ち受けアドレスを指定するオプションはない (`server/transport/tcplisten.cpp:94-101`) |
| TLS | なし (`wss://` は使えない) |
| パス | 1 つのポートを `/player` `/monitor` `/coach` `/olcoach` で共用する。クエリ文字列は無視され、パスは完全一致 (`/monitor/` は 404)。`/player` でもモニタとして接続できる |
| 失敗時の HTTP 応答 | アップグレード要求でない: 400、パスが不明: 404、Origin が許可されていない: 403。いずれも `text/plain` の本文を返して切断する (`server/transport/wsconnection.cpp:148-227`) |

### Origin の検査

- `server::ws_allowed_origins` に、カンマ区切りで許可する Origin を並べる。前後の空白とタブは取り除かれ、比較は完全一致 (大文字小文字を区別する)。
- 一覧が空 (既定) なら、どの Origin も受け付ける。Origin ヘッダのない要求も常に受け付ける (`server/transport/wsserver.cpp:67-83`)。
- 拒否したとき、サーバは標準エラーに `refused: 403 Forbidden (path=… origin=…)` と出力する。ブラウザが実際に送った Origin はこれで確かめられる。
- ブラウザ側では `error` に続いて `close` (コード 1006) が起き、WebSocket のフレームは一度も届かない。

### 時間と大きさの制限

| 項目 | 内容 |
|---|---|
| dispinit の期限 | TCP 接続の受け付けから 10 秒以内。HTTP のアップグレードもこの時間に含まれる (`server/transport/pendingconnections.cpp:42`) |
| 受け付け待ちの接続数 | 最大 64 |
| クライアント → サーバ | 1 メッセージ 8192 バイトまで。末尾の NUL / CR / LF を除いて 8191 バイトを超えると切断される (`server/transport/wsconnection.cpp:180, 361-395`) |
| サーバ → クライアント | 送信待ちが 1 MiB を超えると切断される (`server/transport/wsconnection.cpp:49, 322-329`) |
| フレーム | サーバは 1 メッセージを 1 つのテキストメッセージとして送る (末尾に NUL は付かない)。大きなメッセージは分割されることがあるが、ブラウザの API が 1 つにまとめて渡す |
| keepalive | アプリケーション層の ping はない。Beast の既定 (無通信 300 秒、約 150 秒で ping) により、ブラウザが自動で pong を返すので、クライアント側の処理は要らない |
| 切断 | サーバ側から切断するときは close フレームを送らずに TCP を閉じるので、ブラウザでは close コード 1006 になる。クライアントから閉じたときは正常に閉じる |

## 2. 初期化

1. 接続したら `(dispinit version -1)` を送る (`-1.0` でもよい)。`-1` が JSON を表す (`server/stadium.cpp:2938-2939`。シリアライザ、表示送信、初期化送信のファクトリはいずれも `-1` で登録されている)。
2. サーバは次の順に検査する (`server/stadium.cpp:2941-2973`)。
   - `server::max_monitors` に達している → `(error no_more_monitor)`
   - バイナリを通せない接続 (WebSocket は常にそう) で、バージョンが 0 以上 3 未満 → `(error illegal_client_version)`
   - 送信部の設定に失敗 → `(error illegal_client_version)`
3. 受け付けに成功しても、それを知らせる応答はない。最初に届く JSON は `{"server_param":{…}}` になる。

- **エラー応答は JSON ではなく S 式のテキスト**で届く。先頭が `{` でないフレームはエラーとして扱う。
- `/monitor` で最初のメッセージが dispinit でなければ `(error unknown_command)` が返る。接続は受け付け待ちのまま残るので、10 秒以内なら dispinit を送り直せる (`server/stadium.cpp:2801-2804`)。
- ライブのストリームにはサーバのバージョン文字列が含まれない。

## 3. サーバ → モニタのメッセージ

どのメッセージも、最上位のキー 1 つで種類がわかる JSON オブジェクトである。

典型的な順序:

1. `{"server_param":{…}}` を 1 回
2. `{"player_param":{…}}` を 1 回
3. `{"player_type":{"id":0,…}}` をタイプ数 (既定 18) だけ (`server/initsender.cpp:688-722`)
4. 毎ステップ `{"show":{…}}`。before_kick_off と time_over の間も送られる (`server/stadium.cpp:998, 1048-1064`)。show の直後に `team_graphic` が届くことがある (before_kick_off 中は 1 ステップに最大 32 枚、それ以外は 8 枚。`server/monitor.cpp:225-301`)
5. 随時 `{"msg":{…}}`

**ライブでは `playmode` と `team` のメッセージは届かない。** `Monitor::sendPlayMode()` / `sendScore()` (`server/monitor.cpp:189-222`) はどこからも呼ばれない。プレイモードとチーム名・得点は `show` の中で届く。

### 3.1 server_param / player_param

- 形は `{"server_param":{"audio_cut_dist":50,"auto_mode":false,…}}`。キーはアルファベット順。
- 値は整数、`true` / `false`、実数、文字列。`Record<string, number | boolean | string>` として扱い、既定値表と合わせて使う。
- `tcp_port`、`ws_port`、`ws_allowed_origins`、`max_monitors` なども含まれる。
- 審判操作の可否は `coach` と `coach_w_referee` で判断する (§6)。
- 項目が欠けたときの既定値は `src/core/param-defaults.ts` に置く。asio 版 rcssserver 19.0.0 を既定の設定で起動し、JSON モニタとして受け取った値を使った (起動時に指定した `ws_port` と、起動ごとに変わる `random_seed` は設定上の既定値 0 と -1 に直した)。
  - rcssmonitor の表 (`monitor/rcss/rcg/types.cpp:547-760`) は古く、`player_speed_max` (1.2)、`stamina_max` (4000) など約 40 項目が今のサーバと違う。`effort_inc` は対応表にない。

### 3.2 player_type

```json
{"player_type":{"id":0,"player_speed_max":1.05,"stamina_inc_max":45,"player_decay":0.4,
 "inertia_moment":5,"dash_power_rate":0.006,"player_size":0.3,"kickable_margin":0.7,
 "kick_rand":0.1,"extra_stamina":50,"effort_max":1,"effort_min":0.6,"kick_power_rate":0.027,
 "foul_detect_probability":0.5,"catchable_area_l_stretch":1, …}}
```

観測距離に関する項目 (`unum_far_length` など) も含まれる。`dist_noise_rate`、`focus_dist_noise_rate`、`land_dist_noise_rate`、`land_focus_dist_noise_rate` は v19 で加わった (`server/heteroplayer.cpp:420-490`)。

### 3.3 show (ライブ)

```json
{"show":{"time":1,"mode":"kick_off_l",
 "team":{"l":{"name":"HELIOS2023","score":0},"r":{"name":"CYRUS","score":0}},
 "ball":{"x":0,"y":0,"vx":0,"vy":0},
 "players":[
  {"side":"l","unum":1,"type":0,"state":9,"x":-49,"y":0,"vx":0,"vy":0,"body":-124.215,"neck":0,
   "vq":"h","vw":180,"fdist":0,"fdir":0,"stamina":8000,"effort":1,"recovery":1,"capacity":130600},
  {"side":"r","unum":3,"type":2,"state":1,"x":15,"y":20,"vx":0,"vy":0,"body":-88.836,"neck":-46,
   "px":-34.4735,"py":27.237,"vq":"h","vw":180,"fdist":0,"fdir":0,"stamina":8000,"effort":0.869862,
   "recovery":1,"capacity":130600,"fside":"r","fnum":6}
 ]}}
```

(コードと実際のログの値から組み立てた例。`players` は実際には 22 要素ある。)

**最上位の項目**

| 項目 | 型 | 内容 |
|---|---|---|
| `time` | int | サイクル |
| `stime` | int | 中断中に進むサイクル。**0 より大きいときだけ含まれる**。before_kick_off と time_over の間は `time` が止まり `stime` が進む (`server/stadium.cpp:922-969`) |
| `mode` | string | プレイモード (§5.2) |
| `team.l`、`team.r` | object | `{name: string \| null, score: int, pen_score?: int, pen_miss?: int}`。チームが接続する前は `name` が `null`。`pen_*` は PK を蹴ったチームにだけ付く |
| `ball` | object | `{x, y, vx, vy}` |
| `players` | array | 常に 22 要素。左の 1〜11、右の 1〜11 の順 |

フレームの並びは `(time, stime)` で決まる。

**選手の項目** (出力順)

| 項目 | 型 | 内容 |
|---|---|---|
| `side` | `"l"` / `"r"` | |
| `unum` | int | 背番号 |
| `type` | int | 選手タイプ id |
| `state` | int | 状態のビット列 (§5.1)。JSON では 10 進数 |
| `x` `y` `vx` `vy` | number | 位置と速度 |
| `body` | number | 体の向き (絶対角、度、-180〜180) |
| `neck` | number | 首の向き (体に対する相対角、度) |
| `px` `py` | number、任意 | 指さし中だけ付く。指している点の絶対座標 |
| `vq` | `"h"` / `"l"` | 視覚の質 |
| `vw` | number | 視野角の全幅 (度。60 / 120 / 180 など) |
| `fdist` `fdir` | number | 注視点。位置 + 極座標 (fdist, body + neck + fdir) (`server/player.cpp:2609-2610`) |
| `stamina` `effort` `recovery` `capacity` | number | |
| `fside` `fnum` | 任意 | attentionto の対象。選手が有効で対象があるときだけ付く |

- ライブの show には**コマンド回数がない** (`server/dispsender.cpp:592` で出力がコメントアウトされている)。
- 接続していない選手も `state: 0` で含まれ (カードのビットは残ることがある)、`x = -(unum * 3 * side)`、`y = -37` に置かれる (`server/player.cpp:462-489`)。

**座標系**

- x はピッチの長手方向、y は画面で下向きが正。角度は画面上で時計回りに増える。
- ピッチの寸法 (105 × 68 など) は定数で、server_param には含まれない。

**数値の精度**

- 量子化は `rint(v / q) * q` で行う。位置、速度、`px` `py` `fdist` は 0.0001 単位、`body` `neck` `vw` `fdir` は 0.001 単位。`stamina` などは量子化されない。
- ostream の既定書式 (有効数字 6 桁) で出力される。整数値には小数点が付かず、`-0` も現れる。大きな値は `1.3e+06` のような指数表記になりうる。
- `(time, stime)` が変わらなければ、サーバは同じ文字列をもう一度送る。

### 3.4 msg

```json
{"msg":{"time":0,"stime":57,"board":1,"message":"(error illegal_command_form)"}}
```

- ライブでは `board` は常に 1 (MSG_BOARD)。ログでは 2 (LOG_BOARD) も使われる。
- 中身の例:
  - モニタのコマンドへの応答: `(error …)`、`(warning compression_unsupported)`、`(ok …)`
  - `(change_player_type l 3 5)`、`(change_player_type l 1 goalie)` (常に送られる)
  - `server::send_comms` が有効なときだけ: `(referee foul_l)`、`((player TEAM 3) text)`、`(online_coach_left …)`

### 3.5 team_graphic

```json
{"team_graphic":{"side":"l","x":31,"y":7,"xpm":["8 8 1 1","  c None","        ", …]}}
```

- 1 枚が 8 × 8 の XPM タイル。並びは x < 32、y < 8 (全体で最大 256 × 64)。
- XPM の 1 行目は `"W H C CPP"` の形に正規化され、タブは空白に置き換えられる。
- サーバは範囲外の x、y を警告するだけなので、クライアント側で範囲を検査する (`server/coach.cpp:1821-1825`)。
- タイルはモニタごとに 1 回ずつ送られる。

### 3.6 JSON として壊れている可能性

- 文字列のエスケープは `"` と `\` だけで、制御文字はそのまま出力される。コーチの発言などに改行が入ると不正な JSON になる。
- UTF-8 として不正なバイト列がテキストフレームに入ると、ブラウザは接続を閉じる。
- `JSON.parse` は try/catch で包み、壊れたフレームは読み飛ばす。

## 4. ログの show とライブの show の違い

| 項目 | ライブ | JSON rcg |
|---|---|---|
| `mode`、`team` | あり | なし (直前の `playmode` / `team` レコードを使う) |
| `fdist`、`fdir` | あり | なし |
| コマンド回数 | なし | あり (`kick` `dash` `turn` `catch` `move` `turn_neck` `change_view` `say` `tackle` `pointto` `attentionto` `change_focus`) |
| before_kick_off のフレーム | 送られる | 記録されない。time_over も 1 フレームだけ (`server/logger.cpp:756-811`) |

## 5. 定数

### 5.1 選手の状態ビット

`server/types.h:47-70`、`monitor/rcss/rcg/types.h:235-258`。

| ビット | 値 | ビット | 値 |
|---|---|---|---|
| DISABLE | 0x0 | BALL_COLLIDE | 0x400 |
| STAND | 0x1 | PLAYER_COLLIDE | 0x800 |
| KICK | 0x2 | TACKLE | 0x1000 |
| KICK_FAULT | 0x4 | TACKLE_FAULT | 0x2000 |
| GOALIE | 0x8 | BACK_PASS | 0x4000 |
| CATCH | 0x10 | FREE_KICK_FAULT | 0x8000 |
| CATCH_FAULT | 0x20 | POST_COLLIDE | 0x10000 |
| BALL_TO_PLAYER | 0x40 | FOUL_CHARGED | 0x20000 |
| PLAYER_TO_BALL | 0x80 | YELLOW_CARD | 0x40000 |
| DISCARD | 0x100 | RED_CARD | 0x80000 |
| LOST | 0x200 | ILLEGAL_DEFENSE | 0x100000 |

- 各ステップの後、サーバは STAND、GOALIE、DISCARD、カードのビットだけを残す。KICK、KICK_FAULT、TACKLE、TACKLE_FAULT、FOUL_CHARGED は動作が続いている間だけ残る (`server/player.cpp:436-457`)。
- JSON では 10 進数、テキスト形式では `0x` 付きの 16 進数 (ただし 0 は `0`) で書かれる。
- rcssmonitor の述語 (`monitor/rcss/rcg/types.h:937-1081`): `isAlive()` は `state != 0`。`isKicking()`、`isCatching()`、`isTackling()` は対応する FAULT ビットが立っていないときだけ真。`isCollidedBall()` は BALL_COLLIDE、BALL_TO_PLAYER、PLAYER_TO_BALL のいずれか。

### 5.2 プレイモード

番号は enum の値で、文字列表の添字と同じ (`server/types.h:78-187`、`monitor/rcss/rcg/types.h:60-172`)。

| # | 文字列 | # | 文字列 | # | 文字列 |
|---|---|---|---|---|---|
| 0 | `""` | 1 | before_kick_off | 2 | time_over |
| 3 | play_on | 4 | kick_off_l | 5 | kick_off_r |
| 6 | kick_in_l | 7 | kick_in_r | 8 | free_kick_l |
| 9 | free_kick_r | 10 | corner_kick_l | 11 | corner_kick_r |
| 12 | goal_kick_l | 13 | goal_kick_r | 14 | goal_l |
| 15 | goal_r | 16 | drop_ball | 17 | offside_l |
| 18 | offside_r | 19 | penalty_kick_l | 20 | penalty_kick_r |
| 21 | first_half_over | 22 | pause | 23 | human_judge |
| 24 | foul_charge_l | 25 | foul_charge_r | 26 | foul_push_l |
| 27 | foul_push_r | 28 | foul_multiple_attack_l | 29 | foul_multiple_attack_r |
| 30 | foul_ballout_l | 31 | foul_ballout_r | 32 | back_pass_l |
| 33 | back_pass_r | 34 | free_kick_fault_l | 35 | free_kick_fault_r |
| 36 | catch_fault_l | 37 | catch_fault_r | 38 | indirect_free_kick_l |
| 39 | indirect_free_kick_r | 40 | penalty_setup_l | 41 | penalty_setup_r |
| 42 | penalty_ready_l | 43 | penalty_ready_r | 44 | penalty_taken_l |
| 45 | penalty_taken_r | 46 | penalty_miss_l | 47 | penalty_miss_r |
| 48 | penalty_score_l | 49 | penalty_score_r | 50 | illegal_defense_l |
| 51 | illegal_defense_r | | | | |

- テキスト形式のライブ show の `(pm N)` はこの番号で書かれる。
- rcssmonitor の文字列 → enum 変換には、`foul_push_r` が PM_Null になる不具合がある (`monitor/rcss/rcg/util.cpp:854-855`)。

### 5.3 その他

- Side: LEFT = 1、NEUTRAL = 0、RIGHT = -1。
- ピッチ寸法 (`monitor/src/options.cpp:72-91`):

  | 項目 | 値 |
  |---|---|
  | 長さ × 幅 | 105 × 68 |
  | 外側の余白 | 5 |
  | センターサークル半径 | 9.15 |
  | ペナルティエリア | 16.5 × 40.32 |
  | ペナルティアーク半径 | 9.15 |
  | ペナルティスポットまでの距離 | 11 |
  | ゴール幅 | 14.02 |
  | ゴールエリア | 5.5 × 18.32 |
  | ゴールの奥行き | 2.44 |
  | コーナーアーク半径 | 1 |
  | ゴールポスト半径 | 0.06 |

- keepaway 領域だけは server_param から決める。

## 6. モニタ → サーバのコマンド

`server/monitor.cpp:338-761`。先頭のコマンド名は完全一致で比べられるので、前に空白を入れない。末尾の NUL / CR / LF は WebSocket の層で取り除かれる。

| コマンド | 形式 | 内容 |
|---|---|---|
| 切断 | `(dispbye)` | 接続を閉じる (close フレームは送られない) |
| キックオフ | `(dispstart)` | 前後半の境目 (`time % half_time == 0`) でだけ働く。keepaway モードでは play_on にする。応答はない (`server/stadium.cpp:1157-1215`) |
| フリーキック / ドロップボール | `(dispfoul X Y SIDE)` | 整数。位置は X/16、Y/16 メートル。SIDE は 1 で左のフリーキック、-1 で右のフリーキック、0 でドロップボール。PK 戦の間は無視される (`server/stadium.cpp:1259-1302`) |
| 選手の移動 | `(dispplayer SIDE UNUM X Y ANG)` | 整数。位置は X/16、Y/16。**ANG は 16 倍しない整数の度** (`server/monitor.cpp:458-460`)。速度は 0 になる |
| 退場 | `(dispdiscard SIDE UNUM)` | |
| カード | `(dispcard SIDE UNUM yellow\|red)` | |
| 圧縮 | `(compression N)` | WebSocket では常に `(warning compression_unsupported)` |

**coach モード** (`server::coach` または `server::coach_w_referee`) のときだけ受け付けるもの。それ以外では `(error illegal_command_form)` が返る。

- `(start)`
- `(change_mode <mode>)`
- `(move (ball) x y [vx vy])`
- `(move (player TEAM N) x y [ang [vx vy]])` (実座標のメートルと度)
- `(recover)`
- `(check_ball)`。応答は `(ok check_ball T in_field|goal_l|goal_r|out_of_field)`

注意:

- **`dispcard` / `dispdiscard` を送る前に unum が 1〜11 かを必ず確かめる。** サーバの `getPlayer()` は範囲を検査せずに配列を引くので、範囲外の値はサーバを落としうる (`server/stadium.cpp:1131-1153`)。
- 権限の区別はない。受け付けられたモニタはどれも `disp*` コマンドをすべて使える。
- `change_player_type` は比較文字列に `(` が欠けているため到達できない (`server/monitor.cpp:392`)。
- rcssmonitor が実際に送っているのは `(dispinit version N)`、`(dispbye)`、`(dispstart)`、`(dispfoul …)`、`(dispcard …)`、`(change_mode …)`、`(move (ball) …)` (`monitor/src/monitor_client.cpp:388-715`)。

## 7. JSON rcg (`game_log_version = -1`)

**ファイルの構造** (`server/initsenderlogger.cpp:545-597`、`server/dispsender.cpp:1066-1131`)

- `[` と改行で始まり、レコードを 1 行に 1 つずつ書いて `,` と改行で区切り、改行と `]` と改行で終わる。
- サーバが異常終了すると末尾の `]` が欠ける。行単位で読み、`[` と `]` の行を飛ばし、行末の `,` を取り除けば、どちらの場合も読める。

**レコードの種類** (サンプル `1-json.rcg.gz` の件数)

| レコード | 件数 | 内容 |
|---|---|---|
| `{"version":"18.1.3"}` | 1 | サーバのバージョン (プロトコルのバージョンではない) |
| `{"timestamp":"2024-03-19T18:13:33+0900"}` | 1 | `%FT%T%z` 形式。オフセットにコロンがないので `Date.parse` では読めない |
| `server_param`、`player_param` | 各 1 | ライブと同じ |
| `player_type` | 18 | ライブと同じ |
| `team_graphic` | 256 | ライブと同じで time を持たない。before_kick_off の間に受け付けたものなので、最初の show より前に並ぶ |
| `{"playmode":{"time":1,"mode":"kick_off_l"}}` | 40 | 変化したときだけ。`stime` は任意 |
| `{"team":{"time":1,"l":{…},"r":{…}}}` | 2 | 変化したときと最後に 1 回。`stime` と `pen_*` は任意 |
| `show` | 6209 | §4 を参照 |
| `msg` | 1 | 最後の `(result …)`。ほかのメッセージは `record_messages` が有効なときだけ記録される |

- rcssmonitor の JSON パーサ (`monitor/rcss/rcg/parser_simdjson.cpp`) は移植の参考になる。ただし次の点は直す。
  - 未知のキーで解析全体を止めている。
  - `vq` を bool として扱っている (:478)。
  - 選手を配列の順に格納している。side と unum で格納するべき。

## 8. テキスト rcg (v4〜v6)

| 版 | 1 行目 | show の形式 (モニタプロトコルの版) |
|---|---|---|
| v4 | `ULG4` | v3 |
| v5 | `ULG5` | v4。スタミナに capacity が加わる |
| v6 | `ULG6` | v5。`(fp …)` と 12 個目のコマンド回数 (change_focus) が加わる |

形式は先頭 4 バイトで判定する (`monitor/rcss/rcg/parser.cpp:56-131`)。

- 1 文字目が `[` なら JSON。
- `ULG` に続く文字が `4` / `5` / `6` ならテキスト。
- `ULG` に続くバイトが 2 / 3 ならバイナリ (対象外)。
- それ以外はバイナリ v1 (対象外)。

gzip かどうかは、その前に先頭の `1f 8b` で判定する。

**各行の形式**

```
(server_param (name value)…)          真偽値は 0/1、文字列は "…"
(player_param (name value)…)
(player_type (id N)(name value)…)
(playmode T mode)
(team T nameL nameR scoreL scoreR [penScoreL penMissL penScoreR penMissR])
(msg T BOARD "text")
(show T ((b) x y vx vy) ((l 1) TYPE STATE x y vx vy body neck [px py] (v h|l VW) [(fp dist dir)] (s sta eff rec [cap]) [(f l|r N)] (c counts…)) …)
```

**解析の注意** (`monitor/rcss/rcg/parser_v4.cpp:172-709` を移植する)

- `STATE` は `0x` 付きの 16 進数 (0 は `0`)。
- `px py` は省略されうる。有無は、次のトークンが `(v` かどうかで判断する。
- コマンド回数は 11 個または 12 個。
- `stime` がない。中断中は同じ `T` の show 行が繰り返される (サンプルでは 30〜51 回)。繰り返しの回数を `stime` とみなす。
  - 同じ `T` の n 回目 (0 から数える) の show に `stime = n` を割り当てる。playmode / team / msg 行には、同じ `T` の次の show と同じ値を割り当てる。
  - JSON rcg では、中断が始まる cycle の `stime` 0 の show はまだ中断前のプレイモードで、playmode レコードは `stime` 1 で書かれる (`1-json.rcg.gz` の 1746: play_on の show の後に `foul_charge_l` の show が 30 件)。
  - テキスト rcg の例 (`202207160432-…rcg.gz` の 789 の `offside_r` と 6713 の `goal_l`) では、playmode 行がその cycle の最初の show 行より前にあり、同じ cycle の show はすべて新しいプレイモードになる。JSON の例との違いが形式によるものか、判定された step (通常の step か中断中の step か) によるものかは確かめていない。いずれにしても、テキストからは `stime` 0 の show が中断前のものかどうかを区別できない。
- ライブのテキスト形式の show には、時刻の直後に `(pm N)` と `(tm L R SL SR …)` が入る。ログの show にはない。
- チームグラフィックは msg 行に入っていて、引用符が入れ子になっている。閉じ括弧の対応も崩れている。

  ```
  (msg 0 1 "(team_graphic_l (31 7 "8 8 1 1" "  c None" "        " … ))")
  ```

  rcssmonitor は `%15[^"]` で読んでいるため、16 文字以上の文字列が壊れる。移植では長さを制限しない。
- チーム名 `null` は空文字列として扱う。rcssmonitor は、show 行の `(tm …)` ではそうしているが、単独の team 行ではしていない。

## 9. ブラウザ側の制約 (Phase 0 の検証結果)

### 検証の条件

| 項目 | 内容 |
|---|---|
| 実施日 | 2026-11-07 |
| 検証ページ | `spike/browser-check.html` (ビルド不要の 1 ファイル) |
| サーバ | asio 版 rcssserver 19.0.0。`server::ws_port=16080`。同じマシン (Linux) で起動 |
| ブラウザ | Chrome 157、Firefox 157.0.1 (snap)。どちらも headless |
| 接続先 | `ws://localhost:16080/monitor` と、自マシンの LAN アドレス `ws://192.168.64.93:16080/monitor` |

### file:// で開いた場合

| 項目 | Chrome 157 | Firefox 157 |
|---|---|---|
| `self.origin` | `null` | `null` |
| `isSecureContext` | true | true |
| localStorage | 使える | 使える |
| DecompressionStream | 使える | 使える |
| Blob URL の classic Worker (Worker 内の DecompressionStream を含む) | 使える | 使える |
| Blob URL の module Worker | **起動しない** | 使える |
| `ws://localhost` に接続して show まで受信 | できる | できる |
| `ws://<LAN アドレス>` に接続して show まで受信 | できる | できる |
| ハンドシェイクで送る Origin ヘッダ | `null` | `null` |

**わかったこと**

- **単一 HTML 版の Worker は classic 形式 (IIFE) でインライン化する** (Vite の `worker.format: 'iife'`)。module 形式では Chrome で起動しない。
  - この設定で作った単一 HTML を file:// で開き、Worker の中で gzip を展開して形式を判定するところまでを、Playwright の E2E テスト (`test/e2e/load-file.spec.ts`) で確かめた。Chromium (Chrome for Testing 156) と Firefox 157 の両方で通る。
- `server::ws_allowed_origins` を設定するサーバに file:// から接続するには、一覧に `null` を加える必要がある (`server::ws_allowed_origins='null'`)。拒否されたとき、サーバのログは `refused: 403 Forbidden (path=/monitor origin=null)` となり、ブラウザ側では close コード 1006 で、フレームは 1 つも届かない。
- rcssserver のコマンドラインで文字列の値を渡すときは、引用符で囲む (`"server::ws_allowed_origins='http://example.invalid'"`)。囲まないと `://` の所で解析エラーになり、サーバが起動しない。

### https のページから ws:// に接続した場合 (Chrome 157 のみ)

自己署名証明書と `--ignore-certificate-errors` で試した。

| ページの場所 | `ws://localhost` | `ws://<LAN アドレス>` |
|---|---|---|
| `https://localhost:18443` | 接続できる。警告なし | 接続できる。コンソールに Mixed Content の警告 |
| `https://192.168.64.93:18443` | 接続できる。警告なし | 接続できる。コンソールに Mixed Content の警告 |

警告の文面: `This endpoint should be available via WSS. Insecure access is deprecated.`

- 現在の Chrome は、ページ自身がローカルや LAN にあれば、https から LAN の `ws://` への接続を警告だけで許している。しかし廃止予定と明示されているので、これに頼らない。
- GitHub Pages のような公開オリジンからの接続は、この検証では再現できていない。Chrome の Local Network Access の許可も関わる。
- 方針は変えない。Pages 版は localhost への接続とログ再生用、LAN 内の接続には単一 HTML 版を使う。

### 未確認事項

- Firefox で https のページから `ws://` に接続した場合。Firefox は既定で、https から localhost 以外への `ws://` を遮断するはず。
- 公開オリジン (GitHub Pages) から `ws://localhost` / LAN に接続した場合。Chrome の Local Network Access の許可プロンプトが出るかどうか。
- Safari、Windows / macOS 版のブラウザ。
- 実際に別のマシンから LAN 越しに接続した場合。今回は同じマシンの LAN アドレスで代用した。

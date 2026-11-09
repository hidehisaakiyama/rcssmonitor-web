# テスト用フィクスチャ

全長の試合ログから、ヘッダ部分といくつかのサイクル区間だけを切り出したもの。`tools/fixtures/make_fixtures.py` で生成する。生成は決定的なので、同じ元ログからは同じバイト列ができる。

```sh
python3 -I tools/fixtures/make_fixtures.py \
  1-json.rcg.gz 202207160432-HELIOS2022_1-vs-CYRUS_0.rcg.gz test/fixtures
```

各区間の始まりでは、その直前の `playmode` / `team` レコードを補って出力する。そのため、どのフレームも元のログと同じプレイモードとスコアを持つ。一方で、区間と区間の間のサイクルは抜けている。

## json-sample.rcg.gz

| 項目 | 内容 |
|---|---|
| 元ログ | `1-json.rcg.gz` (rcssserver 18.1.3、`game_log_version = -1`、HELIOS2023 0-0 CYRUS) |
| 区間 | 1–200、1740–1760 (1746 の foul_charge_l で `stime` が進む)、2995–3005 (後半のキックオフ)、5995–6000 (time_over と結果の msg) |
| レコード数 | 557 件。version 1、timestamp 1、server_param 1、player_param 1、player_type 18、team_graphic 256、playmode 9、team 2、show 267、msg 1 |
| 大きさ | 展開後 2,335,974 バイト、gzip 後 246,429 バイト |

## text-v5-sample.rcg.gz

| 項目 | 内容 |
|---|---|
| 元ログ | `202207160432-HELIOS2022_1-vs-CYRUS_0.rcg.gz` (ULG5、延長戦あり、HELIOS2022 1-0 CYRUS) |
| 区間 | 1–200、785–795 (789 の offside_r で show 行が 30 回繰り返される)、6705–6720 (6713 の goal_l、show 行が 51 回繰り返される、スコアが 1-0 になる)、7995–8000 (time_over と結果の msg) |
| 行数 | ULG5 1、server_param 1、player_param 1、player_type 18、msg 513 (うちチームグラフィック 512)、playmode 10、team 3、show 312 |
| 大きさ | 展開後 1,117,172 バイト、gzip 後 242,539 バイト |

## json-pk.rcg.gz、text-v5-pk.rcg.gz (合成した PK 戦)

元のログ 2 本とも PK 戦がないので、上の 2 つのフィクスチャから合成した。`tools/fixtures/make_pk_fixtures.py` で生成する (生成は決定的)。

```sh
python3 -I tools/fixtures/make_pk_fixtures.py test/fixtures
```

| 項目 | 内容 |
|---|---|
| 素材 | json-sample / text-v5-sample のヘッダ (version、パラメータ、選手タイプ。チームグラフィックは除く) と、最後の show |
| 流れ | 5998〜5999 が play_on、6000 から PK 戦 (左から交互に 5 本ずつ)、6040 が time_over |
| 結果 | 左 o x o o o (4)、右 o o x o x (3) |
| フレーム | 1 本につき penalty_setup / ready / taken / score または miss を 1 フレームずつ。show は全部で 43 件 |
| team レコード | penalty_score / penalty_miss の直後に、更新した PK の得点と失敗数を書く。JSON では PK を蹴ったチームにだけ `pen_score` / `pen_miss` を付ける |

選手とボールの位置は素材の show のままで、PK らしい配置にはなっていない。

## live-before-kickoff.jsonl (ライブの JSON メッセージ)

asio 版 rcssserver 19.0.0 (`feature/asio-migration`) を `server::ws_port` だけ指定して起動し、`(dispinit version -1)` で接続して受け取った最初の 22 メッセージ。1 行が 1 メッセージ。

- server_param、player_param、player_type 18 件、show 2 件 (before_kick_off、チーム未接続)。
- `ws_port` (16081) と `random_seed` はこの起動のときの値。

取得するときの注意: このサーバは環境変数 `HOME` を変えても、実際のホームの `~/.rcssserver/` に設定ファイル (`server.conf`、`player.conf`、`CSVSaver.conf`) がなければ作る。

## fonts/ (テスト用フォント)

DejaVu Sans と DejaVu Sans Bold の ASCII 部分集合 (WOFF)。E2E のスクリーンショット回帰テストで全フォントをこれに切り替え、環境に依存しない画像にする。作り方とライセンスは `fonts/LICENSE.txt`。

## full/ (全長ログ、コミットしない)

`test/unit/full-logs.test.ts` と E2E テストは、ここに全長ログ (またはそのシンボリックリンク) があるときだけ実行される。`.gitignore` で除外している。

- `full/1-json.rcg.gz` (show 6,209 件)
- `full/202207160432-HELIOS2022_1-vs-CYRUS_0.rcg.gz` (show 8,406 件)

## 含まれていないもの

- テキスト rcg v4 / v6: 必要になったら同じスクリプトで作る。v4 / v6 に固有の書式 (capacity なし、`(fp …)`、12 個目のコマンド回数) は単体テストの中の行で確かめている。

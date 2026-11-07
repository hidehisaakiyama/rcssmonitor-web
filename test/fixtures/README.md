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

## 含まれていないもの

- PK 戦: 元のログ 2 本とも PK 戦がない。PK の表示を確かめるフィクスチャは Phase 1 で合成する。
- テキスト rcg v4 / v6: 必要になったら同じスクリプトで作る。

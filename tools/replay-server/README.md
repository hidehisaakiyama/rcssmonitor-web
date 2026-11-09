# 擬似サーバ (replay server)

ゲームログを、rcssserver が `server::ws_port` で配信するのと同じ形でモニタに流す、開発とテスト用のサーバ。モニタから届いたコマンドを記録し、標準出力に書く。

```sh
npm run replay-server -- [オプション] LOG
```

| オプション | 内容 |
|---|---|
| `--port N` | 待ち受けるポート (既定 6080) |
| `--host ADDRESS` | 待ち受けるアドレス (既定: すべてのインタフェース。rcssserver と同じ) |
| `--path PATH` | 要求パス (既定 `/monitor`)。ほかのパスは 404 |
| `--interval MS` | show 1 件あたりのミリ秒 (既定 100) |
| `--loop` | ログの末尾で先頭に戻る。付けなければ末尾で接続を閉じる |
| `--coach` / `--no-coach` | coach モード (`change_mode` と `move` を受け付ける) を入れる / 切る。既定はログの `server_param` の `coach` / `coach_w_referee` のとおり |
| `--allowed-origins LIST` | `server::ws_allowed_origins` と同じ (カンマ区切り) |
| `--max-monitors N` | `server::max_monitors` と同じ |

ログは JSON でもテキスト (v4〜v6) でもよく、gzip のままでも読める。読み込みにはアプリと同じパーサを使う。TypeScript で書いてあるので、`cli.mjs` が Vite のモジュールランナーで読み込む。

## rcssserver に合わせたこと

- 接続後に `(dispinit version -1)` を受けると、`server_param`、`player_param`、`player_type` を送り、その後は show を 1 件ずつ送る。show には `mode` と `team` を入れ、コマンド回数は入れない (ライブの show と同じ)。
- `team_graphic` と `msg` は、それぞれの step の show の後に送る。最初の show より前にあるもの (チームロゴなど) は、最初の show の後に送る。
- dispinit への拒否 (`(error unknown_command)`、`(error illegal_client_version)`、`(error no_more_monitor)`) は S 式で返し、接続は保留のまま残す。10 秒以内に dispinit が来なければ閉じる。JSON 以外の版 (`version` が 0 以上) は受け付けない。
- `(dispbye)` を受けたとき、ログの末尾、`dropMonitors()` のときは、close フレームを送らずに閉じる (ブラウザでは close コード 1006)。
- coach モードでないときの `change_mode` / `move` などには、msg で `(error illegal_command_form)` を返す。coach モードなら `(ok change_mode)` や `(ok move)` を返す。
- パスが違えば 404、Origin が許可されていなければ 403 を、HTTP の応答として返す。

## rcssserver と違うこと

- 試合を進めない。ログを再生するだけで、コマンドは記録して応答を返すだけで、試合には反映しない。
- モニタごとに、ログの先頭から再生する (本物のサーバは 1 つの試合を全員に送る)。

## テストからの使い方

`ReplayServer` を直接使う (`test/unit/replay-server.test.ts`、`test/unit/live-client.test.ts`、`test/e2e/live.spec.ts`)。

```ts
const server = await ReplayServer.fromFile('test/fixtures/json-sample.rcg.gz', {
  host: '127.0.0.1',
  interval: 20,
});
const port = await server.listen(); // 0 番: 空いているポート
// ... モニタを ws://127.0.0.1:${port}/monitor に接続する
server.commands; // [{ monitor: 1, text: '(dispstart)' }, ...]
server.pause(); // show を止める (無通信のタイムアウトの試験)
server.dropMonitors(); // サーバが落ちたときと同じく接続を閉じる
await server.close();
```

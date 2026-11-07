# browser-check.html

ブラウザ版モニタに必要なブラウザの機能を確かめる、ビルド不要の検証ページ。結果は `docs/protocol.md` の §9 に記録する。

確かめる項目:

- localStorage
- DecompressionStream
- Blob URL から作る Worker (classic 形式と module 形式)
- WebSocket での接続。`(dispinit version -1)` を送り、最初の show を受け取るまで

## 手動で確かめる手順

1. サーバ側のマシンで、WebSocket を有効にして rcssserver を起動する。

   ```sh
   rcssserver server::ws_port=6080
   ```

2. 別のマシンで `browser-check.html` を保存し、ブラウザで開く (file://)。
3. 「WebSocket targets」に `ws://<サーバの IP>:6080/monitor` を入れ、「Run checks」を押す。
4. 表の結果と、下に出る JSON を記録する。

## 未確認で、確かめてほしいもの

- 別のマシンから LAN 越しに接続できるか (Chrome、Firefox)。
- Safari (macOS) で file:// から開いた場合。
- Firefox で、https のページから `ws://` に接続できるか。

## 自動実行

`?auto=1&targets=ws://…,ws://…&report=http://127.0.0.1:PORT/` を付けて開くと、読み込み後にすべての検査を実行する。結果は次の 3 か所に出る。

- `report` で指定した URL に POST する。
- コンソールに `BROWSER-CHECK-REPORT {…}` と出力する。
- ページ内の `<pre id="result">` に表示する。

headless の Chrome / Firefox から実行するときに使う。

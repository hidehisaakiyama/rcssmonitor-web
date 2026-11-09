# rcssmonitor との描画の比較

rcssmonitor (Qt 版) と rcssmonitor-web に同じフレームを描かせ、画像を並べて比べるための道具。画面 (X / Wayland) は使わない。

## 必要なもの

- ビルド済みの rcssmonitor と、Qt 5 の `vnc` プラットフォームプラグイン (`libqvnc.so`)
- Python 3 (標準ライブラリのみ)
- rcssmonitor-web の単一 HTML のビルド (`npm run build:single`) と Playwright の Chromium

## 手順

1. rcssmonitor の画面を取得する。

   ```sh
   RCSSMONITOR=/path/to/rcssmonitor tools/parity/capture.sh test/fixtures/json-sample.rcg.gz qt.png 'Right*150,5,v'
   ```

   - rcssmonitor を `QT_QPA_PLATFORM=vnc` で起動し、`rfb_snapshot.py` が VNC で画面を取得する。
   - `HOME` を新しい一時ディレクトリにするので、rcssmonitor は既定の設定で動き、`~/.rcssmonitor.conf` は読みも書きもしない。
   - 3 番目の引数は、取得の前に押すキー。`Right*150` で 150 フレーム進め、`5` で左 5 番を選び、`v` で視野を表示する。`ctrl+f` のように修飾キーも使える。
   - 環境変数 `RCSSMONITOR_ARGS` で rcssmonitor のオプションを足せる (例: `"--grid-step 10 --show-grid-coord on"`)。

2. 同じ場面を rcssmonitor-web で描き、比べる。

   ```sh
   node tools/parity/compare.mjs --ref qt.png --log test/fixtures/json-sample.rcg.gz --out out \
     --frame 150 --select 5 --options '{"showViewArea":true}' --font IPAGothic --crop 560,480,120,80
   ```

   - rcssmonitor の画像からツールバーの下のキャンバス部分を見つけ、同じ大きさで Web 版を描く。
   - `out/compare-web.png` (Web 版)、`out/compare-side.png` (左上 rcssmonitor、右上 Web 版、左下 差分、右下 重ね合わせ)、`--crop` を付けると拡大した切り出しを書き出す。
   - `--actions zoomIn,toggleFocusBall` のように `ViewState` のメソッドを順に呼べる (引数は `toggleAutoSelect:autoAll` の形)。
   - `--font` で Web 版の全フォントを指定する。下記のとおり、Qt はフォントの寸法を「Sans Serif」に当たるフォントから取るので、同じフォントにしないとレイアウトが 1 ピクセルずれることがある。

## 比較の結果 (2026-11-09、Phase 2)

1000 × 720 のウインドウ (キャンバスは 1000 × 677)、rcssmonitor 19.0.1 (Qt 5)、Chromium で比べた。色の差が 48 を超える画素の割合は 1.1〜1.8% で、残る違いは次のものだけだった。

| 場面 | 内容 |
|---|---|
| json-sample の最初のフレーム | 既定の表示 |
| json-sample のフレーム 150 | 左 5 番を選択、視野、スタミナ、タックル範囲、キャッチ範囲、オフサイドライン、フラグ、キック加速範囲、pointto、選手タイプ |
| json-sample のフレーム 251 | イエローカード |
| json-sample のフレーム 42 | 3 回拡大してボールを追う |
| json-sample のフレーム 100 | グリッド (10 m、座標つき)、keepaway 領域、ボールの実寸、選手の大きさ 1.5 m |
| text-v5-sample のフレーム 250 | 得点の直後 (1:0)、両チームのロゴ、自動選択、視野 |
| json-pk のフレーム 30 | PK 戦のスコアボード (`|oxoo :oox  |`) |

**一致したもの**: 拡大率と中心 (画素単位)、ライン、ゴール、円と円弧、フラグ、選手の円と状態の色、スタミナの濃淡、effort / recovery の輪、体と首の向き、視野、カード、ラベルの位置、スコアボードの文字列と位置、ロゴ。

**残る違い**

- **フォントの字形**: Qt は「Sans Serif」の寸法 (この環境では IPA ゴシック) でレイアウトしつつ、ラテン文字の字形は別のフォント (Ubuntu) から取る。Qt は文字をサブピクセルで描く。Web 版はブラウザのフォント選択に従う。
- **円弧の端**: Qt は円弧をベジェ曲線で近似するので、端点が 1 ピクセルほど違うことがある。
- **重なりの順**: Web 版はスコアボードとロゴを HUD として選手の上に描く (rcssmonitor は選手の下)。3D 表示と共通にするため。

**rcssmonitor の不具合で、Web 版では直したもの** (`src/player_painter.cpp`)

- オフサイドライン (1034、1061 行): 選手の side (文字 `'l'` / `'r'`) を列挙値 `LEFT` / `RIGHT` と比べているので条件が常に偽になり、線がいつも x = 0 とボールの x の間にしか引かれない。Web 版は後ろから 2 人目の選手の位置に引く。
- キャッチ範囲の色 (545、563 行): 同じ比較の誤りで、左のキーパーにも右のキーパーの色を使う。

**Qt の寸法の扱い** (Web 版で合わせたもの)

- ポイントを画素に直すとき整数に丸める (16 pt → 21 px、9 pt → 12 px)。
- `QFontMetrics::ascent()` は切り捨て、`descent()` は切り上げ (IPA ゴシック 21 px: ascent 18.48 → 18、descent 2.52 → 3)。
- アンチエイリアスなしの楕円 (x, y, w, h) は x から x + w までの画素を覆う。

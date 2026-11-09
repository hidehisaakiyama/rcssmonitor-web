# リリース手順

タグ `vX.Y.Z` を push すると、GitHub Actions (`.github/workflows/release.yml`) が次を行う。

1. CI と同じ確認 (lint、型検査、単体テスト、2 種類のビルド、E2E テスト)。タグと `package.json` の版が違えば止まる。
2. GitHub のリリースを作り、次の 2 つを添付する。
   - `rcssmonitor-web-vX.Y.Z.html`: 単一 HTML。ダウンロードして file:// で開く (LAN 内のサーバに接続できる)
   - `rcssmonitor-web-vX.Y.Z-dist.zip`: 分割ビルド (`dist/`)。自分の Web サーバに置く場合に使う
3. 分割ビルドを GitHub Pages に公開する。

リリースノートは `docs/release-notes/vX.Y.Z.md` があればそれを使い、なければ GitHub が自動で作る。

## 初回だけ必要な設定 (GitHub の Web 画面)

1. Settings > Pages > Build and deployment の Source を「GitHub Actions」にする。
2. Settings > Environments > `github-pages` > Deployment branches and tags に、タグの規則 `v*` を加える。既定では main ブランチからの公開しか許されず、タグからの公開が拒否される。

## リポジトリを移したとき (rcsoccersim の Organization へ)

GitHub のドキュメント (Transferring a repository) によると、移しても次は保たれる。

- コミットとタグ、リリース、issue、スター。
- 古い URL (リポジトリやリリースのページ、`git clone` / `push`) から新しい URL への転送。ただし、元の場所 (hidehisaakiyama/rcssmonitor-web) に同じ名前のリポジトリやフォークを作ると、転送は消える。

一方、GitHub Pages は転送されない。`https://hidehisaakiyama.github.io/rcssmonitor-web/` は見られなくなり、新しい場所は `https://rcsoccersim.github.io/rcssmonitor-web/` になる。そのため、移した後に次を行う。

1. 移した先で、上の「初回だけ必要な設定」を確かめる (Pages と環境の設定が引き継がれるかは、ドキュメントに書かれていない)。Organization の Actions の制限 (使ってよいアクション、`GITHUB_TOKEN` の権限) も確かめる。
2. Actions の画面で Release ワークフローを手で実行し (Run workflow)、`tag` に最新のタグ (例 `v1.0.0`) を入れる。そのタグの版をビルドし直して新しい Pages に公開し、リリースの添付ファイルを差し替える。
3. README と `docs/` の URL、About の「Source code」のリンク (`src/ui/dialogs/help-dialogs.ts` の `SOURCE_URL`) を新しい場所に書き換える。リリースノートの本文も、必要なら GitHub の画面で直す。
4. 手元のクローンの接続先を変える (`git remote set-url origin git@github.com:rcsoccersim/rcssmonitor-web.git`)。

すでにダウンロードされた単一 HTML はそのまま使える。その About のリンクは古い URL のままだが、転送で新しい場所に届く。

## 手順

1. `package.json` の版を上げる。

   ```sh
   npm version X.Y.Z --no-git-tag-version
   ```

2. `docs/release-notes/vX.Y.Z.md` を書く (英語)。`docs/parity.md` と README の状態を確かめる。初回 (v1.0.0) は、README の「準備中」の注記を消す。
3. コミットして main に push し、CI が通るのを確かめる。
4. タグを付けて push する。

   ```sh
   git tag -a vX.Y.Z -m "rcssmonitor-web X.Y.Z"
   git push origin vX.Y.Z
   ```

5. Actions の Release ワークフローが終わったら、リリースのページと Pages を確かめる。
   - 添付された単一 HTML を file:// で開き、ログを読み込めること。
   - Pages 版を開き、Help > About の版が新しいこと。

## 失敗したとき

- 確認の段階で失敗した場合は、直してコミットし、タグを付け直す (`git tag -d vX.Y.Z`、`git push origin :refs/tags/vX.Y.Z` の後に手順 4)。
- リリースだけ作られて Pages の公開が失敗した場合 (上の初回の設定が足りないなど) は、設定を直してから、Release ワークフローを手で実行する (`tag` にそのタグ)。リリースがすでにあるときは、作り直さずに添付ファイルだけを差し替える。

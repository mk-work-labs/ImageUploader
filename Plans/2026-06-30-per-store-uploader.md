# 店舗ごとの画像アップローダー分離

作業ブランチ: `feat/per-store-uploader`

## Context（なぜやるか）

現状は単一サイト（`https://mk-work-labs.github.io/ImageUploader/`）で、すべての画像を ImageKit の `/fivem` フォルダ1つに保存している。今後は**店舗ごとにページ URL と保存先フォルダを分けて運用**したい。

ユーザー選択による方針:
- **URL 構成**: 現リポジトリにサブフォルダ → `https://mk-work-labs.github.io/ImageUploader/<店舗>/`
- **ImageKit フォルダ**: トップレベルに店舗別（`/fivem`, `/mochimochi`）。既存 `/fivem` は「fivem 店舗」として**移行せずそのまま残す**。
- **店舗管理**: 少数固定。店舗ごとに小さな `config.js` を置く静的方式。

ImageKit の URL は ImageKit レスポンスの `url` をそのまま使う設計（自前組み立てなし）なので、フォルダを分ければ各店舗の画像 URL は `https://ik.imagekit.io/mkw/<店舗>/...` と自然に分かれる。**既存画像は移動しないため URL は不変。**

## 目標ディレクトリ構成

共有資産（`app.js` / `style.css` / 共通設定）は `docs/` 直下に置き、店舗ごとは `index.html` + `config.js` の2ファイルだけにして重複を最小化する。

```
docs/
  index.html          # ランディング: 各店舗ページへのリンク一覧（新規）
  config.common.js    # 共通設定（新規。WORKER_BASE_URL / PUBLIC_KEY / URL_ENDPOINT）
  app.js              # 共有（小修正）
  style.css           # 共有（流用）
  fivem/
    index.html        # 店舗ページ（共通テンプレ。店舗間で同一内容）
    config.js         # STORE_NAME / UPLOAD_FOLDER のみ
  storeA/
    index.html
    config.js
  storeB/
    index.html
    config.js
```

> 注: この構成では既存 fivem ページの URL が `/ImageUploader/` → `/ImageUploader/fivem/` に変わる。**画像（ImageKit）の URL は変わらない**ので影響はアップローダー画面のブックマークのみ。

## 変更内容

### 1. 共通設定 `docs/config.common.js`（新規）
```js
// 全店舗共通（公開可能な値のみ）
window.APP_CONFIG = {
  WORKER_BASE_URL: "https://imageuploader-worker.mkw-uploader.workers.dev",
  IMAGEKIT_PUBLIC_KEY: "public_4UnoVn7mjbI6kM8XHEQ+K8UPznI=",
  IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/mkw",
};
```

### 2. 店舗別設定 `docs/<店舗>/config.js`（店舗ごと新規）
```js
// 店舗固有設定。config.common.js の後に読み込む
window.APP_CONFIG.STORE_NAME = "fivem";
window.APP_CONFIG.UPLOAD_FOLDER = "/fivem";
```

### 3. 店舗ページ `docs/<店舗>/index.html`（店舗ごと新規・全店舗同一内容）
相対パスを1階層上へ、共通+店舗 config を順に読み込み。
```html
    <link rel="stylesheet" href="../style.css" />
    ...
    <script src="../config.common.js"></script>
    <script src="config.js"></script>
    <script src="../app.js"></script>
```

### 4. ランディング `docs/index.html`（既存を置換）
店舗リンク一覧の静的ページ。

### 5. `docs/app.js`（小修正）
- `loadGallery()` で `/list?folder=...` に店舗フォルダを付与。
- 初期化で `cfg.STORE_NAME` からタイトル/見出しを設定。
- アップロードは既存どおり `cfg.UPLOAD_FOLDER` を送る（変更不要）。

### 6. `worker/src/index.js`（`/list` を店舗対応に）
`?folder=` を受け取り許可リストで検証してから ImageKit を叩く。`/auth`・`/delete` は変更不要。

### 7. `worker/wrangler.toml`
`UPLOAD_FOLDER` を `ALLOWED_FOLDERS = "/fivem,/storeA,/storeB"` に置換。`ALLOWED_ORIGIN` は変更不要。

## 既知の制約（今回は対象外）
- アップロード署名はフォルダを束縛しないため技術的には他店舗フォルダにもアップロード可能。
- `/delete` は fileId 指定で店舗フォルダ検証なし。

## 検証手順
1. `docs/` を簡易サーバで配信し各店舗ページの表示・動作確認。
2. 店舗分離（storeA の画像が fivem に出ない、URL に `/<店舗>/` が含まれる）。
3. `wrangler deploy` 後 `/list?folder=/storeA` が 200、未許可フォルダが 403。
4. GitHub Pages 反映後に各店舗 URL が表示されること。

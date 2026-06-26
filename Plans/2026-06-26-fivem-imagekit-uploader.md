# FiveM 向け 画像アップローダー（GitHub Pages + ImageKit + Cloudflare Workers）

## Context（背景・目的）

FiveM のゲーム内で画像を表示するには、画像をどこかにホストして URL を得る必要がある。
そのための専用 Web ページを作る。要件は次の一連の流れ:

1. ローカル PC から画像を選択
2. 「アップロード」ボタンで ImageKit へアップロード
3. アップロード後に画面を更新し、ImageKit 上（専用フォルダ）の画像一覧をグリッド表示
4. セルをクリックすると画像プレビューと画像 URL を表示
5. コピーボタンで URL をクリップボードにコピー

### 技術的制約と採用構成

- **GitHub Pages は静的ホスティングのみ**でサーバー処理ができない。
- 一方 ImageKit の **アップロード認証**（`token`+`expire` を Private Key で HMAC-SHA1 署名した `signature` が必要）と **一覧取得（List API、Private Key の Basic 認証）** はどちらも Private Key を要し、ブラウザに置けない。
- そこで **Private Key を扱う最小バックエンドを Cloudflare Workers**（無料枠 10万req/日・クレジットカード登録不要）に置く。
  - フロント = GitHub Pages（静的）
  - 認証署名の発行 + 一覧取得の代理 = Cloudflare Worker
- 確定事項: ImageKit アカウント/キーは準備済み。ギャラリーは **専用フォルダのみ**（本書では `/fivem`）。実装はユーザーが行う。

---

## 全体フロー

```
[ブラウザ(GitHub Pages)]
  選択 → 「アップロード」
    └─ GET  {WORKER}/auth          → {token, expire, signature}
    └─ POST upload.imagekit.io ...  （file + publicKey + signature + token + expire + folder）
  完了 → loadGallery()
    └─ GET  {WORKER}/list          → [{fileId, name, url, thumbnailUrl}, ...]（Workerが私有鍵でList APIを代理）
  セルクリック → モーダル（プレビュー + URL + コピー）

[Cloudflare Worker]
  /auth : crypto.randomUUID() で token、expire=now+40分、HMAC-SHA1(token+expire, PRIVATE_KEY)
  /list : api.imagekit.io/v1/files?path=/fivem を Basic 認証で代理取得
  Private Key は wrangler secret として保持（コードにもフロントにも出さない）
```

---

## ディレクトリ構成

```
ImageUploader/
├── docs/                 # ← GitHub Pages の公開ソース（Settings > Pages で /docs を指定）
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── config.js         # 公開してよい値のみ（Public Key / URL Endpoint / Worker URL / フォルダ）
├── worker/               # ← Cloudflare Worker（Pages とは別にデプロイ）
│   ├── src/
│   │   └── index.js
│   └── wrangler.toml
├── Plans/
└── README.md
```

> 注: `config.js` に入れる値（Public Key・URL Endpoint・Worker の URL・フォルダ名）は**秘密ではない**ので公開リポジトリにコミットして問題ない。**Private Key だけは絶対にコミットしない**（Worker の secret に入れる）。
> GitHub Pages を無料で使うにはリポジトリを **public** にするのが簡単（private で Pages を使うには有料プランが必要）。

---

## 実装コード（全文）

### 1. `worker/src/index.js`（Cloudflare Worker 本体）

```js
const LIST_URL = "https://api.imagekit.io/v1/files";

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// token+expire を Private Key で HMAC-SHA1 → 小文字hex（ImageKit クライアント側アップロードの仕様）
async function hmacSha1Hex(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // --- アップロード用の認証パラメータ発行 ---
    if (url.pathname === "/auth") {
      const token = crypto.randomUUID();
      const expire = Math.floor(Date.now() / 1000) + 40 * 60; // 40分後（仕様上1時間以内）
      const signature = await hmacSha1Hex(env.IMAGEKIT_PRIVATE_KEY, token + expire);
      return Response.json({ token, expire, signature }, { headers });
    }

    // --- 専用フォルダの画像一覧を Private Key で代理取得 ---
    if (url.pathname === "/list") {
      const folder = env.UPLOAD_FOLDER || "/";
      const apiUrl =
        `${LIST_URL}?path=${encodeURIComponent(folder)}` +
        `&sort=DESC_CREATED&limit=100&fileType=image`;
      const auth = btoa(env.IMAGEKIT_PRIVATE_KEY + ":"); // Basic: privateKey を user、password 空
      const resp = await fetch(apiUrl, { headers: { Authorization: `Basic ${auth}` } });
      if (!resp.ok) {
        return Response.json(
          { error: "list failed", status: resp.status },
          { status: 502, headers }
        );
      }
      const files = await resp.json();
      const items = (Array.isArray(files) ? files : []).map((f) => ({
        fileId: f.fileId,
        name: f.name,
        url: f.url,
        thumbnailUrl: f.thumbnail || f.url,
      }));
      return Response.json(items, { headers });
    }

    return new Response("Not found", { status: 404, headers });
  },
};
```

### 2. `worker/wrangler.toml`

```toml
name = "imageuploader-worker"
main = "src/index.js"
compatibility_date = "2024-11-01"

[vars]
# デプロイ後に確定する GitHub Pages の URL を入れる（例）
ALLOWED_ORIGIN = "https://<your-github-username>.github.io"
UPLOAD_FOLDER  = "/fivem"
```

> `IMAGEKIT_PRIVATE_KEY` は `[vars]` に書かず、後述の `wrangler secret put` で登録する。

### 3. `docs/config.js`（公開してよい設定値のみ）

```js
// すべて公開可能な値。Private Key は絶対にここに書かない。
window.APP_CONFIG = {
  // wrangler deploy 後に表示される *.workers.dev の URL
  WORKER_BASE_URL: "https://imageuploader-worker.<your-subdomain>.workers.dev",
  // ImageKit ダッシュボード > Developer options
  IMAGEKIT_PUBLIC_KEY: "public_xxxxxxxxxxxxxxxxxxxxxxxx",
  IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/<your_imagekit_id>",
  UPLOAD_FOLDER: "/fivem",
};
```

### 4. `docs/index.html`

```html
<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FiveM Image Uploader</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header>
      <h1>FiveM 画像アップローダー</h1>
    </header>

    <section class="uploader">
      <input type="file" id="file" accept="image/*" />
      <button id="upload">アップロード</button>
      <span id="status" class="status"></span>
    </section>

    <section class="gallery">
      <div class="gallery-head">
        <h2>アップロード済み画像</h2>
        <button id="reload" class="reload">更新</button>
      </div>
      <div id="grid" class="grid"></div>
    </section>

    <!-- プレビュー用モーダル -->
    <div id="modal" class="modal">
      <div class="modal-box">
        <button id="modal-close" class="modal-close">×</button>
        <img id="modal-img" class="modal-img" alt="preview" />
        <div class="url-row">
          <input id="url-input" type="text" readonly />
          <button id="copy">URLをコピー</button>
        </div>
      </div>
    </div>

    <script src="config.js"></script>
    <script src="app.js"></script>
  </body>
</html>
```

### 5. `docs/app.js`

```js
const cfg = window.APP_CONFIG;

const fileInput = document.getElementById("file");
const uploadBtn = document.getElementById("upload");
const reloadBtn = document.getElementById("reload");
const statusEl = document.getElementById("status");
const grid = document.getElementById("grid");

const modal = document.getElementById("modal");
const modalImg = document.getElementById("modal-img");
const modalClose = document.getElementById("modal-close");
const urlInput = document.getElementById("url-input");
const copyBtn = document.getElementById("copy");

// --- 認証パラメータ取得 ---
async function getAuth() {
  const r = await fetch(`${cfg.WORKER_BASE_URL}/auth`);
  if (!r.ok) throw new Error("認証取得に失敗 (" + r.status + ")");
  return r.json();
}

// --- ImageKit へ直接アップロード ---
async function uploadFile(file) {
  const { token, expire, signature } = await getAuth();
  const form = new FormData();
  form.append("file", file);
  form.append("fileName", file.name);
  form.append("publicKey", cfg.IMAGEKIT_PUBLIC_KEY);
  form.append("signature", signature);
  form.append("expire", expire);
  form.append("token", token);
  form.append("folder", cfg.UPLOAD_FOLDER);
  form.append("useUniqueFileName", "true");

  const r = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
    method: "POST",
    body: form,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error("アップロード失敗: " + t);
  }
  return r.json();
}

uploadBtn.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) {
    statusEl.textContent = "ファイルを選択してください";
    return;
  }
  uploadBtn.disabled = true;
  statusEl.textContent = "アップロード中...";
  try {
    await uploadFile(file);
    statusEl.textContent = "アップロード完了";
    fileInput.value = "";
    await loadGallery();
  } catch (e) {
    statusEl.textContent = e.message;
  } finally {
    uploadBtn.disabled = false;
  }
});

// --- 一覧取得 & グリッド描画 ---
async function loadGallery() {
  grid.innerHTML = "<p class='hint'>読み込み中...</p>";
  try {
    const r = await fetch(`${cfg.WORKER_BASE_URL}/list`);
    if (!r.ok) throw new Error("一覧取得に失敗 (" + r.status + ")");
    renderGrid(await r.json());
  } catch (e) {
    grid.innerHTML = "<p class='hint'>" + e.message + "</p>";
  }
}

function renderGrid(items) {
  grid.innerHTML = "";
  if (!items.length) {
    grid.innerHTML = "<p class='hint'>画像がありません</p>";
    return;
  }
  for (const it of items) {
    const cell = document.createElement("div");
    cell.className = "cell";
    const img = document.createElement("img");
    // ImageKit の変換パラメータでサムネイル軽量化
    img.src = `${it.thumbnailUrl}?tr=w-240,h-240,c-at_max`;
    img.alt = it.name;
    img.loading = "lazy";
    cell.appendChild(img);
    cell.addEventListener("click", () => openModal(it));
    grid.appendChild(cell);
  }
}

// --- モーダル（プレビュー + URL コピー） ---
function openModal(it) {
  modalImg.src = it.url;
  urlInput.value = it.url;
  modal.classList.add("open");
}
function closeModal() {
  modal.classList.remove("open");
  modalImg.src = "";
}
modalClose.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(urlInput.value);
    copyBtn.textContent = "コピーしました!";
  } catch {
    urlInput.select();
    document.execCommand("copy"); // フォールバック
    copyBtn.textContent = "コピーしました!";
  }
  setTimeout(() => (copyBtn.textContent = "URLをコピー"), 1500);
});

reloadBtn.addEventListener("click", loadGallery);

// 初期表示
loadGallery();
```

### 6. `docs/style.css`

```css
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #11151c;
  color: #e7ecf3;
}
header { padding: 16px 24px; border-bottom: 1px solid #232a35; }
h1 { font-size: 18px; margin: 0; }

.uploader {
  display: flex; gap: 12px; align-items: center;
  padding: 20px 24px; flex-wrap: wrap;
}
button {
  background: #3a7afe; color: #fff; border: 0; border-radius: 6px;
  padding: 8px 16px; cursor: pointer; font-size: 14px;
}
button:disabled { opacity: .5; cursor: default; }
.status { font-size: 13px; color: #9aa7b8; }

.gallery { padding: 8px 24px 40px; }
.gallery-head { display: flex; align-items: center; justify-content: space-between; }
.reload { background: #2b3340; }
h2 { font-size: 15px; }
.hint { color: #9aa7b8; font-size: 13px; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.cell {
  aspect-ratio: 1 / 1; background: #1b212b; border-radius: 8px;
  overflow: hidden; cursor: pointer; border: 1px solid #232a35;
}
.cell img { width: 100%; height: 100%; object-fit: cover; display: block; }

.modal {
  position: fixed; inset: 0; background: rgba(0,0,0,.7);
  display: none; align-items: center; justify-content: center; padding: 20px;
}
.modal.open { display: flex; }
.modal-box {
  background: #1b212b; border-radius: 10px; padding: 16px;
  max-width: 90vw; max-height: 90vh; position: relative;
}
.modal-close {
  position: absolute; top: 8px; right: 8px; background: #2b3340;
  width: 32px; height: 32px; border-radius: 50%; padding: 0; font-size: 18px;
}
.modal-img { max-width: 80vw; max-height: 65vh; display: block; border-radius: 6px; }
.url-row { display: flex; gap: 8px; margin-top: 12px; }
.url-row input {
  flex: 1; background: #11151c; color: #e7ecf3;
  border: 1px solid #232a35; border-radius: 6px; padding: 8px;
}
```

---

## デプロイ手順（ユーザー作業）

### A. ImageKit 側
1. ダッシュボードで専用フォルダ `/fivem` を作成（最初のアップロード時に自動作成されるので任意）。
2. **Developer options** で `Public Key` / `Private Key` / `URL Endpoint` を控える。

### B. Cloudflare Worker をデプロイ
```bash
# Cloudflare アカウント作成（無料・カード不要） → https://dash.cloudflare.com/sign-up
cd worker
npx wrangler login                      # ブラウザで認可（! 接頭辞でこのセッションから実行も可）
npx wrangler secret put IMAGEKIT_PRIVATE_KEY   # プロンプトに Private Key を貼り付け
# wrangler.toml の UPLOAD_FOLDER を確認（ALLOWED_ORIGIN は手順Dで確定後に更新）
npx wrangler deploy
# → 出力される https://imageuploader-worker.<subdomain>.workers.dev を控える
```

### C. フロント設定を反映
- `docs/config.js` の `WORKER_BASE_URL` / `IMAGEKIT_PUBLIC_KEY` / `IMAGEKIT_URL_ENDPOINT` を実値に更新。

### D. GitHub Pages を公開
1. リポジトリを **public** にする（無料 Pages のため）。
2. `git add -A && git commit -m "feat: add image uploader" && git push`
3. GitHub の **Settings > Pages** で Source を `main` ブランチの `/docs` に設定 → `https://<user>.github.io/<repo>/` が発行される。

### E. CORS を締める（任意だが推奨）
- `worker/wrangler.toml` の `ALLOWED_ORIGIN` を手順 D で得た Pages の URL（`https://<user>.github.io`）に更新し、`npx wrangler deploy` で再デプロイ。

---

## 動作確認（エンドツーエンド）

1. 発行された GitHub Pages の URL を開く。
2. ローカル画像を選び「アップロード」→ ステータスが「アップロード完了」になる。
3. グリッドが自動更新され、アップロードした画像のサムネイルが表示される。
4. セルをクリック → モーダルにプレビューと URL が表示される。
5. 「URLをコピー」→ クリップボードにコピーされ、ボタン文言が「コピーしました!」になる。
6. コピーした URL を FiveM 側で利用して表示確認。

### 個別チェック（切り分け用）
- `curl https://<worker>.workers.dev/auth` → `{token, expire, signature}` が返る。
- `curl https://<worker>.workers.dev/list` → 画像配列（最初は空 `[]`）が返る。
- ブラウザの DevTools Network で、upload リクエストが 200、list が 200 であることを確認。CORS エラーが出る場合は `ALLOWED_ORIGIN` を見直す。

---

## 補足・将来拡張（今回は対象外）
- 画像削除ボタン（Worker に `POST /delete` を追加し `fileId` で ImageKit DELETE を代理）。
- ドラッグ&ドロップ / 複数枚アップロード / アップロード進捗バー。
- ページネーション（List API の `skip`/`limit`）。
- Worker の `/auth` に簡易な合言葉（クエリ or ヘッダ）を要求し、無断利用を抑止。

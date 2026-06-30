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
const deleteBtn = document.getElementById("delete");

// モーダルで開いている画像
let currentItem = null;

// グリッドに表示中の画像一覧（メモリ保持）
let galleryItems = [];

// --- 削除済みファイルの墓標（List API の反映ラグ対策） ---
// 削除した fileId を一定時間記録し、/list 結果から除外する。
const TOMBSTONE_KEY = "deletedTombstones";
const TOMBSTONE_TTL = 5 * 60 * 1000; // 5分（List 反映ラグより十分長く取る）

function loadTombstones() {
  try {
    const obj = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) || "{}");
    const now = Date.now();
    let changed = false;
    for (const id of Object.keys(obj)) {
      if (now - obj[id] > TOMBSTONE_TTL) {
        delete obj[id]; // 期限切れは掃除（無限増加を防ぐ）
        changed = true;
      }
    }
    if (changed) localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(obj));
    return obj;
  } catch {
    return {};
  }
}

function addTombstone(fileId) {
  try {
    const obj = loadTombstones();
    obj[fileId] = Date.now();
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(obj));
  } catch {
    /* localStorage 不可でもアプリは継続 */
  }
}

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
    const uploaded = await uploadFile(file);
    statusEl.textContent = "アップロード完了";
    fileInput.value = "";
    // List API は反映に数秒のラグがあるため、アップロード結果を即座に先頭へ追加する
    const newItem = {
      fileId: uploaded.fileId,
      name: uploaded.name,
      url: uploaded.url,
      thumbnailUrl: uploaded.thumbnailUrl || uploaded.url,
    };
    galleryItems = [
      newItem,
      ...galleryItems.filter((i) => i.fileId !== newItem.fileId),
    ];
    renderGrid();
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
    const r = await fetch(
      `${cfg.WORKER_BASE_URL}/list?folder=${encodeURIComponent(cfg.UPLOAD_FOLDER)}`
    );
    if (!r.ok) throw new Error("一覧取得に失敗 (" + r.status + ")");
    const data = await r.json();
    const tombs = loadTombstones();
    // 削除済み（反映ラグで残っている）ものを除外
    galleryItems = (Array.isArray(data) ? data : []).filter(
      (it) => !tombs[it.fileId]
    );
    renderGrid();
  } catch (e) {
    grid.innerHTML = "<p class='hint'>" + e.message + "</p>";
  }
}

function renderGrid() {
  grid.innerHTML = "";
  if (!galleryItems.length) {
    grid.innerHTML = "<p class='hint'>画像がありません</p>";
    return;
  }
  for (const it of galleryItems) {
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
// ?updatedAt= などのクエリを除いたクリーンなベースURLを返す
function baseUrl(u) {
  return u ? u.split("?")[0] : u;
}

function openModal(it) {
  currentItem = it;
  const clean = baseUrl(it.url);
  modalImg.src = clean;
  urlInput.value = clean;
  modal.classList.add("open");
}
function closeModal() {
  modal.classList.remove("open");
  modalImg.src = "";
  currentItem = null;
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

// --- 削除（確認 → OKで削除、キャンセルで戻る） ---
deleteBtn.addEventListener("click", async () => {
  if (!currentItem) return;
  const ok = window.confirm(`「${currentItem.name}」を削除します。よろしいですか?`);
  if (!ok) return; // キャンセル → 何もせずモーダルに戻る

  deleteBtn.disabled = true;
  deleteBtn.textContent = "削除中...";
  try {
    const r = await fetch(`${cfg.WORKER_BASE_URL}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: currentItem.fileId }),
    });
    if (!r.ok) throw new Error("削除に失敗 (" + r.status + ")");
    // List API の反映ラグで戻ってくるのを防ぐ
    const deletedId = currentItem.fileId;
    addTombstone(deletedId); // 再読込をまたいでも /list から除外
    galleryItems = galleryItems.filter((i) => i.fileId !== deletedId);
    closeModal();
    statusEl.textContent = "削除しました";
    renderGrid();
  } catch (e) {
    statusEl.textContent = e.message;
  } finally {
    deleteBtn.disabled = false;
    deleteBtn.textContent = "削除";
  }
});

reloadBtn.addEventListener("click", loadGallery);

// 店舗名をタイトル・見出しに反映（config.js の STORE_NAME 由来）
if (cfg.STORE_NAME) {
  document.title = `${cfg.STORE_NAME} 画像アップローダー`;
  const h = document.querySelector("header h1");
  if (h) h.textContent = `${cfg.STORE_NAME} 画像アップローダー`;
}

// 初期表示
loadGallery();

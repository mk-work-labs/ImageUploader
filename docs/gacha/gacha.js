// ガチャシミュレーターの画面制御。
// 設定は localStorage に保存するが、結果・統計・履歴はセッション限りで保存しない。
const store = window.GachaStore;
const draw = window.GachaDraw;

const RESULT_MAX = 100; // 「今回の結果」に表示する件数
const HISTORY_MAX = 50; // 履歴に残すロット数
const SPIN_MAX = 1000000; // 1回の抽選で指定できる上限
const CONFIRM_OVER = 100000; // これを超えたら確認ダイアログを出す
const SAVE_DELAY = 300; // 入力保存のデバウンス
const TOTAL_EPS = 5e-7; // 合計の表示桁で 100% に見える範囲は 100% とみなす

// レアリティ表示色。未知のレアリティは既定色にフォールバックする
const RARITY_COLORS = {
  UR: "#e0443e",
  SSR: "#e8b64c",
  SR: "#a06ade",
  R: "#3a7afe",
  N: "#9aa7b8",
};
const RARITY_DEFAULT = "#9aa7b8";

const gachaSelect = document.getElementById("gacha-select");
const gachaAdd = document.getElementById("gacha-add");
const gachaRename = document.getElementById("gacha-rename");
const gachaCopy = document.getElementById("gacha-copy");
const gachaDelete = document.getElementById("gacha-delete");
const itemBody = document.getElementById("item-body");
const itemAdd = document.getElementById("item-add");
const rateTotalEl = document.getElementById("rate-total");
const rateWarn = document.getElementById("rate-warn");
const spinCount = document.getElementById("spin-count");
const spinBtn = document.getElementById("spin");
const spinStatus = document.getElementById("spin-status");
const statsReset = document.getElementById("stats-reset");
const resultList = document.getElementById("result-list");
const statsBody = document.getElementById("stats-body");
const raritySummary = document.getElementById("rarity-summary");
const totalCountEl = document.getElementById("total-count");
const historyList = document.getElementById("history-list");

let state = store.loadState();
let statsCounts = {}; // アイテムid -> セッション中の当選数
let totalCount = 0;
let history = [];
let rateSignature = ""; // 確率構成が変わったら統計をリセットするための指紋
let saveTimer = null;

// --- 共通ヘルパー ---

function currentGacha() {
  return store.findGacha(state, state.selectedId) || state.gachas[0];
}

function currentItems() {
  const g = currentGacha();
  return g ? g.items : [];
}

function rarityColor(rarity) {
  return RARITY_COLORS[String(rarity || "").toUpperCase()] || RARITY_DEFAULT;
}

function fmtInt(n) {
  return n.toLocaleString("ja-JP");
}

function fmtPct(v) {
  return v.toFixed(3);
}

// 合計は末尾の 0 を落として表示する。toFixed(2) だと 99.999999% を
// 「合計 100.00%」と表示しつつ警告も出す、という食い違いが起きるため。
function fmtTotal(v) {
  return String(Number(v.toFixed(6)));
}

function totalRate() {
  let total = 0;
  for (const it of currentItems()) total += Number(it.rate) || 0;
  return total;
}

// 確率の構成（アイテムの並びと確率）が変わったかどうかを見る。
// 名前やレアリティの変更は分布に影響しないので統計は維持する。
function signature() {
  return currentItems().map((it) => it.id + ":" + (Number(it.rate) || 0)).join(",");
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY);
}

function saveNow() {
  clearTimeout(saveTimer);
  const g = currentGacha();
  if (g) g.updatedAt = Date.now();
  store.saveState(state);
}

// 分布が変わっていたら統計を捨てる（設定が違う結果を混ぜると比較が無意味になるため）
// リセットしたら true を返す
function syncStats(reason) {
  const sig = signature();
  if (sig === rateSignature) return false;
  rateSignature = sig;
  resetStats(reason);
  return true;
}

function resetStats(reason) {
  statsCounts = {};
  totalCount = 0;
  history = [];
  resultList.textContent = "";
  renderStats();
  renderHistory();
  spinStatus.textContent = reason || "";
}

// --- ガチャ選択 ---

function renderGachaSelect() {
  // 選択中 id が実体とズレているとセレクトが空欄になるため、先に揃える
  const cur = currentGacha();
  if (cur) state.selectedId = cur.id;
  gachaSelect.textContent = "";
  for (const g of state.gachas) {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    gachaSelect.appendChild(opt);
  }
  gachaSelect.value = state.selectedId;
  gachaDelete.disabled = state.gachas.length <= 1;
}

function selectGacha(id) {
  state.selectedId = id;
  saveNow();
  renderAll();
  resetStats("");
  rateSignature = signature();
}

// --- アイテム編集 ---

function renderItemTable() {
  itemBody.textContent = "";
  const items = currentItems();
  if (items.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.className = "empty";
    td.textContent = "アイテムがありません。「+ アイテムを追加」から登録してください。";
    tr.appendChild(td);
    itemBody.appendChild(tr);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const it of items) {
    const tr = document.createElement("tr");
    tr.className = "item-row";

    const tdRarity = document.createElement("td");
    const rarityInput = document.createElement("input");
    rarityInput.type = "text";
    rarityInput.value = it.rarity;
    rarityInput.setAttribute("list", "rarity-presets");
    rarityInput.dataset.id = it.id;
    rarityInput.dataset.field = "rarity";
    rarityInput.style.color = rarityColor(it.rarity);
    tdRarity.appendChild(rarityInput);

    const tdName = document.createElement("td");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = it.name;
    nameInput.placeholder = "アイテム名";
    nameInput.dataset.id = it.id;
    nameInput.dataset.field = "name";
    tdName.appendChild(nameInput);

    const tdRate = document.createElement("td");
    const rateInput = document.createElement("input");
    rateInput.type = "number";
    rateInput.className = "rate-input";
    rateInput.min = "0";
    rateInput.max = "100";
    rateInput.step = "any";
    rateInput.value = String(it.rate);
    rateInput.dataset.id = it.id;
    rateInput.dataset.field = "rate";
    tdRate.appendChild(rateInput);

    const tdAct = document.createElement("td");
    const del = document.createElement("button");
    del.className = "row-delete";
    del.textContent = "削除";
    del.dataset.id = it.id;
    del.dataset.action = "delete-item";
    tdAct.appendChild(del);

    tr.appendChild(tdRarity);
    tr.appendChild(tdName);
    tr.appendChild(tdRate);
    tr.appendChild(tdAct);
    frag.appendChild(tr);
  }
  itemBody.appendChild(frag);
}

function renderRateTotal() {
  const items = currentItems();
  const total = totalRate();
  rateTotalEl.textContent = "合計 " + fmtTotal(total) + "%";

  // 0.1 + 0.2 のような誤差で 100% 判定を落とさないよう許容誤差を持たせる
  const isHundred = Math.abs(total - 100) < TOTAL_EPS;
  rateTotalEl.classList.toggle("bad", !isHundred);

  const drawable = items.some((it) => (Number(it.rate) || 0) > 0);
  spinBtn.disabled = !drawable;
  for (const btn of document.querySelectorAll(".preset")) btn.disabled = !drawable;

  if (items.length === 0) {
    rateWarn.textContent = "アイテムを1件以上登録してください。";
  } else if (!drawable) {
    rateWarn.textContent = "確率が 0% より大きいアイテムがないため抽選できません。";
  } else if (!isHundred) {
    rateWarn.textContent =
      "合計が " + fmtTotal(total) + "% です。比率を保ったまま正規化して抽選します。";
  } else {
    rateWarn.textContent = "";
  }
}

function onItemInput(id, field, value) {
  const item = currentItems().find((it) => it.id === id);
  if (!item) return;
  if (field === "rate") {
    // 負の値は 0 に丸める。抽選では除外されるのに合計には効いてしまい、
    // 「設定%」の表示が実際の分布とズレるため。
    item.rate = Math.max(0, Number(value) || 0);
  } else {
    item[field] = value;
  }
  scheduleSave();
  renderRateTotal();
  // 分布が変わっていなければ統計は維持されるので、その場合だけ再描画する
  if (!syncStats("設定が変更されたため統計をリセットしました")) renderStats();
}

function addItem() {
  currentItems().push(store.newItem("", "", 0));
  saveNow();
  renderItemTable();
  renderRateTotal();
  syncStats("設定が変更されたため統計をリセットしました");
}

function removeItem(id) {
  const g = currentGacha();
  g.items = g.items.filter((it) => it.id !== id);
  saveNow();
  renderItemTable();
  renderRateTotal();
  syncStats("設定が変更されたため統計をリセットしました");
}

// --- 抽選実行 ---

function clampCount(n) {
  const v = Math.floor(Number(n));
  if (!isFinite(v) || v < 1) return 1;
  return Math.min(v, SPIN_MAX);
}

function spin(count) {
  const n = clampCount(count);
  const table = draw.buildTable(currentItems());
  if (table.total <= 0) {
    spinStatus.textContent = "確率が 0% より大きいアイテムがないため抽選できません。";
    return;
  }
  if (n > CONFIRM_OVER) {
    const ok = window.confirm(
      fmtInt(n) + " 回の抽選です。ブラウザが数秒固まる場合があります。実行しますか?"
    );
    if (!ok) return;
  }

  spinBtn.disabled = true;
  spinStatus.textContent = "抽選中...";
  // 「抽選中...」を描画させてから同期ループに入る
  setTimeout(function () {
    try {
      const t0 = performance.now();
      const res = draw.drawMany(table, n, RESULT_MAX);
      const ms = performance.now() - t0;

      for (let i = 0; i < table.ids.length; i++) {
        statsCounts[table.ids[i]] = (statsCounts[table.ids[i]] || 0) + res.counts[i];
      }
      totalCount += n;

      pushHistory(table, res.counts, n);
      renderResult(table, res.tail);
      renderStats();
      renderHistory();
      spinStatus.textContent = fmtInt(n) + "回を " + ms.toFixed(1) + "ms で抽選しました";
    } finally {
      renderRateTotal();
    }
  }, 0);
}

// --- 今回の結果 ---

function renderResult(table, tail) {
  resultList.textContent = "";
  const frag = document.createDocumentFragment();
  for (const idx of tail) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const tag = document.createElement("span");
    tag.className = "rarity-tag";
    tag.style.color = rarityColor(table.rarities[idx]);
    tag.textContent = table.rarities[idx] || "-";
    const name = document.createElement("span");
    name.textContent = table.names[idx] || "(名称未設定)";
    chip.appendChild(tag);
    chip.appendChild(name);
    frag.appendChild(chip);
  }
  resultList.appendChild(frag);
}

// --- 統計 ---

function renderStats() {
  const items = currentItems();
  const total = totalRate();
  statsBody.textContent = "";
  totalCountEl.textContent = "通算 " + fmtInt(totalCount) + " 回";

  // 差分ゲージの目盛りは全行共通で取る。最も外れている行が端いっぱいになり、
  // 行どうしのズレの大きさを比べられる。
  let maxAbs = 0;
  if (totalCount > 0) {
    for (const it of items) {
      const set = total > 0 ? ((Number(it.rate) || 0) / total) * 100 : 0;
      const act = ((statsCounts[it.id] || 0) / totalCount) * 100;
      maxAbs = Math.max(maxAbs, Math.abs(act - set));
    }
  }
  const gaugeScale = maxAbs > 0 ? maxAbs * 1.2 : 1;

  const frag = document.createDocumentFragment();
  for (const it of items) {
    const hit = statsCounts[it.id] || 0;
    const set = total > 0 ? ((Number(it.rate) || 0) / total) * 100 : 0;
    const act = totalCount > 0 ? (hit / totalCount) * 100 : 0;
    const diff = act - set;

    const tr = document.createElement("tr");

    const tdRarity = document.createElement("td");
    const tag = document.createElement("span");
    tag.className = "rarity-tag";
    tag.style.color = rarityColor(it.rarity);
    tag.textContent = it.rarity || "-";
    tdRarity.appendChild(tag);

    const tdName = document.createElement("td");
    tdName.textContent = it.name || "(名称未設定)";

    const tdSet = document.createElement("td");
    tdSet.className = "num";
    tdSet.textContent = fmtPct(set);

    const tdHit = document.createElement("td");
    tdHit.className = "num";
    tdHit.textContent = fmtInt(hit);

    const tdAct = document.createElement("td");
    tdAct.className = "num";
    tdAct.textContent = totalCount > 0 ? fmtPct(act) : "-";

    const tdDiff = document.createElement("td");
    tdDiff.className = "num " + (diff >= 0 ? "diff-plus" : "diff-minus");
    tdDiff.textContent = totalCount > 0 ? (diff >= 0 ? "+" : "") + fmtPct(diff) : "-";

    tr.appendChild(tdRarity);
    tr.appendChild(tdName);
    tr.appendChild(tdSet);
    tr.appendChild(tdHit);
    tr.appendChild(tdAct);
    tr.appendChild(tdDiff);
    frag.appendChild(tr);

    const barTr = document.createElement("tr");
    const barTd = document.createElement("td");
    barTd.className = "bar-cell";
    barTd.colSpan = 6;
    // 中央が差分0。右に伸びれば出過ぎ、左に伸びれば出不足。
    const bar = document.createElement("div");
    bar.className = "bar";
    const mark = document.createElement("div");
    mark.className = "bar-mark";
    mark.title = "差分 0（設定どおり）";
    bar.appendChild(mark);
    if (totalCount > 0) {
      const w = (Math.abs(diff) / gaugeScale) * 50;
      const fill = document.createElement("div");
      fill.className = "bar-fill " + (diff >= 0 ? "plus" : "minus");
      fill.style.width = w + "%";
      fill.style.left = (diff >= 0 ? 50 : 50 - w) + "%";
      fill.title = (diff >= 0 ? "+" : "") + fmtPct(diff) + " ポイント";
      bar.appendChild(fill);
    }
    barTd.appendChild(bar);
    barTr.appendChild(barTd);
    frag.appendChild(barTr);
  }
  statsBody.appendChild(frag);
  renderRaritySummary();
}

function renderRaritySummary() {
  raritySummary.textContent = "";
  if (totalCount === 0) {
    raritySummary.textContent = "まだ抽選していません。";
    return;
  }
  // 同じレアリティ名でまとめる
  const order = [];
  const sums = {};
  for (const it of currentItems()) {
    const key = it.rarity || "-";
    if (!(key in sums)) {
      sums[key] = 0;
      order.push(key);
    }
    sums[key] += statsCounts[it.id] || 0;
  }
  const frag = document.createDocumentFragment();
  for (const key of order) {
    const span = document.createElement("span");
    const tag = document.createElement("span");
    tag.className = "rarity-tag";
    tag.style.color = rarityColor(key);
    tag.textContent = key;
    span.appendChild(tag);
    span.appendChild(
      document.createTextNode(
        " " + fmtInt(sums[key]) + "回 (" + fmtPct((sums[key] / totalCount) * 100) + "%)"
      )
    );
    frag.appendChild(span);
  }
  raritySummary.appendChild(frag);
}

// --- 履歴 ---

function pushHistory(table, counts, n) {
  const parts = [];
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0) parts.push({ label: (table.rarities[i] || "-") + " " + (table.names[i] || "(名称未設定)"), n: counts[i] });
  }
  parts.sort((a, b) => b.n - a.n);
  const shown = parts.slice(0, 6).map((p) => p.label + " ×" + fmtInt(p.n));
  if (parts.length > shown.length) shown.push("他" + (parts.length - shown.length) + "種");
  history.unshift({
    time: new Date().toLocaleTimeString("ja-JP", {
      hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
    }),
    count: n,
    body: shown.join(" / "),
  });
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
}

function renderHistory() {
  historyList.textContent = "";
  if (history.length === 0) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "履歴はまだありません。";
    historyList.appendChild(li);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const h of history) {
    const li = document.createElement("li");
    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = h.time;
    const count = document.createElement("span");
    count.className = "history-count";
    count.textContent = fmtInt(h.count) + "連";
    const body = document.createElement("span");
    body.className = "history-body";
    body.textContent = h.body;
    li.appendChild(time);
    li.appendChild(count);
    li.appendChild(body);
    frag.appendChild(li);
  }
  historyList.appendChild(frag);
}

// --- 全体描画 ---

function renderAll() {
  renderGachaSelect();
  renderItemTable();
  renderRateTotal();
  renderStats();
  renderHistory();
}

// --- イベント ---

gachaSelect.addEventListener("change", function () {
  selectGacha(gachaSelect.value);
});

gachaAdd.addEventListener("click", function () {
  const name = window.prompt("新しいガチャの名前", "新しいガチャ");
  if (name === null) return;
  const g = store.newGacha(name.trim() || "新しいガチャ");
  g.items = [store.newItem("", "", 100)];
  state.gachas.push(g);
  selectGacha(g.id);
});

gachaRename.addEventListener("click", function () {
  const g = currentGacha();
  if (!g) return;
  const name = window.prompt("ガチャの名前", g.name);
  if (name === null) return;
  g.name = name.trim() || g.name;
  saveNow();
  renderGachaSelect();
});

gachaCopy.addEventListener("click", function () {
  const g = currentGacha();
  if (!g) return;
  const copy = store.newGacha(g.name + " のコピー");
  copy.items = g.items.map((it) => store.newItem(it.rarity, it.name, it.rate));
  state.gachas.push(copy);
  selectGacha(copy.id);
});

gachaDelete.addEventListener("click", function () {
  const g = currentGacha();
  if (!g || state.gachas.length <= 1) return;
  if (!window.confirm("「" + g.name + "」を削除しますか?")) return;
  state.gachas = state.gachas.filter((x) => x.id !== g.id);
  selectGacha(state.gachas[0].id);
});

itemBody.addEventListener("input", function (e) {
  const el = e.target;
  if (!el.dataset || !el.dataset.field) return;
  if (el.dataset.field === "rarity") el.style.color = rarityColor(el.value);
  onItemInput(el.dataset.id, el.dataset.field, el.value);
});

itemBody.addEventListener("click", function (e) {
  const el = e.target;
  if (el.dataset && el.dataset.action === "delete-item") removeItem(el.dataset.id);
});

itemAdd.addEventListener("click", addItem);

for (const btn of document.querySelectorAll(".preset")) {
  btn.addEventListener("click", function () {
    spin(Number(btn.dataset.count));
  });
}

spinBtn.addEventListener("click", function () {
  spin(spinCount.value);
});

spinCount.addEventListener("keydown", function (e) {
  if (e.key === "Enter") spin(spinCount.value);
});

statsReset.addEventListener("click", function () {
  resetStats("統計をリセットしました");
});

// --- 初期化 ---

rateSignature = signature();
renderAll();

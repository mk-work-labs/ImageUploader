// ガチャ設定の保持と localStorage への保存。抽選も DOM も扱わない。
// 保存するのはガチャ設定だけで、結果・統計・履歴は保存しない。
(function () {
  // GitHub Pages はオリジンをリポジトリ間で共有するため、機能名で始まる固有キーにする
  const STORAGE_KEY = "gachaSimulatorState";
  const SCHEMA_VERSION = 1;

  function createId(prefix) {
    return prefix + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  function newItem(rarity, name, rate) {
    return {
      id: createId("i-"),
      rarity: rarity || "",
      name: name || "",
      rate: Math.max(0, Number(rate) || 0),
    };
  }

  function newGacha(name) {
    return { id: createId("g-"), name: name || "新しいガチャ", updatedAt: Date.now(), items: [] };
  }

  // 初回起動用。空の状態から始めさせず、すぐ「回す」を試せるようにする
  function defaultState() {
    const g = newGacha("通常ガチャ");
    g.items = [newItem("SSR", "星の剣", 1.5), newItem("SR", "鋼の盾", 8.5), newItem("R", "木の棒", 90)];
    return { version: SCHEMA_VERSION, selectedId: g.id, gachas: [g] };
  }

  // 保存データが壊れていても画面が真っ白にならないよう、型を整えてから返す
  function normalizeGacha(g) {
    const items = Array.isArray(g && g.items) ? g.items : [];
    return {
      id: (g && g.id) || createId("g-"),
      name: typeof (g && g.name) === "string" ? g.name : "無名のガチャ",
      updatedAt: Number(g && g.updatedAt) || Date.now(),
      items: items.map((it) => ({
        id: (it && it.id) || createId("i-"),
        rarity: typeof (it && it.rarity) === "string" ? it.rarity : "",
        name: typeof (it && it.name) === "string" ? it.name : "",
        rate: Math.max(0, Number(it && it.rate) || 0),
      })),
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const obj = JSON.parse(raw);
      // 未知バージョンは移行せず既定値に倒す
      if (!obj || obj.version !== SCHEMA_VERSION) return defaultState();
      if (!Array.isArray(obj.gachas) || obj.gachas.length === 0) return defaultState();
      const state = {
        version: SCHEMA_VERSION,
        selectedId: obj.selectedId,
        gachas: obj.gachas.map(normalizeGacha),
      };
      if (!findGacha(state, state.selectedId)) state.selectedId = state.gachas[0].id;
      return state;
    } catch (e) {
      return defaultState();
    }
  }

  // プライベートモード等で書けなくても、メモリ上の状態だけで動作は続ける
  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function findGacha(state, id) {
    for (const g of state.gachas) {
      if (g.id === id) return g;
    }
    return null;
  }

  window.GachaStore = {
    STORAGE_KEY,
    SCHEMA_VERSION,
    createId,
    newItem,
    newGacha,
    defaultState,
    loadState,
    saveState,
    findGacha,
  };
})();

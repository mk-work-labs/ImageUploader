// 抽選ロジック。DOM にも localStorage にも触らない純粋関数だけを置く。
// （コンソールから GachaDraw.drawMany(...) を直接叩いて確率を検証できるようにするため）
(function () {
  // --- 累積確率テーブルの構築 ---

  // items: [{ id, rarity, name, rate }] → { ids, rarities, names, rates, cum, total }
  // 確率が 0 以下のアイテムは抽選対象から除外する。
  function buildTable(items) {
    const ids = [];
    const rarities = [];
    const names = [];
    const rates = [];
    const cum = [];
    let sum = 0;
    for (const it of items || []) {
      const rate = Number(it.rate) || 0;
      if (rate <= 0) continue;
      sum += rate;
      ids.push(it.id);
      rarities.push(it.rarity || "");
      names.push(it.name || "");
      rates.push(rate);
      cum.push(sum);
    }
    return { ids, rarities, names, rates, cum, total: sum };
  }

  // --- 1回分の抽選 ---

  // cum は昇順。r を初めて上回る位置が当選位置。二分探索なので
  // アイテム数が増えても比較回数は log2(n) 回で済む。
  function pickIndex(table, r) {
    const cum = table.cum;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (r < cum[mid]) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  // --- まとめて抽選 ---

  // n 回引いて { counts, tail } を返す。
  // counts: テーブル添字ごとの当選数 / tail: 直近 tailLimit 件の添字（時系列順）
  // 乱数を total 倍しているので、確率の合計が 100% でなくても比率どおりに正規化される。
  function drawMany(table, n, tailLimit) {
    const counts = new Array(table.cum.length).fill(0);
    const limit = Math.max(0, Math.min(n, tailLimit || 0));
    const ring = new Array(limit);
    let w = 0;
    for (let i = 0; i < n; i++) {
      const idx = pickIndex(table, Math.random() * table.total);
      counts[idx]++;
      if (limit > 0) {
        ring[w] = idx;
        w = (w + 1) % limit;
      }
    }
    // 全件は保持しない（100万連でもメモリ一定）。リングを時系列順に並べ直して返す。
    const tail = n <= limit ? ring.slice(0, n) : ring.slice(w).concat(ring.slice(0, w));
    return { counts, tail };
  }

  window.GachaDraw = { buildTable, pickIndex, drawMany };
})();

# ガチャシミュレーター

作業ブランチ: `feat/gacha-simulator`
公開 URL: `https://mk-work-labs.github.io/ImageUploader/gacha/`

## Context（なぜやるか）

ガチャの排出確率を試せるシミュレーターがほしい。1つのガチャに複数アイテムを登録し、各アイテムにレアリティと確率（%）を設定して、任意の回数だけ回した結果・統計をその場で確認できるようにする。

ユーザー選択による方針:
- **設置場所**: 既存リポジトリ内。作業ブランチを分け、URL も `docs/gacha/` として画像アップローダーと分離する。
- **複数ガチャ管理**: ガチャを複数作成・切り替え可能。
- **天井・確定枠**: 今回は対象外。
- **回数**: 1連 / 10連 / 100連 のプリセット＋任意回数の入力。
- **確率**: パーセント指定（合計 100%）。**合計が 100% でなくても警告だけ出して回せる**（比率を保って正規化して抽選）。
- **アイテム情報**: レアリティ区分 + 名前 + 確率。レアリティ別集計も出す。
- **保存**: ガチャ設定のみ localStorage に自動保存。**結果・統計・履歴は保存しない**（リロードで消える）。
- **導線**: トップページ `docs/index.html` にガチャへのリンクを追加。

既存コードの流儀（素の HTML/CSS/JS、ビルドツール・npm・CDN 依存ゼロ、ES Modules 不使用、`<script src>` を並べてグローバル変数で受け渡す、UI 文言とコメントは日本語、ダークテーマ固定、インデント2スペース、メディアクエリなし）をそのまま踏襲する。

## 設計判断: 既存 `app.js` / `style.css` は共有しない

- `docs/app.js` は 1〜14 行目でトップレベルに `document.getElementById("file")` 等を取得し、末尾で `loadGallery()` を即実行する。ガチャページで読み込むと `null` 参照で即例外になるため**そもそも共有不可能**。
- `docs/style.css` は共有可能だが `.grid` `.cell` `.status` `.hint` という汎用名を持つ。ガチャ側の都合でこれらを触った瞬間にアップローダーのギャラリーが崩れる。style.css は 70 行しかなく必要部分のコピーは 30 行程度なので、**「既存を壊さないことが最優先」に対して共有はリスクだけが増える**。

→ `docs/gacha/` 配下に完結した独立資産を置く。既存ファイルへの変更は `docs/index.html` へのリンク追加のみ。

## ディレクトリ構成

```
docs/
  index.html          # ★変更（リンク追加のみ、既存行は触らない）
  style.css           # 無変更
  app.js              # 無変更
  config.common.js    # 無変更
  fivem/, mochimochi/ # 無変更
  gacha/              # ★新規
    index.html        # 画面骨格（script を3本並べる既存流儀）
    gacha.css         # ガチャ専用スタイル（独立）
    gacha.store.js    # 設定データ + localStorage（window.GachaStore）
    gacha.draw.js     # 抽選ロジック（DOM 非依存・window.GachaDraw）
    gacha.js          # UI 本体（DOM 取得 → 関数定義 → addEventListener → 末尾で初期化）
worker/               # 無変更（Worker は一切関与しない）
```

スクリプト3分割は既存の `config.common.js` → `config.js` → `app.js` と同じ流儀。加えて `gacha.draw.js` が DOM 非依存の純粋関数だけになるので、**確率の正しさを DevTools コンソールから単独検証できる**（検証手順で効く）。

`docs/fivem/index.html` 43〜45 行目と同じ並べ方:

```html
    <script src="gacha.store.js"></script>
    <script src="gacha.draw.js"></script>
    <script src="gacha.js"></script>
```

## 画面レイアウト

1ページ完結。上から縦積み。メディアクエリなしで `flex-wrap` と `max-width` だけで狭幅に追従させる。

```
┌──────────────────────────────────────────────────────────┐
│ ← トップ                                                  │  header
│ ガチャシミュレーター                                       │
├──────────────────────────────────────────────────────────┤
│ ガチャ: [通常ガチャ ▼] [新規] [名前変更] [複製] [削除]      │  .toolbar
├──────────────────────────────────────────────────────────┤
│ アイテムと確率                    合計 100.00%             │  .editor
│ ┌───────┬──────────────┬─────────┬──────┐                │
│ │ レア   │ アイテム名     │ 確率(%) │      │                │
│ ├───────┼──────────────┼─────────┼──────┤                │
│ │[SSR ▾]│[星の剣      ] │[   1.5 ]│[削除]│                │
│ │[SR  ▾]│[鋼の盾      ] │[   8.5 ]│[削除]│                │
│ │[R   ▾]│[木の棒      ] │[  90.0 ]│[削除]│                │
│ └───────┴──────────────┴─────────┴──────┘                │
│ [+ アイテムを追加]                                         │
│ ⚠ 合計が 98.00% です。比率を保ったまま正規化して抽選します │  .warn
├──────────────────────────────────────────────────────────┤
│ 回数: [1連][10連][100連][1000連]  任意 [  5000 ] [回す]    │  .spin
│                                          [統計リセット]    │
│ 5,000回を 42ms で抽選しました                              │  .status
├──────────────────────────────────────────────────────────┤
│ 今回の結果（直近100件まで表示）                             │  .result-list
│ (R 木の棒)(R 木の棒)(SR 鋼の盾)(SSR 星の剣)(R 木の棒)…     │  .chip
├──────────────────────────────────────────────────────────┤
│ 統計 — 通算 5,000 回                                       │  .stats
│ ┌─────┬──────────┬───────┬───────┬────────┬───────┐     │
│ │ レア │ アイテム  │ 設定% │ 当選数│ 実測%  │ 差分  │     │
│ ├─────┼──────────┼───────┼───────┼────────┼───────┤     │
│ │ SSR │ 星の剣    │  1.50 │    71 │  1.42 │ -0.08 │     │
│ │ ▇▇░░░░░░░ 実測バー（設定%位置にマーカー）        │     │
│ └─────┴──────────┴───────┴───────┴────────┴───────┘     │
│ 【レアリティ別】 SSR 71 (1.42%) / SR 430 (8.60%) / …      │  .rarity-summary
├──────────────────────────────────────────────────────────┤
│ 履歴（直近50ロット）                                       │  .history-list
│ 14:03:21  1000連 → SSR 星の剣 ×14 / SR 鋼の盾 ×88 / …     │
│ 14:02:55  10連  → SR 鋼の盾 ×1 / R 木の棒 ×9              │
└──────────────────────────────────────────────────────────┘
```

**「今回の結果」と「履歴」を分ける意図**: 前者は個々の排出（10連の中身を見たい）、後者はロット単位のログ（何千連を何回回したか）。数万回時に前者を全件描画しないための線引きでもある。

主な id / class（既存の `.uploader` `.gallery-head` `.modal-box` `.hint` と同じ「ケバブケースの単語」粒度、BEM なし、id は JS フック専用）:

`#gacha-select` `#gacha-add` `#gacha-rename` `#gacha-copy` `#gacha-delete` `#item-table` `#item-add` `#rate-total` `#rate-warn` `#spin-count` `#spin` `#spin-status` `#stats-reset` `#result-list` `#stats-body` `#rarity-summary` `#total-count` `#history-list` /
`.toolbar` `.editor` `.item-table` `.item-row` `.rate-total` `.warn` `.spin` `.result-list` `.chip` `.stats-table` `.bar` `.bar-fill` `.rarity-tag` `.history-list` `.hint`

色は既存 `docs/style.css` を踏襲（背景 `#11151c` / パネル `#1b212b` / 枠 `#232a35` / 文字 `#e7ecf3` / 副文字 `#9aa7b8` / アクセント `#3a7afe` / 危険 `#e0443e`）。既存同様 **CSS 変数は使わず直書き**。

### レアリティの扱い

- `rarity` は自由入力テキスト（`<input list="rarity-presets">` で SSR / SR / R / N / UR を候補表示）。増やしたいレアリティに縛りをかけない。
- 色は既知名に固定色を割り当てるハードコード表1つで済ませる。未知の名前は副文字色にフォールバック。

```js
// レアリティ表示色。未知のレアリティは既定色にフォールバックする
const RARITY_COLORS = {
  UR: "#e0443e", SSR: "#e8b64c", SR: "#a06ade", R: "#3a7afe", N: "#9aa7b8",
};
```

- 統計の下に**レアリティ別集計**（同じ `rarity` 文字列でグループ化した当選数と実測%）を出す。

## localStorage スキーマ

```js
const STORAGE_KEY = "gachaSimulatorState";
const SCHEMA_VERSION = 1;
```

キー名は既存 `TOMBSTONE_KEY = "deletedTombstones"` と同じ「接頭辞なしキャメルケース」の流儀。ただし **GitHub Pages は `https://mk-work-labs.github.io` というオリジンをリポジトリ横断で共有する**ため、`gachaSimulator` と機能名で始まる十分に固有な名前にすること（`state` や `data` 単独は禁止）。

```json
{
  "version": 1,
  "selectedId": "g-lz3k9p-x7a2b",
  "gachas": [
    {
      "id": "g-lz3k9p-x7a2b",
      "name": "通常ガチャ",
      "updatedAt": 1758499200000,
      "items": [
        { "id": "i-lz3k9p-9f1c0", "rarity": "SSR", "name": "星の剣", "rate": 1.5 },
        { "id": "i-lz3k9q-2b8de", "rarity": "SR",  "name": "鋼の盾", "rate": 8.5 },
        { "id": "i-lz3k9q-71aa4", "rarity": "R",   "name": "木の棒", "rate": 90 }
      ]
    }
  ]
}
```

- `version` を見て、未知なら移行せず `defaultState()` にフォールバックする（壊れた JSON で画面が真っ白になるのを防ぐ）。将来天井を足すときの入口にもなるので 1 行でも入れておく。
- **履歴・統計は `state` に入れない**（保存不要の要件）。
- `rate` は数値で保持する。入力値は `Number()` 変換してから格納し、`NaN` は `0` に丸める。
- 保存タイミング: 入力の `input` イベントで state 更新 → **300ms デバウンスして `saveState()`**。ガチャ追加/削除/切替は即時保存。
- `localStorage` が使えない環境（プライベートモード等）は `try { } catch { }` で握りつぶしメモリのみで継続。`docs/app.js` 45〜53 行目 `addTombstone` と同じ作法。
- 初回起動時はサンプルガチャ1件（SSR 1.5 / SR 8.5 / R 90）を投入する。真っ白から「まずガチャを作る」を強いると触り始めの障壁になるため。

## 抽選アルゴリズム（`gacha.draw.js`）

```js
// --- 抽選ロジック（DOM に触らない純粋関数） ---

// items: [{ id, rarity, name, rate }] → 累積確率テーブル
// 確率0以下のアイテムは抽選対象から除外する
function buildTable(items)              // → { ids, rarities, names, rates, cum, total }

// 0 <= r < table.total の乱数から当選インデックスを二分探索で求める
function pickIndex(table, r)            // → number

// n 回まとめて抽選する
// counts: テーブル添字ごとの当選数 / tail: 直近 tailLimit 件の添字（時系列順）
function drawMany(table, n, tailLimit)  // → { counts, tail }
```

```js
function pickIndex(table, r) {
  const cum = table.cum;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (r < cum[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
```

- **累積テーブル＋二分探索を採用する**。アイテム10個なら線形でも実害はないが、100万回 × 50 アイテムだと最悪 5000 万回の比較になる一方、二分探索なら約6回。追加コストは上記10行だけなので採る。
- テーブル構築は編集時ではなく**「回す」を押した瞬間に1回だけ**行う。
- 乱数は `Math.random() * table.total`。これにより**合計が 100% でなくても比率どおりの正規化抽選が自動的に成立する**（rate を割り算する処理は不要）。
- `tail` は**リングバッファで直近100件だけ**保持する。n 件すべてを配列に push しないので 100 万連でもメモリは一定。

```js
function drawMany(table, n, tailLimit) {
  const counts = new Array(table.cum.length).fill(0);
  const limit = Math.min(n, tailLimit);
  const ring = new Array(limit);
  let w = 0;
  for (let i = 0; i < n; i++) {
    const idx = pickIndex(table, Math.random() * table.total);
    counts[idx]++;
    if (limit > 0) { ring[w] = idx; w = (w + 1) % limit; }
  }
  // リングを時系列順に並べ直す
  const tail = n <= limit ? ring.slice(0, n) : ring.slice(w).concat(ring.slice(0, w));
  return { counts, tail };
}
```

### 任意回数の上限

- `<input type="number" id="spin-count" min="1" max="1000000" step="1">` で**上限 100 万**。
- 100 万回でも抽選ループ自体は数十〜数百 ms（DOM 更新は最後に3回だけ）なので、UI 凍結は実用上問題にならない。チャンク分割や Web Worker 化は複雑さに見合わないので**入れない**。
- **10 万回を超える指定は `window.confirm()` で確認**する（`docs/app.js` 195 行目の削除確認と同じ作法）。
- 実行前に `spinBtn.disabled = true` と「抽選中...」を出し、`finally` で復帰。`app.js` 92〜114 行目と同じ骨格。
- 完了後は `performance.now()` の差分で「5,000回を 42ms で抽選しました」と表示する。

## 合計が 100% でないときの扱い

**警告は出すが回せる。比率を保って正規化して抽選する**（ユーザー選択）。

- 判定は `Math.abs(total - 100) < 1e-9`。`0.1 + 0.2` の浮動小数誤差で 100% 扱いにならない事故を防ぐ。
- 100% のとき: `#rate-total` に「合計 100.00%」を副文字色で表示、警告行は非表示。
- 100% でないとき: `#rate-total` を危険色 `#e0443e` にし、`#rate-warn` に「合計が 98.00% です。比率を保ったまま正規化して抽選します」と表示。**統計表の「設定%」列も正規化後の値（`rate / total * 100`）を表示する**。そうしないと実測%との比較が常にズレて見え、比較機能が意味をなさない。
- **回せないのは次の2ケースだけ**（`#spin` を `disabled` にし理由を `.hint` に表示）:
  - アイテムが 0 件
  - 確率が 0 より大きいアイテムが 1 件もない（`table.total === 0`）

## 履歴・統計の扱い（大量回数時のパフォーマンス）

数万回を全件 DOM 描画すると固まるので、**保持と描画の両方を上限で切る**。

| 領域 | 保持 | 描画 | 実装 |
|---|---|---|---|
| 今回の結果 `#result-list` | 直近 100 件（`RESULT_MAX`） | 全件（最大100チップ） | `drawMany` の `tail` をそのまま |
| 統計 `#stats-body` | アイテム数ぶんのカウンタのみ | 行数 = アイテム数 | セッション累計 `statsCounts`（id → 当選数） |
| 履歴 `#history-list` | 直近 50 ロット（`HISTORY_MAX`） | 全件（最大50行） | 「回す」1回につき1行 |

- 統計は**個々の結果を貯めずカウンタで累積**する。`drawMany` の `counts` をアイテム id 単位の累計に足し込むだけなので、回数に依らず O(アイテム数)。回を重ねるほど実測%が設定%に収束する様子が見える。
- 統計の累計は**ガチャ切り替え時 / アイテム構成・確率の変更時に自動リセット**する（異なる設定の結果を混ぜると「設定% vs 実測%」が無意味になる）。リセット時は `.hint` に「設定が変更されたため統計をリセットしました」と明示。`#stats-reset` で手動リセットも可能。
- 描画は `innerHTML = ""` → `DocumentFragment` に組んで1回 append（既存 `renderGrid()` と同じ骨格）。
- **ユーザー入力（アイテム名・レアリティ・ガチャ名）は必ず `textContent` / `input.value` で入れる。`innerHTML` に文字列連結しない。** 既存 `app.js` は `innerHTML` を使っているが中身は固定文字列のみ。ガチャ側はユーザー入力を扱うのでここだけ規律を変える。

## 関数の責務分担

### `gacha.store.js` → `window.GachaStore`

| 関数 | 責務 |
|---|---|
| `createId(prefix)` | `prefix + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7)` |
| `defaultState()` | サンプルガチャ1件入りの初期 state |
| `loadState()` | JSON パース失敗・version 不一致・構造不正なら `defaultState()`。`try/catch` 必須 |
| `saveState(state)` | `JSON.stringify` して書き込み。失敗は握りつぶす |
| `findGacha(state, id)` | 選択中ガチャを返す。無ければ先頭 |
| `newGacha(name)` / `newItem()` | 空のガチャ・アイテムを生成 |

### `gacha.draw.js` → `window.GachaDraw`

`buildTable` / `pickIndex` / `drawMany` の3つ。**DOM・localStorage に一切触らない。**

### `gacha.js`（UI・単一スクリプト構成）

`docs/app.js` と同じ「トップレベルで DOM 取得 → 関数定義 → `addEventListener` → 末尾で初期化」。`// --- 抽選実行 ---` のような日本語コメントでセクションを区切る。

```js
// --- ガチャ選択 ---
function renderGachaSelect()
function selectGacha(id)

// --- アイテム編集 ---
function renderItemTable()
function onItemInput(itemId, field, value)  // state 更新 → 合計再計算 → デバウンス保存 → 統計リセット
function renderRateTotal()                  // 合計表示 + 警告 + 回すボタンの活性制御

// --- 抽選実行 ---
function spin(count)

// --- 結果・統計・履歴の描画 ---
function renderResult(table, tail)
function renderStats(table)                 // アイテム別 + レアリティ別
function renderHistory()
function resetStats(reason)
```

`spin(count)` の処理フロー:

1. `count` を検証（1 以上の整数、上限 1,000,000 にクランプ）
2. `buildTable(gacha.items)` → `total === 0` なら理由を出して return
3. 10 万超なら `window.confirm()`
4. `spinBtn.disabled = true`、`#spin-status` に「抽選中...」
5. `performance.now()` を挟んで `drawMany(table, count, RESULT_MAX)`
6. `counts` をアイテム id 単位のセッション累計に加算、`totalCount += count`
7. `renderResult` / `renderStats` / `renderHistory` を各1回呼ぶ（DOM 更新は計3回のみ）
8. `finally` で `spinBtn.disabled = false`、所要時間を表示

統計行の「差分」は `実測% − 設定%(正規化後)` をパーセントポイントで符号付き表示（プラスは緑、マイナスは赤）。バーは `.bar-fill` の `style.width` に実測%、設定%位置に細い縦マーカーを絶対配置し、収束具合を目視できるようにする。

## `docs/index.html` へのリンク追加

現行の `<ul class="stores">` は「店舗一覧」なので、ガチャをその中に混ぜるのは意味的に誤り。**別セクションとして下に足す**（既存行は一切変更しない、純粋な追加のみ）。

```html
    <!-- 店舗アップローダーとは独立したツール -->
    <ul class="stores">
      <li><a href="gacha/">ガチャシミュレーター</a></li>
    </ul>
```

`.stores` `h2` はどちらも `docs/style.css` に既存定義があるので **`style.css` は無変更**。ガチャページ側のヘッダには `docs/fivem/index.html` 12 行目と同じ作法で戻りリンクを置く。

```html
      <p class="back"><a href="../">← トップ</a></p>
```

## 実装ステップ

1. ブランチ作成 `git switch -c feat/gacha-simulator`（`main` から）
2. `Plans/2026-09-22-gacha-simulator.md` に本プランを保存（プランニング運用ルールに従い、実行フェーズの最初の作業として行う）
3. `docs/gacha/gacha.draw.js` — 純粋関数。依存なし。**最初に作って単体で検証できる状態にする**
4. `docs/gacha/gacha.store.js` — 依存なし
5. `docs/gacha/index.html` — 静的骨格と id を確定
6. `docs/gacha/gacha.css` — `docs/style.css` の body / button / .status / .hint / .back 相当をコピーして起点にする
7. `docs/gacha/gacha.js` — ガチャ選択 → アイテム編集 → 抽選 → 結果/統計/履歴 の順に段階実装
8. `docs/index.html` にリンク追加
9. 検証 → コミット（Conventional Commits の既存流儀。例 `feat: add gacha simulator page`）

## 検証手順

**ローカル起動**

```
python3 -m http.server 8000 --directory /Users/snsnap1192/repository/Personal/ImageUploader/docs
# → http://localhost:8000/gacha/
```

`fetch` を使わないので `file://` 直開きでも動く見込みだが、ブラウザにより `localStorage` のオリジン制約が入るため **http で確認する**。

**機能確認**

1. 初回アクセスでサンプルガチャが表示され、すぐ「10連」が回せる
2. アイテムの追加・レアリティ/名前/確率の変更 → リロードしても保持されている
3. ガチャを新規作成して切り替え → それぞれの設定が独立して保持される
4. 合計を 98% にする → 赤字警告が出るが回せる。統計の「設定%」が正規化値になる
5. 確率 0% のアイテムは一度も出ない
6. アイテム 0 件 / 全 0% で「回す」が無効化され、理由が表示される
7. 任意回数 5000 を入力して一括実行、履歴が1行増える
8. 履歴が 50 行、今回の結果が 100 チップで頭打ちになる
9. レアリティ別集計の合計が総回数と一致する。未知のレアリティ名でも表示が壊れない
10. `<script>alert(1)</script>` というアイテム名を入れてもスクリプトが実行されない

**確率が正しいことの確認**

- UI から: 設定 `1.5 / 8.5 / 90` で **100 万連を1回**。実測%が設定%と ±0.1pt 以内に収まること（p=0.015・n=10^6 の標準誤差は約 0.012pt なので、0.1pt を超えて外れ続けるならロジックのバグを疑う）。
- コンソールから（`gacha.draw.js` は DOM 非依存なので直接叩ける）:

```js
const t = GachaDraw.buildTable([
  { id: "a", rarity: "SSR", name: "A", rate: 1.5 },
  { id: "b", rarity: "SR",  name: "B", rate: 8.5 },
  { id: "c", rarity: "R",   name: "C", rate: 90 },
]);
const r = GachaDraw.drawMany(t, 1000000, 0);
r.counts.reduce((a, b) => a + b, 0);                    // → 1000000
r.counts.map((c, i) => (c / 1e4).toFixed(3) + "% (設定 " + t.rates[i] + "%)");
```

- 境界: `pickIndex(t, 0)` が 0、`pickIndex(t, t.total - 1e-9)` が最終インデックス。単一アイテム（100%）なら常に同じものが出る。
- 正規化: 合計 50（例 `0.75 / 4.25 / 45`）にしても実測比率が `1.5 : 8.5 : 90` と同じになること。

**回帰確認（最優先）**

11. `http://localhost:8000/fivem/` と `/mochimochi/` が従来どおり動作する
12. `git diff main --stat` で、既存ファイルの変更が `docs/index.html` の追加数行のみであること
13. push 後、GitHub Pages 反映を待って `https://mk-work-labs.github.io/ImageUploader/gacha/` と既存店舗ページの両方を確認

## 今回スコープ外

- 天井・確定枠（`gacha` に `pity` を足して `version: 2` で拡張可能な構造にしてある）
- 排出演出・アニメーション、アイテム画像の表示
- 履歴・統計の永続化、CSV エクスポート
- ガチャ設定の JSON インポート／エクスポート、URL 共有
- 複数人での共有（Worker / KV は使わない）

---

## 実装時の補足（2026-09-22 実装後に追記）

プランからの差分は次の4点。いずれも動作確認の結果を反映したもの。

1. **`docs/style.css` に1行だけ追加**: ランディングに「ツール」見出しを置くと、`.stores`（`padding: 20px 24px`）と左端が揃わないため `.tools-head { margin: 20px 24px 0; }` を末尾に追加した。既存要素がこのクラスを使っていないため、アップローダー側への影響はない。
2. **表を `.table-wrap` で囲んだ**: 狭い画面でアイテム表・統計表が画面幅を超えてページ全体が横スクロールしてしまうため、`overflow-x: auto` のラッパを入れて「表だけが横スクロールする」形にした（メディアクエリは使っていない）。
3. **統計バーの目盛りを行ごとに取る**: 全アイテムの最大値を基準にすると 1.5% のような小さい確率のバーが潰れて過不足が読めなかったため、行ごとに `max(設定%, 実測%) * 1.3` を基準にした。設定値の位置に白いマーカーを置き、バーがマーカーを超えていれば出過ぎ、届いていなければ出不足と読める。
4. **統計の自動リセット条件を絞った**: 「アイテム構成・確率の変更時」ではなく「確率の分布が変わったとき」（アイテムの id と確率の組み合わせ）に限定した。アイテム名やレアリティの変更は分布に影響しないため統計を維持する。

### 検証結果

- `gacha.draw.js` 単体（Node）: 100万回 9ms、当選数の合計が入力回数と一致、`pickIndex` の境界、合計50%時の正規化、単一アイテム100%をいずれも確認。
- ヘッドレス Chrome によるUIテスト 35項目すべて PASS（初期表示・10連・チップ上限100件・履歴・統計の当選数合計・98%時の警告と正規化された設定%・確率変更での統計リセット・名前変更では維持・アイテム名のスクリプト文字列が実行されないこと・localStorage 保存・ガチャの新規/複製/切替/削除・0件および0%時の抽選不可・再読込・統計リセット）。
- ブラウザ上の100万連: 実測% が設定% と ±0.012pt 以内、結果チップは100件で頭打ち、統計の当選数合計は 1,000,000。
- `/fivem/` の表示に変化がないことを確認（`app.js` は無変更）。

### 自己レビューで修正した点（実装後）

| # | 内容 | 影響 |
|---|---|---|
| 1 | 負の確率を 0 に丸める（`onItemInput` と `gacha.store.js` の両方） | 負値は抽選対象から除外されるのに合計には効いてしまい、統計の「設定%」が実際の分布とズレていた |
| 2 | 合計の表示を `toFixed(2)` から末尾 0 を落とす形式に変更し、100% 判定の許容誤差を表示桁に合わせた | 99.999999% が「合計 100.00%」と表示されながら警告も出る、という食い違いを解消 |
| 3 | 履歴の時刻をゼロ埋め（`0:28:21` → `00:28:21`） | 表示の揃い |
| 4 | `syncStats()` が真偽値を返すようにし、統計を維持したときだけ再描画する | 入力のたびに統計表を二重描画していた |
| 5 | `renderGachaSelect()` で選択中 id を実体に揃える | 選択中 id がズレるとセレクトが空欄になりうる |

### 常設のスモークテスト `tests/gacha-smoke.html`

`docs/gacha/` の実ファイルを読み込んで自動操作し、44 項目を検証するページ。GitHub Pages は `main` ブランチの `/docs` だけを配信するので、`tests/` は公開されない。

```
python3 -m http.server 8000            # リポジトリ直下で実行
# → http://localhost:8000/tests/gacha-smoke.html
```

実行前に `gachaSimulatorState` を退避し、終了時に戻すので、普段使っている設定は壊れない。

### 統計ゲージの作り直し（レビュー後）

当初のゲージは行ごとに `max(設定%, 実測%)` を基準にしていたため、実測 1.091% と 90.273% のバーがほぼ同じ長さになり、隣の数値列と対応が取れていなかった。**差分ゲージ**に作り直した。

- 中央が差分0。右（緑 `#4caf7d`）に伸びれば出過ぎ、左（赤 `#e0443e`）に伸びれば出不足で、「差分」列の符号と色が一致する。
- 目盛りは全行共通で `max(|差分|) * 1.2`。最もズレている行が端いっぱいになるので、行どうしのズレの大きさを比較できる。
- 中央の基準線はバーの端と重なっても見えるよう `z-index` で前面に出す。
- 読み方は統計パネル下の1行で明示する。

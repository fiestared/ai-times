/**
 * USD/JPY の為替レートを取得して docs/data/fx.json に保存する。
 *
 * なぜ必要か（2026-07-28の調査が根拠）:
 *   「Claude API 料金 日本円」「Haiku 4.5 料金 日本円」等のクエリでは、上位の記事が
 *   **1USD=155円のような固定レートで円換算**しており、書かれた瞬間から古くなっていく。
 *   実測でもこのサイト自身の kasegu ページが USDJPY=155 のハードコードで、実勢163.64円に対して
 *   5.6%ずれていた（＝他社を「古い」と批判できる立場ではなかった）。
 *   毎日レートを取り直して円を出せるのは、毎日動くサイトだけができること。
 *
 *   node tools/fetch_fx.mjs         取得して data/fx.json を更新
 *   node tools/fetch_fx.mjs --dry   取得して表示するだけ
 *
 * 出典: 欧州中央銀行(ECB)の参照レートを配信する Frankfurter API（無料・キー不要）。
 *   ECBは営業日ごとに参照レートを公表するので、土日祝は直近営業日の日付が返る。
 *   ★取得に失敗したら**古い値を残したまま何もしない**（fail-closed）。推測レートは書かない。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs/data/fx.json");
const DRY = process.argv.includes("--dry");
const API = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY";

let r;
try {
  const res = await fetch(API, { headers: { "User-Agent": "aitimes.jp/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  r = await res.json();
} catch (e) {
  console.error(`✗ 為替レートの取得に失敗: ${e.message}`);
  console.error("  既存の data/fx.json はそのまま残す（推測レートを書かない）。");
  process.exit(1);
}

const rate = r?.rates?.JPY;
const date = r?.date;
// 妥当性の検査。APIが壊れた値を返したときに、それを「今日のレート」として公開しないため。
// 過去50年のUSD/JPYはおおよそ 75〜360 の範囲。ここを外れたら取得失敗として扱う。
if (typeof rate !== "number" || !(rate > 75 && rate < 360) || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
  console.error(`✗ 返ってきた値が妥当でない: rate=${rate} date=${date}。書き込まない。`);
  process.exit(1);
}

const next = {
  _meta: {
    title: "為替レート（USD→JPY）",
    note: "AI各社のAPI料金は米ドル建て。円換算の目安に使う参照レート。実際の請求は各社・カード会社の換算レートによる。",
    source_name: "欧州中央銀行（ECB）参照レート / Frankfurter API",
    source_url: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html",
    api: API,
  },
  usd_jpy: rate,
  rate_date: date,      // ECBが公表した日（土日祝は直近営業日）
  fetched_at: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
};

const cur = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
console.log(`USD/JPY = ${rate}（ECB ${date} 公表）` + (cur ? `  ← 前回 ${cur.usd_jpy}（${cur.rate_date}）` : ""));
if (DRY) { console.log("[--dry] 書き込んでいません。"); process.exit(0); }

const text = JSON.stringify(next, null, 2) + "\n";
if (!cur || cur.usd_jpy !== rate || cur.rate_date !== date) {
  writeFileSync(OUT, text);
  console.log(`✓ data/fx.json を更新`);
} else {
  console.log("変更なし（レートも公表日も同じ）");
}

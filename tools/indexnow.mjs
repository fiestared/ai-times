/**
 * IndexNow で更新URLを Bing（および対応検索エンジン）へ即時通知する（AI TIMES 用）。
 *
 * なぜ: aitimes.jp は新規ドメインで Google 索引が遅く、被覆率6%（1ヶ月で表示7）。Bing は
 * IndexNow に対応し、ping した URL を数時間〜で取りに来る。Bing の索引は ChatGPT検索/Copilot/
 * DuckDuckGo にも供給されるので、「更新したら即 Bing に載る」導線になる。soba/news を push したら流す。
 *
 *   node tools/indexnow.mjs <url|path> [...]   指定URL(またはdocs配下パス)を通知
 *   node tools/indexnow.mjs --auto             直近コミットで変わった docs/*.html を自動通知
 *   node tools/indexnow.mjs --auto --dry       送らず対象だけ表示（確認用）
 *
 * 鍵ファイル: docs/<KEY>.txt（サイトルートに公開・中身は鍵そのもの）。鍵を変えたら下の KEY と
 * docs/<KEY>.txt の両方を直す。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KEY = "75be4f0dbe955463bf7ab5774c8c7177";
const HOST = "aitimes.jp";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const ENDPOINT = "https://api.indexnow.org/IndexNow";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const DRY = process.argv.includes("--dry");
const AUTO = process.argv.includes("--auto");

// docs 配下の index.html パス → 公開URL（/foo/index.html → https://host/foo/、docs/index.html → ルート）
function pathToUrl(p) {
  let rel = p.replace(/^.*docs\//, "").replace(/index\.html$/, "");
  if (!/^https?:\/\//.test(rel)) return `https://${HOST}/${rel}`;
  return rel;
}

let inputs = process.argv.slice(2).filter((a) => !a.startsWith("--"));

// ★データ駆動ページは index.html が変わらないので、JSON→ページ の対応も見る。
// news/ tools/ kasegu/ は data/*.json を JS で読んで描画する形。index.html のコミットだけを
// 見ていると、毎日中身が変わる /news/ が **一度もBingに通知されない**（2026-07-23 に発覚。
// 新規ドメインでBing索引の高速化が生命線なのに、いちばん更新頻度の高いページが漏れていた）。
const DATA_PAGES = {
  "docs/data/news.json": ["docs/index.html", "docs/news/index.html"],
  "docs/data/soba.json": ["docs/index.html", "docs/soba/index.html"],
  "docs/data/tools.json": ["docs/index.html", "docs/tools/index.html"],
  "docs/data/kasegu.json": ["docs/index.html", "docs/kasegu/index.html"],
};

if (AUTO) {
  const out = execFileSync("git", ["show", "--name-only", "--pretty=format:", "HEAD"],
    { cwd: ROOT, encoding: "utf8" });
  const changed = out.split("\n").filter(Boolean);
  inputs = [...new Set([
    ...changed.filter((l) => /^docs\/.*index\.html$/.test(l)),
    ...changed.flatMap((l) => DATA_PAGES[l] || []),
  ])];
}

const urls = [...new Set(inputs.map((a) => {
  if (/^https?:\/\//.test(a)) return a;
  if (a.includes("index.html") || a.startsWith("docs/") || existsSync(join(ROOT, a)))
    return pathToUrl(a);
  return `https://${HOST}/${a.replace(/^\/+/, "")}`;
}))];

if (!urls.length) {
  console.error("通知するURLがありません。URL/パスを渡すか --auto を使ってください。");
  process.exit(1);
}

console.log(`IndexNow 通知先 ${urls.length}件:`);
for (const u of urls) console.log("  " + u);

if (DRY) { console.log("\n[--dry] 送信していません。"); process.exit(0); }

const body = { host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: urls };
const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});
console.log(`\nIndexNow 応答: HTTP ${res.status} ${res.statusText}`);
if (res.status === 200 || res.status === 202) {
  console.log("✓ 受理されました（反映はBing側の都合で数時間〜）。");
} else {
  const t = await res.text().catch(() => "");
  console.error(`✗ 受理されず: ${t.slice(0, 300)}`);
  process.exitCode = 1;
}

/**
 * Search Console に sitemap.xml を再送信して、Googleに「取りに来い」と伝える。
 *
 * なぜ必要か（2026-07-28の実測が根拠）:
 *   GSC の sitemaps API で見たところ lastDownloaded が **2026-07-18 で止まっていた**。
 *   07-19 に足した記事4本は、10日経ってもGoogleが「URLを知らない(crawl:never)」状態だった。
 *   sitemap を更新しても、誰も再送信していなければ Google はいつ取りに来るか分からない。
 *   （Googleの旧 ping エンドポイント /ping?sitemap= は2023年に廃止済み。今はこのAPIが正規の手段。
 *     Indexing API はジョブ/ライブ配信専用で、ニュースサイトへの使用は公式に対象外。）
 *
 *   node tools/ping_google.mjs        再送信
 *   node tools/ping_google.mjs --dry  送らずに現在の登録状況だけ表示
 *
 * 認証: keiri-tools と同じ既存SA `ga-reader@keiri-tools.iam.gserviceaccount.com`。
 *   鍵は ~/.keiri-analytics/sa.json か、環境変数 KEIRI_SA_JSON（このMacは
 *   ~/Scripts/ai-income-daily/ga-sa-key.json にある）。**新しいGCP/SAを作らないこと。**
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSign } from "node:crypto";

const SITE = "sc-domain:aitimes.jp";
const FEED = "https://aitimes.jp/sitemap.xml";
const DRY = process.argv.includes("--dry");

const CANDIDATES = [
  process.env.KEIRI_SA_JSON,
  join(homedir(), ".keiri-analytics/sa.json"),
  join(homedir(), "Scripts/ai-income-daily/ga-sa-key.json"),
].filter(Boolean);
const SA_PATH = CANDIDATES.find((p) => existsSync(p));
if (!SA_PATH) {
  console.error("✗ SAキーが見つからない。KEIRI_SA_JSON を設定するか ~/.keiri-analytics/sa.json を置く");
  console.error("  探した場所: " + CANDIDATES.join(" / "));
  process.exit(1);
}
const sa = JSON.parse(readFileSync(SA_PATH, "utf8"));

async function token() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = b64({ alg: "RS256", typ: "JWT" }) + "." + b64({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/webmasters",
    aud: sa.token_uri, iat, exp: iat + 3600,
  });
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const r = await fetch(sa.token_uri, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${sig}`,
    }),
  }).then((r) => r.json());
  if (!r.access_token) { console.error("✗ トークン取得失敗:", JSON.stringify(r).slice(0, 300)); process.exit(1); }
  return r.access_token;
}

const tk = await token();
const base = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/sitemaps`;

async function status() {
  const r = await fetch(base, { headers: { Authorization: `Bearer ${tk}` } }).then((r) => r.json());
  for (const s of r.sitemap || []) {
    const c = (s.contents || [])[0] || {};
    console.log(`  ${s.path}\n    最終送信: ${s.lastSubmitted || "—"} / 最終取得: ${s.lastDownloaded || "—"}` +
      ` / 収録${c.submitted || 0} 索引${c.indexed || 0} / 警告${s.warnings || 0} エラー${s.errors || 0}`);
  }
  if (!r.sitemap?.length) console.log("  (登録されたsitemapが無い)");
}

console.log("現在の登録状況:");
await status();

if (DRY) { console.log("\n[--dry] 送信していません。"); process.exit(0); }

const r = await fetch(`${base}/${encodeURIComponent(FEED)}`, {
  method: "PUT", headers: { Authorization: `Bearer ${tk}` },
});
if (r.status !== 204 && r.status !== 200) {
  console.error(`✗ sitemap再送信に失敗: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  process.exit(1);
}
console.log(`\n✓ sitemap を再送信した (HTTP ${r.status}): ${FEED}`);

/**
 * AI相場(soba.json)を soba/index.html に**静的HTMLとして焼き込む**。
 *
 * なぜ静的化するか:
 *   相場表は入力のない純表示データ。クライアントfetchで描くと、生HTMLに中身が無く
 *   Googlebot以外のクローラ(AI回答エンジン/SNSのOGP/SEOツール)が読めない＝サイト唯一の
 *   差別化資産(毎日照合する価格表)が初回クロールで不可視になる。だから静的化する。
 *   JSONを正本、HTMLを生成物にする(keiri-tools の gen_index_sitemap と同じ設計)。
 *
 *   node tools/gen_soba.mjs          生成(冪等)
 *   node tools/gen_soba.mjs --check  差分があれば失敗(CI用)
 *
 * ワーカーは soba.json を更新した直後にこれを走らせる。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = join(ROOT, "docs/soba/index.html");
const DATA = join(ROOT, "docs/data/soba.json");
const CHECK = process.argv.includes("--check");

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const WD = ["日", "月", "火", "水", "木", "金", "土"];
function fmtDate(iso) {
  if (!iso) return "—";
  const p = String(iso).split("-");
  if (p.length < 3) return iso;
  const dt = new Date(+p[0], +p[1] - 1, +p[2]);
  return `${p[0]}年${+p[1]}月${+p[2]}日（${WD[dt.getDay()]}）`;
}

const d = JSON.parse(readFileSync(DATA, "utf8"));
const meta = d._meta || {};
const rows = (d.models || []).filter((m) => m.verified && m.input != null);

// --- 相場テーブル(JS版と同じ体裁) ---
let table;
if (!rows.length) {
  table = '<p class="loading">AI相場は公開前の最終照合中です。各社の公式価格を裏取りしてから掲載します（推測値は載せません）。</p>';
} else {
  const body = rows.map((m) => {
    const chg = m.delta
      ? `<span class="chg"><span class="ar">${esc(m.delta.mark || "")}</span> ${esc(m.delta.text)}</span>`
      : (m.tag ? `<span class="tagx">${esc(m.tag)}</span>` : '<span class="chg" style="color:var(--ink-3)">— 据置</span>');
    const srcLink = m.src ? `<a href="${esc(m.src)}" rel="noopener" target="_blank">出典 ↗</a>` : "—";
    const note = m.note ? `<div class="pv" style="margin-top:3px">${esc(m.note)}</div>` : "";
    return `<tr><td><span class="m">${esc(m.name)}</span> <span class="pv">${esc(m.provider)}</span>${note}</td>` +
      `<td class="n">$${esc(m.input)}</td><td class="n">$${esc(m.output)}</td>` +
      `<td class="n">${esc(m.context_k)}K</td><td>${chg}</td>` +
      `<td class="mono" style="font-size:11px">${srcLink}</td></tr>`;
  }).join("");
  table = `<div class="market"><div class="mh"><b>Model &amp; Price Index — 全${rows.length}件</b>` +
    `<span class="as mono">as of ${esc(meta.as_of)}</span></div><div class="scroll">` +
    `<table class="data"><thead><tr><th>モデル</th><th class="n">入力 $/1M</th><th class="n">出力 $/1M</th>` +
    `<th class="n">文脈</th><th>直近</th><th>出典</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}

// --- 出典 ---
const vs = meta.verify_sources || {};
const links = ["anthropic", "openai", "google"]
  .filter((k) => vs[k])
  .map((k) => `<a href="${esc(vs[k])}" rel="noopener" target="_blank">${esc(k)}</a>`)
  .join(" ・ ");
const sources = rows.length
  ? `一次情報（公式価格ページ）: ${links}。掲載値は ${esc(meta.last_full_check || meta.as_of || "")} に照合。`
  : "";

// --- 差し込み(冪等: 中身だけ置換) ---
let html = readFileSync(PAGE, "utf8");
const before = html;
// 置換文字列に価格の "$5" 等が入ると String.replace が後方参照と誤解するので、必ず関数で差し込む。
html = html.replace(/(<div id="sobaMount"[^>]*>)[\s\S]*?(<\/div>\s*<p class="mono" id="sources")/,
                    (_, g1, g2) => g1 + table + g2);
html = html.replace(/(<p class="mono" id="sources"[^>]*>)[\s\S]*?(<\/p>)/, (_, g1, g2) => g1 + sources + g2);
html = html.replace(/(<span class="mono" id="today">)[^<]*(<\/span>)/, `$1${fmtDate(meta.as_of)}$2`);
html = html.replace(/(<span class="mono" id="freshness">)[^<]*(<\/span>)/,
                    `$1更新: ${esc(meta.as_of || "")}$2`);
// JSON-LD(Dataset)の dateModified も as_of に同期（構造化データだけ古い日付を名乗るのを防ぐ）
html = html.replace(/("dateModified":\s*")[^"]*(")/, `$1${esc(meta.as_of || "")}$2`);
// フェッチJSを撤去(静的化済み。失敗時に静的表を消す catch もろとも除く)。既に無ければ無変化。
html = html.replace(/<script>\s*\(function \(\) \{[\s\S]*?fetch\("\.\.\/data\/soba\.json"[\s\S]*?\}\)\(\);\s*<\/script>/,
                    "<!-- AI相場は tools/gen_soba.mjs で静的生成（soba.json が正本） -->");

if (CHECK) {
  if (html !== before) { console.error("✗ soba/index.html が soba.json と不一致。node tools/gen_soba.mjs を実行してコミット"); process.exit(1); }
  console.log("✓ soba 静的HTMLは最新"); process.exit(0);
}
if (html !== before) { writeFileSync(PAGE, html); console.log(`✓ soba/index.html 静的化: ${rows.length}件 (as of ${meta.as_of})`); }
else console.log("変更なし（既に最新）");

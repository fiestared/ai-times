/**
 * トップ(index.html)の各セクションを data/*.json から**静的HTMLとして焼き込む**。
 * 目的は gen_soba.mjs と同じ: 生HTMLに中身を持たせ、Googlebot以外のクローラにも見えるようにする。
 * JSONが正本・HTMLは生成物。ワーカーは data/*.json を更新したら本スクリプトも走らせる。
 *
 *   node tools/gen_home.mjs          生成(冪等・マーカーで囲って再生成)
 *   node tools/gen_home.mjs --check  差分があれば失敗(CI用)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const CHECK = process.argv.includes("--check");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const readJson = (p) => { try { return JSON.parse(readFileSync(join(DOCS, "data", p), "utf8")); } catch { return {}; } };
const ph = (msg) => `<p class="loading">${esc(msg)}</p>`;

const WD = ["日", "月", "火", "水", "木", "金", "土"];
function fmtDate(iso) {
  if (!iso) return "—";
  const p = String(iso).split("-"); if (p.length < 3) return iso;
  const dt = new Date(+p[0], +p[1] - 1, +p[2]);
  return `${p[0]}年${+p[1]}月${+p[2]}日（${WD[dt.getDay()]}）`;
}

const news = readJson("news.json"), soba = readJson("soba.json");
const tools = readJson("tools.json"), kasegu = readJson("kasegu.json");

// --- 速報ティッカー + 一面 + トピック ---
const wire = news.wire || [];
let lead = news.lead;
if (!lead) {
  const all = [];
  (news.topics || []).forEach((t) => (t.items || []).forEach((i) => all.push(i)));
  all.sort((a, b) => String(b.time || "").localeCompare(String(a.time || "")));
  if (all.length) { const t = all[0]; lead = { title: t.title, dek: t.summary, time: t.time, source_name: t.source_name }; }
}
const tickerHtml = wire.slice(0, 6).map((w) =>
  `<span><span class="t">${esc(w.time)}</span> <b>${esc(w.title)}</b></span>`).join("");

const leadHtml = lead
  ? `<article class="lead"><div class="kicker"><span class="sq"></span> 本日の一面 ・ TOP STORY</div>` +
    `<h2>${esc(lead.title)}</h2><p class="dek">${esc(lead.dek)}</p>` +
    `<div class="meta"><span>公開 <b>${esc(lead.time)}</b></span><span>出典 <b>${esc(lead.source_name)}</b></span></div></article>`
  : `<article class="lead">${ph("一面は準備中です。")}</article>`;
const wireHtml = `<aside class="wire"><div class="wh"><span>速報ワイヤー</span><span class="mono">最新順</span></div>` +
  (wire.length ? wire.slice(0, 7).map((w) =>
    `<div class="wi"><div class="tm">${esc(w.time)}</div><div class="hl">${esc(w.title)}` +
    (w.flag ? ` <span class="fl">${esc(w.flag)}</span>` : "") + `</div></div>`).join("") : ph("準備中")) + `</aside>`;
const frontHtml = (!lead && !wire.length) ? ph("一面は準備中です。まもなく最新の発表を要約してお届けします。")
  : `<div class="front">${leadHtml}${wireHtml}</div>`;

const topics = (news.topics || []).filter((t) => (t.items || []).length && t.id !== "kasegu");
const topicsHtml = topics.map((t) => {
  const items = t.items.slice().sort((a, b) => String(b.time || "").localeCompare(String(a.time || "")));
  const stories = items.slice(0, 6).map((a) =>
    `<div class="story"><div class="sk">${esc(a.source_name || "")}${a.time ? " ・ " + esc(a.time) : ""}</div>` +
    `<h3>${esc(a.title)}</h3><p>${esc(a.summary || "")}</p>` +
    (a.source_url ? `<div class="src"><a href="${esc(a.source_url)}" rel="noopener" target="_blank">出典 ↗</a></div>` : "") +
    `</div>`).join("");
  return `<section id="${esc(t.id)}"><div class="sec-title">${esc(t.name)} <span class="jp">— ${esc(t.jp || "")}</span></div><div class="grid2">${stories}</div></section>`;
}).join("");

// --- AI相場(トップ版: 出典列なし) ---
const sRows = (soba.models || []).filter((m) => m.verified && m.input != null);
const sobaHtml = sRows.length ? `<div class="market"><div class="mh"><b>Model &amp; Price Index</b>` +
  `<span class="as mono">as of ${esc(soba._meta?.as_of)}</span></div><div class="scroll">` +
  `<table class="data"><thead><tr><th>モデル</th><th class="n">入力</th><th class="n">出力</th><th class="n">文脈</th><th>直近</th></tr></thead><tbody>` +
  sRows.map((m) => {
    const d2 = m.delta ? `<span class="chg"><span class="ar">${esc(m.delta.mark || "")}</span> ${esc(m.delta.text)}</span>`
      : (m.tag ? `<span class="tagx">${esc(m.tag)}</span>` : `<span class="chg" style="color:var(--ink-3)">— 据置</span>`);
    return `<tr><td><span class="m">${esc(m.name)}</span> <span class="pv">${esc(m.provider)}</span></td>` +
      `<td class="n">${esc(m.input)}</td><td class="n">${esc(m.output)}</td><td class="n">${esc(m.context_k)}K</td><td>${d2}</td></tr>`;
  }).join("") + `</tbody></table></div></div>`
  : ph("AI相場は公開前の最終照合中です。各社の公式価格を裏取りしてから掲載します（推測値は載せません）。");

// --- AIツール ---
const tl = tools.tools || [];
const toolsHtml = tl.length ? `<div class="tools">` + tl.slice(0, 8).map((x) => {
  const href = x.affiliate || x.url || "#";
  return `<a class="tool" href="${esc(href)}" rel="noopener"><span class="ic">${esc((x.name || "?").slice(0, 1))}</span>` +
    `<div><div class="nm">${esc(x.name)}</div><div class="ds">${esc(x.desc)}</div></div><span class="pr">${esc(x.price)}</span></a>`;
}).join("") + `</div>` : ph("AIツールの一覧は準備中です。世界中のツールを分類して掲載します。");

// --- AIで稼ぐ ---
const ex = kasegu.examples || [];
const yen = (usd) => usd ? "≈ ¥" + Math.round(usd * 155 / 10000) + "万" : "";
const amt = (e) => e.monthly_usd ? { big: "$" + e.monthly_usd.toLocaleString() + "/月", sub: yen(e.monthly_usd) + "/月" }
  : e.cumulative_usd ? { big: "$" + e.cumulative_usd.toLocaleString(), sub: yen(e.cumulative_usd) + "・累計" } : { big: "—", sub: "" };
const kaseguHtml = ex.length
  ? `<div class="kasegu-note">世の中で公開されている「AIで稼いだ」実例を集めています。金額はすべて本人の公開値で、各行から出典に飛べます。宣伝ではありません。</div><div class="klist">` +
    ex.slice().sort((a, b) => (b.monthly_usd || b.cumulative_usd / 12 || 0) - (a.monthly_usd || a.cumulative_usd / 12 || 0)).map((e) => {
      const a = amt(e);
      return `<a class="krow2" href="${esc(e.source_url)}" rel="noopener" target="_blank"><div class="kx-main">` +
        `<div class="kx-nm">${esc(e.name)}${e.flag ? ` <span class="fl">${esc(e.flag)}</span>` : ""}</div>` +
        `<div class="kx-ds">${esc(e.what)}${e.note ? " — " + esc(e.note) : ""}</div>` +
        `<div class="kx-src">出典: ${esc(e.source_name)} ↗</div></div>` +
        `<div class="kx-amt"><b>${esc(a.big)}</b><span>${esc(a.sub)}</span></div></a>`;
    }).join("") + `</div>`
  : ph("事例を収集中です。世界と日本の『AIで稼いだ』実例を、出典つきで集めています。");

// --- 差し込み(マーカーで冪等) ---
function inject(html, id, content) {
  const s = `<!--${id}:S-->`, e = `<!--${id}:E-->`;
  const esc2 = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (html.includes(s)) return html.replace(new RegExp(esc2(s) + "[\\s\\S]*?" + esc2(e)), () => s + content + e);
  return html.replace(new RegExp(`(<div id="${id}"[^>]*>)</div>`), (_, g1) => g1 + s + content + e + "</div>");
}
let html = readFileSync(join(DOCS, "index.html"), "utf8");
const before = html;
html = inject(html, "frontMount", frontHtml);
html = inject(html, "topicsMount", topicsHtml);
html = inject(html, "sobaMount", sobaHtml);
html = inject(html, "toolsMount", toolsHtml);
html = inject(html, "kaseguMount", kaseguHtml);
html = inject(html, "breakingMove", tickerHtml);
// 速報バーは wire があるとき表示(hidden を外す)。無いときは hidden のまま。
html = wire.length
  ? html.replace(/(<div class="breaking"[^>]*?)\s*hidden(>)/, "$1$2")
  : html.replace(/(<div class="breaking"[^>]*?)(>)(?![^]*?\shidden)/, "$1 hidden$2");
// 日付
html = html.replace(/(<span class="mono" id="today">)[^<]*(<\/span>)/, (_, g1, g2) => g1 + fmtDate(soba._meta?.as_of) + g2);
html = html.replace(/(<span class="mono" id="freshness">)[^<]*(<\/span>)/, (_, g1, g2) => g1 + (soba._meta?.as_of ? "更新: " + soba._meta.as_of : "毎日更新") + g2);
// 描画JS(IIFE)を撤去。全セクション静的化済みで、失敗時に静的内容を消す catch もろとも不要。既に無ければ無変化。
html = html.replace(/<script>\s*\(function \(\) \{[\s\S]*?\}\)\(\);\s*<\/script>/,
                    "<!-- トップは tools/gen_home.mjs で静的生成（data/*.json が正本） -->");

if (CHECK) {
  if (html !== before) { console.error("✗ index.html が data/*.json と不一致。node tools/gen_home.mjs を実行してコミット"); process.exit(1); }
  console.log("✓ トップの静的HTMLは最新"); process.exit(0);
}
if (html !== before) { writeFileSync(join(DOCS, "index.html"), html); console.log(`✓ index.html 静的化: 相場${sRows.length}・ツール${tl.length}・稼ぐ${ex.length}・トピック${topics.length}・ワイヤー${wire.length}`); }
else console.log("変更なし（既に最新）");

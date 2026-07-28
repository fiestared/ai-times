/**
 * AIツール(tools.json) と AIで稼ぐ(kasegu.json) を静的HTMLとして焼き込む。
 *
 * なぜ: gen_news.mjs と同じ理由。この2ページも JS 描画で、生HTMLの本文は
 * それぞれ 439字 / 409字（＝「読み込み中…」だけ）だった。AIクローラは JS を実行しないので、
 * 照合済みのツール一覧・収益事例は検索にもAI回答にも見えていなかった（2026-07-28 実測）。
 *
 *   node tools/gen_lists.mjs          生成(冪等)
 *   node tools/gen_lists.mjs --check  差分があれば失敗(CI用)
 *
 * 表示ロジックは各ページの JS から移植した。**体裁を変えるときは両方直すのではなく、
 * JSを消してこちらだけを正本にする**（既にJSは撤去済み）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const CHECK = process.argv.includes("--check");

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const WD = ["日", "月", "火", "水", "木", "金", "土"];
function fmtDate(iso) {
  if (!iso) return "—";
  const p = String(iso).split("-"); if (p.length < 3) return iso;
  const dt = new Date(+p[0], +p[1] - 1, +p[2]);
  return `${p[0]}年${+p[1]}月${+p[2]}日（${WD[dt.getDay()]}）`;
}
function fill(html, name, inner) {
  const re = new RegExp(`(<!--${name}:S-->)[\\s\\S]*?(<!--${name}:E-->)`);
  if (!re.test(html)) { console.error(`✗ マーカー ${name} が見つからない: 組版が壊れている`); process.exit(1); }
  return html.replace(re, (_, s, e) => s + inner + e);
}
const jsonld = (o) =>
  `<script type="application/ld+json">${JSON.stringify(o, null, 2).replace(/</g, "\\u003c")}</script>`;
const crumb = (name, url) => ({
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "ホーム", item: "https://aitimes.jp/" },
    { "@type": "ListItem", position: 2, name, item: url },
  ],
});

const results = [];

// ============================ AIツール ============================
{
  const PAGE = join(DOCS, "tools/index.html");
  const d = JSON.parse(readFileSync(join(DOCS, "data/tools.json"), "utf8"));
  const meta = d._meta || {};
  const rows = (d.tools || []).filter((t) => t.verified && t.price);

  let list, pending = "";
  if (!rows.length) {
    list = '<p class="loading">AIツールの一覧は公式ページとの照合中です。裏取り済みのものだけを掲載します（推測値は載せません）。</p>';
  } else {
    const body = rows.map((t) => {
      const href = t.affiliate || t.url || "#";
      const src = t.source_url
        ? `<a href="${esc(t.source_url)}" rel="noopener" target="_blank">出典 ↗</a>` : "—";
      const cat = t.category ? `<span class="tagx">${esc(t.category)}</span>` : "";
      const detail = t.price_detail ? `<div class="pv" style="margin-top:3px">${esc(t.price_detail)}</div>` : "";
      return `<tr><td><a class="m" href="${esc(href)}" rel="noopener" target="_blank">${esc(t.name)}</a> ` +
        `<span class="pv">${esc(t.provider)}</span>` +
        `<div class="pv" style="margin-top:3px">${esc(t.desc)}</div></td>` +
        `<td>${cat}</td><td class="n"><b>${esc(t.price)}</b>${detail}</td>` +
        `<td class="mono" style="font-size:11px">${src}</td></tr>`;
    }).join("");
    list = `<div class="market"><div class="mh"><b>AI Tools Index — 全${rows.length}件</b>` +
      `<span class="as mono">as of ${esc(meta.as_of)}</span></div><div class="scroll">` +
      `<table class="data"><thead><tr><th>ツール</th><th>種類</th><th class="n">料金</th><th>出典</th></tr></thead>` +
      `<tbody>${body}</tbody></table></div></div>`;
    // 裏取り待ち（fail closed の明示）
    const pend = meta.pending_verify || [];
    if (pend.length) {
      pending = "裏取り待ち（公式ページがcurl拒否/JS描画のため未掲載）: " +
        pend.map((p) => `${esc(p.name)}（${esc(p.provider)}）`).join(" ・ ") + "。確認でき次第 追加します。";
    }
  }

  const ld = jsonld({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": "https://aitimes.jp/tools/#page",
        name: "AIツール — AI TIMES", url: "https://aitimes.jp/tools/",
        description: "主要AIツールの用途と料金を各社の公式価格ページと照合した検証済み一覧。",
        dateModified: meta.as_of || "", isPartOf: { "@id": "https://aitimes.jp/#website" } },
      { "@type": "ItemList", numberOfItems: rows.length,
        itemListElement: rows.map((t, i) => ({
          "@type": "ListItem", position: i + 1, name: t.name, url: t.url || t.affiliate || "https://aitimes.jp/tools/",
        })) },
      crumb("AIツール", "https://aitimes.jp/tools/"),
    ],
  });

  let html = readFileSync(PAGE, "utf8"); const before = html;
  html = fill(html, "tools:list", list);
  html = fill(html, "tools:jsonld", ld);
  html = html.replace(/(<span class="mono" id="today">)[^<]*(<\/span>)/, (_, a, b) => a + fmtDate(meta.as_of) + b);
  html = html.replace(/(<span class="mono" id="freshness">)[^<]*(<\/span>)/, (_, a, b) => a + "更新: " + esc(meta.as_of || "") + b);
  html = html.replace(/(<p class="mono" id="pending"[^>]*>)[\s\S]*?(<\/p>)/, (_, a, b) => a + pending + b);
  html = html.replace(/<script>\n\(function \(\) \{[\s\S]*?fetch\("\.\.\/data\/tools\.json"[\s\S]*?\}\)\(\);\n<\/script>\n/,
                      "<!-- AIツールは tools/gen_lists.mjs で静的生成（tools.json が正本） -->\n");
  results.push({ PAGE, html, before, label: `tools/index.html (${rows.length}件)` });
}

// ============================ AIで稼ぐ ============================
{
  const PAGE = join(DOCS, "kasegu/index.html");
  const d = JSON.parse(readFileSync(join(DOCS, "data/kasegu.json"), "utf8"));
  const meta = d._meta || {};
  const ex = d.examples || [];

  // 1万円未満は「万」に丸めると ¥0万 になり金額が消える（例: 累計¥55）。実額のまま出す。
  const man = (v) => v < 10000 ? "¥" + Math.round(v).toLocaleString("en-US")
                               : "¥" + Math.round(v / 10000).toLocaleString("en-US") + "万";
  const USDJPY = 155; // 概算換算レート（海外事例のドル→円のめやす）
  const amt = (e) => {
    if (e.monthly_jpy)    return { big: man(e.monthly_jpy) + "/月", sub: "" };
    if (e.cumulative_jpy) return { big: man(e.cumulative_jpy),      sub: "累計" };
    if (e.monthly_usd)    return { big: "$" + e.monthly_usd.toLocaleString("en-US") + "/月", sub: "≈ " + man(e.monthly_usd * USDJPY) + "/月" };
    if (e.cumulative_usd) return { big: "$" + e.cumulative_usd.toLocaleString("en-US"),      sub: "≈ " + man(e.cumulative_usd * USDJPY) + "・累計" };
    return { big: "—", sub: "" };
  };
  const yenRank = (e) => (e.monthly_jpy || 0) + (e.monthly_usd || 0) * USDJPY +
    ((e.cumulative_jpy || 0) + (e.cumulative_usd || 0) * USDJPY) / 12;

  let list;
  if (!ex.length) {
    list = '<p class="loading">事例を収集中です。世界と日本の『AIで稼いだ』実例を、出典つきで集めています。</p>';
  } else {
    const rows = ex.slice().sort((a, b) => yenRank(b) - yenRank(a)).map((e) => {
      const a = amt(e);
      return `<a class="krow2" href="${esc(e.source_url)}" rel="noopener" target="_blank">` +
        `<div class="kx-main"><div class="kx-nm">${esc(e.name)}` +
        (e.flag ? ` <span class="fl">${esc(e.flag)}</span>` : "") + `</div>` +
        `<div class="kx-ds">${esc(e.what)}${e.note ? " — " + esc(e.note) : ""}</div>` +
        `<div class="kx-src">出典: ${esc(e.source_name)} ↗</div></div>` +
        `<div class="kx-amt"><b>${esc(a.big)}</b><span>${esc(a.sub)}</span></div></a>`;
    }).join("");
    list = `<div class="kasegu-note">世の中で公開されている「AIで稼いだ」実例を集めています。金額はすべて本人の公開値で、` +
      `各行から出典に飛べます。宣伝ではありません（as of ${esc(meta.as_of || "")}・全${ex.length}件）。</div>` +
      `<div class="klist">${rows}</div>`;
  }

  const ld = jsonld({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": "https://aitimes.jp/kasegu/#page",
        name: "AIで稼ぐ — AI TIMES", url: "https://aitimes.jp/kasegu/",
        description: "個人・企業が実際にAIで収益を上げた事例を、誰が・何で・月いくら の形で出典つきに集めた一覧。",
        dateModified: meta.as_of || "", isPartOf: { "@id": "https://aitimes.jp/#website" } },
      { "@type": "ItemList", numberOfItems: ex.length,
        itemListElement: ex.map((e, i) => ({
          "@type": "ListItem", position: i + 1, name: e.name, url: e.source_url || "https://aitimes.jp/kasegu/",
        })) },
      crumb("AIで稼ぐ", "https://aitimes.jp/kasegu/"),
    ],
  });

  let html = readFileSync(PAGE, "utf8"); const before = html;
  html = fill(html, "kasegu:list", list);
  html = fill(html, "kasegu:jsonld", ld);
  html = html.replace(/(<span class="mono" id="today">)[^<]*(<\/span>)/, (_, a, b) => a + fmtDate(meta.as_of) + b);
  html = html.replace(/(<span class="mono" id="freshness">)[^<]*(<\/span>)/, (_, a, b) => a + "更新: " + esc(meta.as_of || "") + b);
  html = html.replace(/<script>\n\(function \(\) \{[\s\S]*?fetch\("\.\.\/data\/kasegu\.json"[\s\S]*?\}\)\(\);\n<\/script>\n/,
                      "<!-- AIで稼ぐは tools/gen_lists.mjs で静的生成（kasegu.json が正本） -->\n");
  results.push({ PAGE, html, before, label: `kasegu/index.html (${ex.length}件)` });
}

// ============================ 書き出し ============================
const changed = results.filter((r) => r.html !== r.before);
if (CHECK) {
  if (changed.length) {
    console.error("✗ tools/kasegu の静的HTMLが JSON と不一致。node tools/gen_lists.mjs を実行してコミット");
    process.exit(1);
  }
  console.log("✓ tools/kasegu 静的HTMLは最新"); process.exit(0);
}
for (const r of changed) { writeFileSync(r.PAGE, r.html); console.log(`✓ ${r.label} 静的化`); }
if (!changed.length) console.log("変更なし（既に最新）");

/**
 * 速報(news.json)を news/ に**静的HTMLとして焼き込み**、トピック別ページを生成する。
 *
 * なぜ静的化するか（2026-07-28の実測が根拠）:
 *   /news/ は JS で data/news.json を描画する作りだったため、生HTMLの本文は「読み込み中…」の
 *   425字しか無かった。**GPTBot / ClaudeBot / PerplexityBot / bingbot は JavaScript を実行しない**ので、
 *   一次情報と逐語照合した独自要約158件（207KB）は、検索エンジンにもAI回答エンジンにも
 *   「存在しない」のと同じだった。サイト最大の資産が丸ごと不可視。だから焼き込む。
 *   （実測: 3クローラのUAで /news/ を取得 → 全て 6,725 バイトの空シェル）
 *
 *   node tools/gen_news.mjs          生成(冪等)
 *   node tools/gen_news.mjs --check  差分があれば失敗(CI用)
 *
 * ★個別記事URL(/news/<id>/)を作らない理由:
 *   summary の長さは中央値286字（158件を実測。300字未満が90件）。これを1件1ページにすると
 *   薄いページを157枚量産することになる。**トピック単位（30〜47件・約1万字）に集約**して、
 *   1ページを厚くする方を選んだ。個別URL化は news.json に永続 id と本文(body)を持たせてから。
 *
 * ワーカーは news.json を更新した直後にこれを走らせる（tools/build_site.mjs が面倒を見る）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOPIC_PAGES, newest, liveTopics, withAnchors } from "./newslib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const PAGE = join(DOCS, "news/index.html");
const DATA = join(DOCS, "data/news.json");
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
// 見出しを出典リンクにする(出典クリック不要で元記事へ)。source_url が無ければ素のテキスト。
const A = (url, inner) => url
  ? `<a class="hl-link" href="${esc(url)}" rel="noopener" target="_blank">${inner}</a>` : inner;

// マーカー間だけを差し替える(冪等)。マーカーが無いのは組版が壊れている＝黙って通さない。
function fill(html, name, inner) {
  const re = new RegExp(`(<!--${name}:S-->)[\\s\\S]*?(<!--${name}:E-->)`);
  if (!re.test(html)) { console.error(`✗ マーカー ${name} が見つからない: 組版が壊れている`); process.exit(1); }
  return html.replace(re, (_, s, e) => s + inner + e);
}

const d = JSON.parse(readFileSync(DATA, "utf8"));
const meta = d._meta || {};
const asOf = meta.as_of || "";


// --- 速報ワイヤー ---
const wire = d.wire || [];
const wireHtml = wire.length
  ? `<aside class="wire"><div class="wh"><span>速報ワイヤー</span><span class="mono">最新順</span></div>` +
    wire.map((w) => `<div class="wi"><div class="tm">${esc(w.time)}</div><div class="hl">` +
      A(w.source_url, esc(w.title)) + (w.flag ? ` <span class="fl">${esc(w.flag)}</span>` : "") +
      `</div></div>`).join("") + `</aside>`
  : `<p class="loading">速報は準備中です。裏取りできた発表から順に掲載します。</p>`;

// --- 1件のストーリー ---
const story = (a) =>
  `<div class="story"${a._anchor ? ` id="${esc(a._anchor)}"` : ""}><div class="sk">${esc(a.source_name || "")}` +
  (a.time ? ` ・ ${esc(a.time)}` : "") + `</div><h3>${A(a.source_url, esc(a.title))}</h3>` +
  `<p>${A(a.source_url, esc(a.summary || ""))}</p>` +
  (a.source_url ? `<div class="src"><a href="${esc(a.source_url)}" rel="noopener" target="_blank">出典 ↗</a></div>` : "") +
  `</div>`;

// --- トピック別（items があるものだけ・fail closed）。kasegu は専用ページで扱う ---
const topics = liveTopics(d).map((t) => ({ ...t, items: withAnchors(newest(t.items)) }));

const topicsHtml = topics.map((t) => {
  const items = t.items;
  const page = TOPIC_PAGES[t.id];
  // 一覧では各トピック上位8件だけ出し、続きはトピックページへ送る(内部リンクを作る)。
  const head = items.slice(0, 8).map(story).join("");
  const more = page && items.length > 8
    ? `<p class="more"><a href="./${page.slug}/"><b>${esc(t.name)}</b> の記事をすべて見る（全${items.length}件）→</a></p>`
    : "";
  return `<section id="${esc(t.id)}" style="margin-top:18px"><div class="sec-title">${esc(t.name)}` +
    ` <span class="jp">— ${esc(t.jp || "")}</span></div><div class="grid2">${head}</div>${more}</section>`;
}).join("");

// --- トピックナビ（一覧 → 各トピックページの内部リンク）。体裁は既存の nav.cat-nav を流用 ---
const topicNav = topics.filter((t) => TOPIC_PAGES[t.id]).map((t) =>
  `<a href="./${TOPIC_PAGES[t.id].slug}/">${esc(t.name)}<span>${t.items.length}</span></a>`).join("");

// --- JSON-LD（ItemList + BreadcrumbList）。一覧が何の集合かを機械に伝える ---
function jsonld(obj) {
  // </script> でHTMLを割らないための最小限のエスケープ
  return `<script type="application/ld+json">${JSON.stringify(obj, null, 2).replace(/</g, "\\u003c")}</script>`;
}
const crumb = (extra) => ({
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "ホーム", item: "https://aitimes.jp/" },
    { "@type": "ListItem", position: 2, name: "速報", item: "https://aitimes.jp/news/" },
    ...(extra ? [{ "@type": "ListItem", position: 3, name: extra.name, item: extra.url }] : []),
  ],
});
// url は「この一覧ページ自身」。各項目は自サイト内のアンカーを指す
// （出典URLを指すと、自分の一覧なのに全項目が他所を指す構造データになる）。
const itemList = (items, url) => ({
  "@type": "ItemList",
  numberOfItems: items.length,
  itemListElement: items.slice(0, 50).map((a, i) => ({
    "@type": "ListItem", position: i + 1, name: a.title,
    url: a._anchor ? `${a._at || url}#${a._anchor}` : url,
  })),
});

// 一覧の ItemList は各項目が実際に載っているトピックページのアンカーを指す
// （/news/ 自身には上位8件しか無いので、/news/#anchor では着地しない項目が出る）。
const allItems = newest(topics.flatMap((t) => {
  const slug = TOPIC_PAGES[t.id]?.slug;
  return t.items.map((a) => ({ ...a, _at: slug ? `https://aitimes.jp/news/${slug}/` : null }));
}));
const indexLd = jsonld({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "CollectionPage", "@id": "https://aitimes.jp/news/#page",
      name: "AIニュース速報 — AI TIMES", url: "https://aitimes.jp/news/",
      description: "新モデルとAPI価格、新ツール、AIの規制・制度、企業の生成AI導入事例を一次情報と逐語照合して要約した一覧。",
      dateModified: asOf, isPartOf: { "@id": "https://aitimes.jp/#website" } },
    itemList(allItems, "https://aitimes.jp/news/"),
    crumb(null),
  ],
});

// --- /news/index.html を焼く ---
let html = readFileSync(PAGE, "utf8");
const before = html;
html = fill(html, "news:wire", wireHtml);
html = fill(html, "news:topics", topicsHtml);
html = fill(html, "news:topicnav", topicNav);
html = fill(html, "news:jsonld", indexLd);
html = html.replace(/(<span class="mono" id="today">)[^<]*(<\/span>)/, (_, g1, g2) => g1 + fmtDate(asOf) + g2);
html = html.replace(/(<span class="mono" id="freshness">)[^<]*(<\/span>)/, (_, g1, g2) => g1 + "更新: " + esc(asOf) + g2);
// フェッチJSを撤去(静的化済み)。既に無ければ無変化。
html = html.replace(/<script>\n\(function \(\) \{[\s\S]*?fetch\("\.\.\/data\/news\.json"[\s\S]*?\}\)\(\);\n<\/script>\n/,
                    "<!-- 速報は tools/gen_news.mjs で静的生成（news.json が正本） -->\n");

// --- トピックページを組む（/news/<slug>/index.html） ---
// 共通の外枠は /news/index.html から切り出して使い回す（style.css・GA4・AdSenseの二重管理を避ける）。
const headBlock = html.match(/<!-- Google Analytics[\s\S]*?crossorigin="anonymous">\s*<\/script>/);
if (!headBlock) { console.error("✗ news/index.html から GA4/AdSense ブロックを切り出せない"); process.exit(1); }

function topicPage(t) {
  const p = TOPIC_PAGES[t.id];
  const items = t.items;
  const url = `https://aitimes.jp/news/${p.slug}/`;
  const ld = jsonld({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": `${url}#page`, name: `${p.h1} — AI TIMES`, url,
        description: p.desc, dateModified: asOf, isPartOf: { "@id": "https://aitimes.jp/#website" } },
      itemList(items, url),
      crumb({ name: t.name, url }),
    ],
  });
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}【${asOf.slice(0, 4)}年${+asOf.slice(5, 7)}月】 — AI TIMES</title>
<meta name="description" content="${esc(p.desc)}">
<link rel="stylesheet" href="../../assets/style.css">
<link rel="canonical" href="${url}">
<link rel="alternate" type="application/rss+xml" title="AI TIMES 速報" href="https://aitimes.jp/feed.xml">
${ld}
${headBlock[0]}
</head>
<body>
<div class="util">
  <div class="wrap util-row">
    <span class="mono" id="today">${fmtDate(asOf)}</span>
    <span class="sp"></span>
    <span class="mono" id="freshness">更新: ${esc(asOf)}</span>
  </div>
</div>

<header class="wrap mast">
  <hr class="rule-heavy">
  <div style="padding:14px 0 12px">
    <a class="h1" href="../../"><h1>AI&#8202;TIMES</h1></a>
    <div class="en">エーアイ・タイムズ ・ JAPAN &amp; WORLD</div>
    <div class="tag">日本と世界のAIを、最速で。</div>
  </div>
  <hr class="rule-heavy">
  <hr class="rule-thin">
</header>

<nav class="sections" aria-label="セクション">
  <a href="../../">一面</a>
  <a href="../../kiji/">記事</a>
  <a href="../">速報</a>
  <a href="../../soba/">AI相場</a>
  <a href="../../tools/">AIツール</a>
  <a href="../../kasegu/">AIで稼ぐ</a>
</nav>

<main class="wrap">
  <nav class="breadcrumb" aria-label="パンくず"><a href="../../">ホーム</a><span class="sep">›</span><a href="../">速報</a><span class="sep">›</span>${esc(t.name)}</nav>
  <section>
    <div class="sec-title">${esc(p.h1)} <span class="jp">— ${esc(t.jp || "")}（全${items.length}件）</span></div>
    <p class="dek">${esc(p.desc)}</p>
    <nav class="cat-nav" aria-label="トピック">${topicNav.replace(/href="\.\//g, 'href="../')}</nav>
    <div class="grid2" style="margin-top:14px">${items.map(story).join("")}</div>
    <p class="more"><a href="../">← 速報の一覧へ戻る</a> ・ <a href="../../soba/">AI相場（API料金の全一覧）へ</a></p>
  </section>
</main>

<footer>
  <div class="wrap frow">
    <span class="brand">AI TIMES</span>
    <span class="sp"></span>
    <a href="../../kiji/">記事</a><a href="../">速報</a><a href="../../soba/">AI相場</a><a href="../../tools/">AIツール</a><a href="../../kasegu/">AIで稼ぐ</a><a href="../../about/">運営者</a><a href="../../privacy/">プライバシー</a><a href="../../contact/">お問い合わせ</a>
  </div>
</footer>
</body>
</html>
`;
}

// --- 書き出し ---
const writes = [];
for (const t of topics) {
  const p = TOPIC_PAGES[t.id];
  if (!p) continue;
  const dir = join(DOCS, "news", p.slug);
  const file = join(dir, "index.html");
  const next = topicPage(t);
  const cur = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (cur !== next) writes.push({ dir, file, next, slug: p.slug, n: t.items.length });
}

if (CHECK) {
  if (html !== before || writes.length) {
    console.error("✗ news の静的HTMLが news.json と不一致。node tools/gen_news.mjs を実行してコミット");
    process.exit(1);
  }
  console.log("✓ news 静的HTMLは最新"); process.exit(0);
}

if (html !== before) {
  writeFileSync(PAGE, html);
  console.log(`✓ news/index.html 静的化: 速報${wire.length}件 / トピック${topics.length}区分 (as of ${asOf})`);
} else console.log("news/index.html: 変更なし");

for (const w of writes) {
  mkdirSync(w.dir, { recursive: true });
  writeFileSync(w.file, w.next);
  console.log(`✓ news/${w.slug}/index.html 生成: ${w.n}件`);
}
if (!writes.length) console.log("トピックページ: 変更なし");

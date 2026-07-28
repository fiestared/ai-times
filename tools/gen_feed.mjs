/**
 * RSS 2.0 フィード(docs/feed.xml)を news.json から生成する。
 *
 * なぜ必要か（2026-07-28の調査が根拠）:
 *   ニュースサイトなのに feed.xml / rss.xml が存在せず（実測: 本番で両方 404）、
 *   Feedly・はてなアンテナ等の購読経路が物理的に無かった。さらに Google ニュースは
 *   2024-04-25 に Publisher Center への新規登録が廃止され、掲載は完全にクロール任せになった
 *   ＝「申請して載せてもらう」経路はもう無く、**機械可読な形（RSS・記事URL・構造化データ）を
 *   満たして自動検出の土俵に立つこと自体が施策**になった。
 *
 *   node tools/gen_feed.mjs          生成(冪等)
 *   node tools/gen_feed.mjs --check  差分があれば失敗(CI用)
 *
 * ★リンク先は自サイトのアンカー(/news/<topic>/#s-xxxx)にする。出典URLを link にすると
 *   「他所の記事を配信するフィード」になり、転載しない規律にも読者の期待にも反する。
 *   出典は本文末尾に明示リンクで置く。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOPIC_PAGES, newest, liveTopics, withAnchors } from "./newslib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const OUT = join(DOCS, "feed.xml");
const CHECK = process.argv.includes("--check");
const SITE = "https://aitimes.jp";
const MAX = 60; // 購読者が追える量。多すぎるとフィードが重くなるだけ

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// RFC 822（RSSの日付形式）。news.json の time は日付のみ(JST)なので 09:00 JST 固定で表す。
// ★UTCで書かない（時刻表記はJSTのみ、が全プロジェクト共通の規律）。
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function rfc822(iso) {
  const p = String(iso || "").split("-");
  if (p.length < 3) return null;
  const dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 0, 0, 0)); // 曜日算出用
  return `${WD[dt.getUTCDay()]}, ${String(+p[2]).padStart(2, "0")} ${MON[+p[1] - 1]} ${p[0]} 09:00:00 +0900`;
}

const d = JSON.parse(readFileSync(join(DOCS, "data/news.json"), "utf8"));
const meta = d._meta || {};

// 各トピックの記事にアンカーと掲載ページURLを付けて1本に束ねる
const items = newest(liveTopics(d).flatMap((t) => {
  const page = TOPIC_PAGES[t.id];
  if (!page) return [];
  return withAnchors(newest(t.items)).map((a) => ({
    ...a, _topic: t.name, _url: `${SITE}/news/${page.slug}/#${a._anchor}`,
  }));
})).slice(0, MAX);

const entries = items.map((a) => {
  const pub = rfc822(a.time);
  const src = a.source_url
    ? `<p>出典: <a href="${esc(a.source_url)}">${esc(a.source_name || a.source_url)}</a></p>` : "";
  const body = `<p>${esc(a.summary || "")}</p>${src}`;
  return `    <item>
      <title>${esc(a.title)}</title>
      <link>${esc(a._url)}</link>
      <guid isPermaLink="true">${esc(a._url)}</guid>
      <category>${esc(a._topic)}</category>${pub ? `\n      <pubDate>${pub}</pubDate>` : ""}
      <description>${esc(body)}</description>
    </item>`;
}).join("\n");

const lastBuild = rfc822(meta.as_of);
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AI TIMES — 日本と世界のAIを、最速で。</title>
    <link>${SITE}/news/</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>新モデルとAPI価格、新ツール、AIの規制・制度、企業の生成AI導入事例を、各社と官公庁の一次情報と逐語照合して要約。記事の転載はせず、必ず出典リンクを付けます。</description>
    <language>ja</language>
    <docs>https://www.rssboard.org/rss-specification</docs>${lastBuild ? `\n    <lastBuildDate>${lastBuild}</lastBuildDate>` : ""}
    <ttl>360</ttl>
${entries}
  </channel>
</rss>
`;

const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
if (CHECK) {
  if (cur !== xml) { console.error("✗ feed.xml が news.json と不一致。node tools/gen_feed.mjs を実行してコミット"); process.exit(1); }
  console.log("✓ feed.xml は最新"); process.exit(0);
}
if (cur !== xml) { writeFileSync(OUT, xml); console.log(`✓ feed.xml 生成: ${items.length}件 (as of ${meta.as_of})`); }
else console.log("feed.xml: 変更なし");

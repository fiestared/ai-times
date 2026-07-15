/**
 * 記事の「型」を機械で強制する（AI TIMES）。
 *
 * なぜ必要か: 「記事の必須要素」を散文で決めても、量産すれば必ず崩れる。
 * 検索で拾われて収益になる記事は、GA4/AdSense/canonical/構造化データ/導線が
 * 1つでも欠けると、そのページだけ計測不能・収益ゼロ・誰にも届かない、になる。
 * だから型の逸脱は人ではなく機械が落とす（keiri-tools と同じ規律を移植）。
 *
 * 検査対象: docs/kiji/<slug>/index.html すべて（kiji/index.html 自体は除く）
 *   node tests/test_article_structure.mjs
 *
 * 「置いただけで誰にも届かない記事」を作らないため、
 * sitemap.xml と 記事一覧(kiji/index.html) への掲載も型の一部として検査する。
 * さらに AI TIMES は「相場・料金 / 企業のAI活用 事例 / AIで稼ぐ 事例」の
 * 3カテゴリに限定する戦略なので、どのカテゴリにも分類されていない記事は落とす。
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DOCS = new URL("../docs/", import.meta.url).pathname;
const KIJI = join(DOCS, "kiji");

const GA_ID = "G-KZV2EZYGDP";              // aitimes.jp 専用（keiri の ID ではない）
const ADSENSE = "ca-pub-2635067516563578"; // 発行者IDは keiri と同一（1アカウント複数サイト可）

const fails = [];
const fail = (slug, msg) => fails.push(`${slug}: ${msg}`);

const sitemap = readFileSync(join(DOCS, "sitemap.xml"), "utf8");
const kijiIndex = readFileSync(join(KIJI, "index.html"), "utf8");

// .nopublish = 「公開しない記事」の印（gen_kiji_index.mjs と同じ規約）。
// 公開しない以上 sitemap・一覧への掲載は要求できないので検査対象から外すが、
// 黙って外すと「全記事が型を満たしている」と誤読されるため必ず名指しで出す。
const all = readdirSync(KIJI).filter((n) => existsSync(join(KIJI, n, "index.html")));
const drafts = all.filter((n) => existsSync(join(KIJI, n, ".nopublish")));
const slugs = all.filter((n) => !drafts.includes(n));
for (const d of drafts) console.log(`  ⚠️  検査対象外(.nopublish): ${d}`);

if (slugs.length === 0) fails.push("記事が1本も無い(検査対象の取り違え)");

for (const slug of slugs) {
  const html = readFileSync(join(KIJI, slug, "index.html"), "utf8");
  const body = html.slice(html.indexOf("<article"), html.indexOf("</article>"));
  if (body.length < 100) { fail(slug, "<article> が無い"); continue; }

  // --- 計測・収益の土台（1ページでも欠けると、そのページだけ収益ゼロ・計測不能） ---
  if (!html.includes(GA_ID)) fail(slug, `GA4タグ(${GA_ID})が無い`);
  if (!html.includes(ADSENSE)) fail(slug, `AdSenseスニペット(${ADSENSE})が無い`);
  if (!html.includes(`rel="canonical"`)) fail(slug, "canonical が無い");
  const canon = html.match(/rel="canonical"\s+href="([^"]+)"/)?.[1];
  const want = `https://aitimes.jp/kiji/${slug}/`;
  if (canon && canon !== want) fail(slug, `canonical が違う: ${canon} (正: ${want})`);

  // --- 検索エンジンに見つけてもらう土台 ---
  if (!sitemap.includes(want)) fail(slug, "sitemap.xml に載っていない(誰にも届かない)");
  if (!kijiIndex.includes(`href="${slug}/"`)) fail(slug, "記事一覧(kiji/index.html)に載っていない");

  // --- 構造化データ ---
  if (!html.includes(`"@type": "Article"`)) fail(slug, "Article 構造化データが無い");
  if (!html.includes(`"@type": "BreadcrumbList"`)) fail(slug, "BreadcrumbList 構造化データが無い");
  if (!/"datePublished":\s*"\d{4}-\d{2}-\d{2}"/.test(html)) fail(slug, "datePublished が無い");
  if (!/<nav class="breadcrumb">/.test(html)) fail(slug, "パンくずナビが無い");

  // --- 読み物としての型 ---
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  if (!title) fail(slug, "<title> が空");
  else if (title.length > 60) fail(slug, `<title> が長すぎる(${title.length}字。検索結果で切れる)`);
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
  if (!desc) fail(slug, "meta description が無い");
  else if (desc.length < 60) fail(slug, `meta description が短すぎる(${desc.length}字)`);

  if (!/<h1>/.test(body)) fail(slug, "<h1> が無い");
  if (!/class="article-meta"/.test(body)) fail(slug, "公開日(article-meta)が無い");
  if (!/<nav class="toc">/.test(body)) fail(slug, "目次(nav.toc)が無い");

  // 目次は全 h2 を指していること（見出しを足して目次に入れ忘れる、を落とす）
  const h2s = [...body.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
  const tocStart = body.indexOf(`<nav class="toc">`);
  const toc = body.slice(tocStart, body.indexOf("</nav>", tocStart));
  for (const id of h2s) {
    if (!toc.includes(`#${id}`)) fail(slug, `目次に #${id} が無い`);
  }
  // id の無い h2 は「出典」「関連記事・ツール」だけ許す（目次に載せない見出し）
  const bareH2 = [...body.matchAll(/<h2(?![^>]*\bid=)[^>]*>([\s\S]*?)<\/h2>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, "").trim());
  for (const t of bareH2) {
    if (!["出典", "関連記事・ツール", "関連"].includes(t)) fail(slug, `h2「${t}」に id が無い(目次に載らない)`);
  }
  if (h2s.length < 3) fail(slug, `h2 が ${h2s.length} 個しかない(内容が薄い)`);

  // --- 図解（figure内のインラインSVG）。外部画像は使わない ---
  if (!/<figure[\s>]/.test(body)) fail(slug, "図解(<figure>内のインラインSVG)が無い");
  else {
    const figs = [...body.matchAll(/<figure[\s\S]*?<\/figure>/g)];
    if (!figs.some((f) => f[0].includes("<svg"))) fail(slug, "<figure> はあるが中にインラインSVGが無い");
    if (!figs.some((f) => /<figcaption/.test(f[0]))) fail(slug, "<figure> に figcaption が無い");
  }
  if (/<img\s[^>]*src="https?:/.test(body)) fail(slug, "外部画像を使っている(インラインSVGにする)");

  // --- FAQ（構造化データは本文から生成される。本文側の型を守らせる） ---
  if (!/<h2[^>]*\bid="faq"|<h2[^>]*data-faq/.test(body)) fail(slug, "FAQブロック(h2#faq)が無い");
  if (!/<section class="related">/.test(body)) fail(slug, "関連(記事一覧やsoba/kaseguへの導線)が無い");
  if (!body.includes("出典")) fail(slug, "出典が無い");

  // --- 導線: 記事から必ずデータページ(soba/ tools/ kasegu/ 等)へ送る（記事は入口） ---
  if (!/class="tool-cta"|class="tool-card"/.test(body)) fail(slug, "データページへの導線(tool-cta/tool-card)が無い");

  // --- CSSは style.css に集約（記事内 <style> は書かない） ---
  if (/<style[\s>]/.test(html)) fail(slug, "記事内に <style> がある(assets/style.css に集約する)");
}

// --- カテゴリ: 一覧はカテゴリ別セクションで出す。未分類は「その他」に埋もれる ---
// AI TIMES は3カテゴリに限定する戦略なので、CATEGORIES は「相場・料金 / 企業のAI活用 事例 /
// AIで稼ぐ 事例」の3つで固定。未分類の記事はこの箱に入れられず埋もれるので機械が落とす。
{
  const genSrc = readFileSync(new URL("../tools/gen_kiji_index.mjs", import.meta.url).pathname, "utf8");
  const catBlock = genSrc.match(/const CATEGORIES = \[([\s\S]*?)\n\];/);
  if (!catBlock) {
    console.error("✗ gen_kiji_index.mjs の CATEGORIES を読めなかった(検査が機能していない)");
    process.exit(1);
  }
  // カテゴリ定義数の assert: 正規表現がずれて壊れた検査が黙って通るのを防ぐ。
  // AI TIMES は3カテゴリ固定。ここが3でなければ検査か戦略のどちらかが崩れている。
  const catIds = [...catBlock[1].matchAll(/\bid:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
  if (catIds.length !== 3) {
    console.error(`✗ CATEGORIES の読み取りが ${catIds.length}件(AI TIMESは3カテゴリ固定。検査が壊れている)`);
    process.exit(1);
  }
  // slugs: [...] の中だけからカテゴリ登録済みの記事を拾う（id/name/desc を拾わない）
  const cats = [...catBlock[1].matchAll(/slugs:\s*\[([\s\S]*?)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1]));
  const uncat = slugs.filter((s) => !cats.includes(s));
  for (const s of uncat) fail(s, "gen_kiji_index.mjs の CATEGORIES に未分類(3カテゴリのどれにも入っていない)");
  const catGhosts = cats.filter((s) => !slugs.includes(s) && !drafts.includes(s));
  for (const s of catGhosts) fail(s, "CATEGORIES に載っているが記事が存在しない");
  // 設定だけでなく生成された一覧も見る（設定は正しいのに生成器が壊れている、を落とす）
  if (/id="cat-sonota"/.test(kijiIndex)) {
    fails.push("kiji/index.html に「その他」セクションが出ている(未分類の記事がある)");
  }
  console.log(`  CATEGORIES 分類 ${cats.length}件 / 公開記事 ${slugs.length}本を照合 (${catIds.join("/")})`);
}

if (fails.length) {
  console.error(`✗ 記事の型 違反 ${fails.length}件 (対象 ${slugs.length}記事)`);
  for (const f of fails) console.error("  - " + f);
  process.exit(1);
}
console.log(`✓ 記事の型 OK (${slugs.length}記事)`);

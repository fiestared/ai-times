/**
 * sitemap.xml と 記事一覧(kiji/index.html) を、記事ファイルから生成する（AI TIMES）。
 *
 * なぜ生成にするか:
 * 記事を書くたびに「sitemap に足す」「一覧に足す」を手でやると、必ずいつか忘れる。
 * 忘れた記事は誰にも届かない（検索にも載らず、サイト内からも辿れない）。
 * FAQのJSON-LD（gen_faq_jsonld.mjs）と同じ規律を、一覧と sitemap にも適用する。
 *
 *   node tools/gen_kiji_index.mjs           生成
 *   node tools/gen_kiji_index.mjs --check   差分があれば失敗(CI/テスト用)
 *
 * 記事側の正本:
 *   タイトル … <h1>
 *   日付     … JSON-LD の datePublished
 *   説明文   … <meta name="card-desc">（一覧カード用の短い惹句）。無ければ meta description
 *
 * 一覧は AI TIMES の3カテゴリ（相場・料金 / 企業のAI活用 事例 / AIで稼ぐ 事例）の
 * セクションに分けて出す。カテゴリ内は日付降順（ニュース性を優先）。
 * CATEGORIES に無い記事は「その他」に入れたうえで名指しで警告する。
 * 黙って埋もれさせないため、未分類は tests/test_article_structure.mjs が落とす。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const DOCS = new URL("../docs/", import.meta.url).pathname;
const KIJI = join(DOCS, "kiji");
const CHECK = process.argv.includes("--check");

/**
 * 一覧のカテゴリ。AI TIMES は「長尾×鮮度×構造化データ」で勝つ戦略なので、
 * カテゴリは頭ワードを狙う3本に限定する（増やさない）。
 * 記事を書いたら slugs に登録する。未登録は「その他」送り＋警告＋テスト失敗。
 */
const CATEGORIES = [
  {
    id: "soba",
    name: "AI相場・料金",
    desc: "主要AIモデルのAPI料金の見方・比較、各社の値付けと使い分け。毎日照合する「AI相場」のデータに接続する。",
    slugs: [
      "ai-model-api-ryokin-no-mikata",
      "claude-ryokin",
    ],
  },
  {
    id: "katsuyo",
    name: "企業のAI活用 事例",
    desc: "国内企業が生成AIを実際の業務にどう入れたか。導入の狙い・使ったツール・効果を、公表事例と出典つきでまとめる。",
    slugs: [],
  },
  {
    id: "kasegu",
    name: "AIで稼ぐ 事例・方法",
    desc: "個人・企業がAIで収益を上げた実例と、その手法。金額は本人の公開値、各事例に出典。稼ぎ方の「型」を集める。",
    slugs: [],
  },
];

/** sitemap に載せる固定ページ（記事は自動で追加される） */
const STATIC_PAGES = ["", "news/", "soba/", "tools/", "kasegu/", "kiji/", "about/", "privacy/", "contact/"];

const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;");

const articles = [];
const skipped = [];
for (const slug of readdirSync(KIJI)) {
  const f = join(KIJI, slug, "index.html");
  if (!existsSync(f) || !statSync(join(KIJI, slug)).isDirectory()) continue;
  // 書きかけ・公開してはいけない記事は .nopublish を置いて外す
  // （未コミットの作業中記事が sitemap・一覧に載って 404 リンクを公開する事故を防ぐ）
  if (existsSync(join(KIJI, slug, ".nopublish"))) { skipped.push(slug); continue; }
  const html = readFileSync(f, "utf8");
  // ★ タイトルは記事の <h1> から採る。マストヘッドの <h1>AI TIMES</h1> が本文より前に
  //   あるので、ファイル頭からの最初の <h1> を採ると一覧のタイトルが全部「AI TIMES」になる
  //   （テストは掲載URLしか見ないので黙って通る）。必ず <article 以降から拾う。
  const artStart = html.indexOf("<article");
  const scope = artStart === -1 ? html : html.slice(artStart);
  const title = strip(scope.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "");
  const date = html.match(/"datePublished":\s*"(\d{4})-(\d{2})-(\d{2})"/);
  const cardDesc = html.match(/<meta name="card-desc" content="([^"]*)"/)?.[1]
                ?? html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
  if (!title || !date) {
    console.error(`✗ ${slug}: h1 か datePublished が読めない`);
    process.exit(1);
  }
  articles.push({ slug, title, desc: cardDesc, ymd: `${date[1]}.${date[2]}.${date[3]}`,
                  iso: `${date[1]}-${date[2]}-${date[3]}` });
}

// 全体の既定並びは日付降順（ニュース性を優先）
articles.sort((a, b) => b.iso.localeCompare(a.iso));

// ---- CATEGORIES の記述ミス（存在しない記事・二重登録）を落とす ----
{
  const seen = new Map();
  for (const c of CATEGORIES) {
    for (const s of c.slugs) {
      if (seen.has(s)) {
        console.error(`✗ CATEGORIES: ${s} が「${seen.get(s)}」と「${c.name}」に重複登録`);
        process.exit(1);
      }
      seen.set(s, c.name);
    }
  }
}

const catOf = new Map();
for (const c of CATEGORIES) for (const s of c.slugs) catOf.set(s, c.id);
const uncategorized = articles.filter((a) => !catOf.has(a.slug));

// ---- sitemap.xml ----
// lastmod は git のコミット日から採る（中身が変わっていないのに「今日更新」と嘘をつくと、
// Google が lastmod を信用しなくなる）。未追跡/変更中のファイルだけ今日（本当に今変わっている）。
const git = (...a) => {
  try { return execFileSync("git", a, { cwd: DOCS, encoding: "utf8" }).trim(); }
  catch { return ""; }
};
const TODAY = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // YYYY-MM-DD
const root = git("rev-parse", "--show-toplevel");
// -uall が要る: 既定の git status は未追跡ディレクトリを1行に畳むので、
// 新しく作ったページ（lastmod がいちばん要る）だけ照合が外れて lastmod が落ちる。
const dirty = new Set(
  git("status", "--porcelain", "-uall", "--", DOCS).split("\n").filter(Boolean)
    .map((l) => l.slice(3).split(" -> ").pop().replace(/^"|"$/g, ""))
    .map((p) => (root ? join(root, p) : p)),
);
const lastmodOf = (file) => {
  if (dirty.has(file)) return TODAY;
  return git("log", "-1", "--format=%cs", "--", file); // 履歴が無ければ "" → lastmod を出さない
};

const urls = [
  ...STATIC_PAGES.map((p) => ({ loc: `https://aitimes.jp/${p}`, file: join(DOCS, p, "index.html") })),
  ...articles.map((a) => ({ loc: `https://aitimes.jp/kiji/${a.slug}/`,
                            file: join(KIJI, a.slug, "index.html") })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(({ loc, file }) => {
  const d = lastmodOf(file);
  return `  <url><loc>${loc}</loc>${d ? `<lastmod>${d}</lastmod>` : ""}</url>`;
}).join("\n")}
</urlset>
`;

// ---- kiji/index.html の記事リスト（カテゴリ別セクション） ----
const card = (a, indent) => `${indent}<a href="${a.slug}/" data-s="${esc((a.title + " " + a.desc).toLowerCase())}">
${indent}  <div class="p-date">${a.ymd}</div>
${indent}  <div>
${indent}    <div class="p-title">${esc(a.title)}</div>
${indent}    <div class="p-desc">${esc(a.desc)}</div>
${indent}  </div>
${indent}</a>`;

const groups = CATEGORIES.map((c) => ({
  id: c.id, name: c.name, desc: c.desc,
  items: articles.filter((a) => catOf.get(a.slug) === c.id),
})).filter((g) => g.items.length > 0);
if (uncategorized.length) {
  groups.push({
    id: "sonota", name: "その他",
    desc: "カテゴリ未設定の記事（gen_kiji_index.mjs の CATEGORIES に登録してください）。",
    items: uncategorized,
  });
}

const catNav = groups.map((g) =>
  `    <a href="#cat-${g.id}">${esc(g.name)}<span>(${g.items.length})</span></a>`).join("\n");

const sections = groups.map((g) => `  <section class="cat" id="cat-${g.id}" data-cat>
    <h2>${esc(g.name)}<span class="cat-n">(${g.items.length})</span></h2>
    <p class="cat-desc">${esc(g.desc)}</p>
    <div class="post-list">
${g.items.map((a) => card(a, "      ")).join("\n")}
    </div>
  </section>`).join("\n");

const kijiBlock = `  <nav class="cat-nav" id="cat-nav">
${catNav}
  </nav>

${sections}`;

const kijiPath = join(KIJI, "index.html");
let kiji = readFileSync(kijiPath, "utf8");
const OPEN = "<!-- GEN:KIJI-INDEX -->";
const CLOSE = "<!-- /GEN:KIJI-INDEX -->";
const cOpen = kiji.indexOf(OPEN);
const cClose = kiji.indexOf(CLOSE);
if (cOpen === -1 || cClose === -1) {
  console.error(`✗ kiji/index.html に ${OPEN} … ${CLOSE} が見つからない`);
  process.exit(1);
}
kiji = kiji.slice(0, cOpen + OPEN.length) + "\n" + kijiBlock + "\n  " + kiji.slice(cClose);

const write = (path, next, label) => {
  const prev = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (prev === next) return false;
  if (CHECK) {
    console.error(`✗ ${label} が古い。node tools/gen_kiji_index.mjs を流すこと`);
    process.exit(1);
  }
  writeFileSync(path, next);
  console.log(`  更新: ${label}`);
  return true;
};

const a = write(join(DOCS, "sitemap.xml"), sitemap, "sitemap.xml");
const b = write(kijiPath, kiji, "kiji/index.html");

for (const slug of skipped) console.log(`  ⚠️  除外(.nopublish): ${slug} — sitemap・一覧に載せていない`);
for (const art of uncategorized) {
  console.error(`  ⚠️  未分類: ${art.slug} — CATEGORIES に登録していないので「その他」に入れた`);
}
if (uncategorized.length) {
  console.error(`  → tools/gen_kiji_index.mjs の CATEGORIES に ${uncategorized.length}本を割り当てること`);
}

const counts = groups.map((g) => `${g.name} ${g.items.length}`).join(" / ");
console.log(`✓ 記事 ${articles.length}本${a || b ? "" : "（変更なし）"}  [${counts}]`);

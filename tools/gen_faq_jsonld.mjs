/**
 * FAQ構造化データ(JSON-LD)を、本文の「よくある質問」ブロックから生成する（AI TIMES）。
 *
 * なぜ生成にするか:
 * JSON-LDのFAQ設問を本文と別に手書きすると、必ず食い違う。Googleの要件は
 * 「設問と回答の全文が利用者に見えていること」なので、本文に無い文章を構造化データで
 * 申告するとリッチリザルト対象外・手動対策の対象になりうる。
 * だから本文を正本にして JSON-LD を生成する。人が触るのは本文だけ。
 *   生成: node tools/gen_faq_jsonld.mjs        (--check で差分があれば失敗)
 *
 * 本文側の約束:
 *   FAQブロックの開始 = 見出し文言が「よくある質問」の <h2>、または <h2 data-faq>。
 *   そこに続く <h3>設問</h3><p>答え</p> の並びがFAQ。
 *   次の <h2> / <section> / </section> / </main> までを1ブロックとみなす。
 *   答えは h3 の直後の <p> 1つだけ（表やcalloutはFAQに入れない
 *   — Googleが acceptedAnswer に許可するタグに table は含まれない）。
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DOCS = new URL("../docs/", import.meta.url).pathname;
const CHECK = process.argv.includes("--check");

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...htmlFiles(p));
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

/** タグを剥がして可視テキストにする */
export const visibleText = (s) =>
  s.replace(/<[^>]+>/g, "")
   .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
   .replace(/\s+/g, " ").trim();

/** 本文の「よくある質問」ブロックから Q&A を取り出す（本文が正本） */
export function extractFaq(html) {
  const h2 = html.match(/<h2[^>]*\sdata-faq[^>]*>[\s\S]*?<\/h2>|<h2[^>]*>\s*よくある質問\s*<\/h2>/);
  if (!h2) return null;
  const start = h2.index + h2[0].length;
  const rest = html.slice(start);
  const end = rest.search(/<h2[\s>]|<section[\s>]|<\/section>|<\/main>/);
  const block = end === -1 ? rest : rest.slice(0, end);

  const pairs = [];
  for (const m of block.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/g)) {
    pairs.push({ q: visibleText(m[1]), a: visibleText(m[2]) });
  }
  return pairs;
}

const faqNode = (pairs) => ({
  "@type": "FAQPage",
  mainEntity: pairs.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
});

let changed = 0;
const problems = [];

for (const file of htmlFiles(DOCS)) {
  let html = readFileSync(file, "utf8");
  const rel = file.slice(DOCS.length);
  const pairs = extractFaq(html);

  const blocks = [...html.matchAll(
    /(<script[^>]*type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/g
  )];

  let hasFaqNode = false;

  for (const [whole, open, body, close] of blocks) {
    let data;
    try { data = JSON.parse(body); } catch { continue; }
    const target = (data["@graph"] || [data]).find((n) => n["@type"] === "FAQPage");
    if (!target) continue;
    hasFaqNode = true;

    if (!pairs || pairs.length === 0) {
      problems.push(
        `${rel}: FAQPageのJSON-LDがあるのに、本文に「よくある質問」ブロック(h3+p)がありません。\n` +
        `      → 本文にQ&Aを書くか、FAQPageのJSON-LDを消してください。`
      );
      continue;
    }

    const built = faqNode(pairs).mainEntity;
    if (JSON.stringify(target.mainEntity) === JSON.stringify(built)) continue;
    target.mainEntity = built;

    const json = JSON.stringify(data, null, 2);
    // 置換文字列に "$&" 等が入ると String.replace が特殊パターンと解釈するので必ず関数で差し込む
    html = html.replace(whole, () => `${open}\n${json}\n${close}`);
    writeFileSync(file, html);
    changed++;
    console.log(`  更新: ${rel} (設問${pairs.length}件)`);
  }

  // 挿入: 本文にFAQがあるのに FAQPageノードが無いページ（新しく書いた記事は
  // 黙って構造化データ無しで公開される、を防ぐ）。
  if (!hasFaqNode && pairs && pairs.length > 0) {
    const graphBlock = blocks.find(([, , body]) => {
      try { return Array.isArray(JSON.parse(body)["@graph"]); } catch { return false; }
    });
    if (!graphBlock) {
      problems.push(
        `${rel}: 本文に「よくある質問」があるのに、FAQPageを入れる @graph のJSON-LDがありません。\n` +
        `      → 記事の<head>にArticle/BreadcrumbListの@graphを置いてください(既存記事のコピーで可)。`
      );
      continue;
    }
    const [whole, open, body, close] = graphBlock;
    const data = JSON.parse(body);
    data["@graph"].push(faqNode(pairs));
    const json = JSON.stringify(data, null, 2);
    html = html.replace(whole, () => `${open}\n${json}\n${close}`);
    writeFileSync(file, html);
    changed++;
    console.log(`  追加: ${rel} (設問${pairs.length}件・FAQPageを新規挿入)`);
  }
}

if (problems.length) {
  console.error("\nFAQ構造化データを生成できません:\n\n  " + problems.join("\n\n  ") + "\n");
  process.exit(1);
}

if (CHECK && changed) {
  console.error(
    `\n本文とJSON-LDがズレています(${changed}ページ)。\n` +
    `対処: node tools/gen_faq_jsonld.mjs を実行してコミットしてください。\n`
  );
  process.exit(1);
}

console.log(changed ? `gen_faq_jsonld: ${changed}ページ更新` : "gen_faq_jsonld: 差分なし");

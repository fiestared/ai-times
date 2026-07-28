/**
 * AI相場の派生ページを生成する。
 *   /soba/jpy/ … API料金の円換算表（実レート日次）
 *   /soba/eol/ … モデルの提供終了（リタイア）日・料金改定の予定カレンダー
 *
 * なぜこの2本か（2026-07-28のSERP実地調査が根拠）:
 *   ・円換算: 上位記事は「1USD=155円」等の**固定レートで書き逃げ**していて、書かれた瞬間から
 *     腐る。毎日レートを取り直せるのは毎日動くサイトだけ。「Claude API 料金 日本円」等の
 *     クエリで、上位が構造的に持てない鮮度がこちらにはある。
 *   ・提供終了日: 上位記事どうしで終了日が食い違ったまま放置されている（同じモデルの廃止日が
 *     3/3・4月末・6/1 と3説あるのを実測）。**各社公式を逐語照合した横断カレンダーは存在しない**。
 *     しかも「使っているモデルが止まる日」は締切のある実務情報で、毎日更新の価値が最も高い。
 *
 *   node tools/gen_soba_pages.mjs          生成(冪等)
 *   node tools/gen_soba_pages.mjs --check  差分があれば失敗(CI用)
 *
 * ★fail-closed: soba.json は verified:true のみ、eol.json は公式で確認できた行のみを出す。
 *   Anthropicの Active 行は公式表記が "Not sooner than"（それより前には終了しない＝確定日ではない）
 *   なので、確定日と**同じ見た目で並べない**。混ぜると「確定していない日付」を断言する嘘になる。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
const jp = (iso) => { const p = String(iso || "").split("-"); return p.length < 3 ? esc(iso || "—") : `${p[0]}年${+p[1]}月${+p[2]}日`; };
const readJson = (p) => {
  try { return JSON.parse(readFileSync(join(DOCS, "data", p), "utf8")); }
  catch (e) {
    if (e.code === "ENOENT") return null;
    console.error(`✗ data/${p} が読めない(壊れたJSON?): ${e.message}`); process.exit(1);
  }
};
function jsonld(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj, null, 2).replace(/</g, "\\u003c")}</script>`;
}

const soba = readJson("soba.json") || {};
const fx = readJson("fx.json");
const eol = readJson("eol.json") || {};
const sMeta = soba._meta || {};
const eMeta = eol._meta || {};
const rows = (soba.models || []).filter((m) => m.verified && m.input != null);
const FXR = fx && typeof fx.usd_jpy === "number" ? fx.usd_jpy : null;

// 共通の外枠は /soba/index.html から切り出す（GA4/AdSenseの二重管理を避ける）。
const sobaHtml = readFileSync(join(DOCS, "soba/index.html"), "utf8");
const headBlock = sobaHtml.match(/<!-- Google Analytics[\s\S]*?crossorigin="anonymous">\s*<\/script>/);
if (!headBlock) { console.error("✗ soba/index.html から GA4/AdSense ブロックを切り出せない"); process.exit(1); }

/** ページの外枠（/soba/<slug>/ 用。相対パスは ../../ ） */
function shell({ slug, title, desc, asOf, ld, crumbName, body }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="stylesheet" href="../../assets/style.css">
<link rel="canonical" href="https://aitimes.jp/soba/${slug}/">
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
  <a href="../../news/">速報</a>
  <a href="../">AI相場</a>
  <a href="../../tools/">AIツール</a>
  <a href="../../kasegu/">AIで稼ぐ</a>
</nav>

<main class="wrap">
  <nav class="breadcrumb" aria-label="パンくず"><a href="../../">ホーム</a><span class="sep">›</span><a href="../">AI相場</a><span class="sep">›</span>${esc(crumbName)}</nav>
${body}
</main>

<footer>
  <div class="wrap frow">
    <span class="brand">AI TIMES</span>
    <span class="sp"></span>
    <a href="../../kiji/">記事</a><a href="../../news/">速報</a><a href="../">AI相場</a><a href="../../tools/">AIツール</a><a href="../../kasegu/">AIで稼ぐ</a><a href="../../about/">運営者</a><a href="../../privacy/">プライバシー</a><a href="../../contact/">お問い合わせ</a>
  </div>
</footer>
</body>
</html>
`;
}

const crumbLd = (slug, name) => ({
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "ホーム", item: "https://aitimes.jp/" },
    { "@type": "ListItem", position: 2, name: "AI相場", item: "https://aitimes.jp/soba/" },
    { "@type": "ListItem", position: 3, name, item: `https://aitimes.jp/soba/${slug}/` },
  ],
});

// ───────────────────────── /soba/jpy/ 円換算表 ─────────────────────────
function pageJpy() {
  const asOf = sMeta.as_of || "";
  // 為替が取れていないなら数字を出さない（推測レートで円を書かない）。
  if (!FXR || !rows.length) {
    const body = `  <section>
    <div class="sec-title">AI API料金の円換算 <span class="jp">— 準備中</span></div>
    <p class="loading">為替レートまたは料金データが未取得のため、円換算は表示していません（推測レートでは出しません）。<a href="../">ドル建ての一覧はこちら</a>。</p>
  </section>`;
    return shell({ slug: "jpy", title: "AI API料金の円換算 — AI TIMES", desc: "AI各社のAPI料金の円換算。データ取得中です。",
      asOf, ld: jsonld({ "@context": "https://schema.org", "@graph": [crumbLd("jpy", "円換算")] }), crumbName: "円換算", body });
  }

  const yen = (usd, dp = 0) => "¥" + (usd * FXR).toLocaleString("ja-JP", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const sorted = rows.slice().sort((a, b) => Number(a.input) - Number(b.input));

  const table = `<div class="market"><div class="mh"><b>API料金の円換算 — 全${sorted.length}件（入力の安い順）</b>` +
    `<span class="as mono">as of ${esc(asOf)}</span></div><div class="scroll">` +
    `<table class="data"><thead><tr><th>モデル</th><th class="n">入力 円/100万トークン</th>` +
    `<th class="n">出力 円/100万トークン</th><th class="n">入力 $/1M</th><th class="n">出力 $/1M</th></tr></thead><tbody>` +
    sorted.map((m) =>
      `<tr><td><span class="m">${esc(m.name)}</span> <span class="pv">${esc(m.provider)}</span></td>` +
      `<td class="n"><b>${yen(Number(m.input))}</b></td><td class="n"><b>${yen(Number(m.output))}</b></td>` +
      `<td class="n">$${esc(m.input)}</td><td class="n">$${esc(m.output)}</td></tr>`).join("") +
    `</tbody></table></div></div>`;

  // 使い方の実感に落とす試算（入力1万・出力2千トークンを1タスクとする）
  const IN = 10000, OUT = 2000;
  const calc = sorted.map((m) => ({ name: m.name, provider: m.provider,
    per: (Number(m.input) * IN + Number(m.output) * OUT) / 1e6 })).sort((a, b) => a.per - b.per);
  const cost = `<div class="market"><div class="mh"><b>月あたりの目安（1タスク＝入力1万・出力2千トークン）</b>` +
    `<span class="as mono">1USD=${FXR}円</span></div><div class="scroll">` +
    `<table class="data"><thead><tr><th>モデル</th><th class="n">1タスク</th><th class="n">1日100タスク（月3,000）</th>` +
    `<th class="n">1日1,000タスク（月3万）</th></tr></thead><tbody>` +
    calc.map((c) =>
      `<tr><td><span class="m">${esc(c.name)}</span> <span class="pv">${esc(c.provider)}</span></td>` +
      `<td class="n">${yen(c.per, 2)}</td><td class="n">${yen(c.per * 3000)}</td>` +
      `<td class="n">${yen(c.per * 30000)}</td></tr>`).join("") +
    `</tbody></table></div></div>`;

  const src = eMeta.verify_sources || sMeta.verify_sources || {};
  const links = ["anthropic", "openai", "google"].filter((k) => src[k])
    .map((k) => `<a href="${esc(src[k])}" rel="noopener" target="_blank">${esc(k)}</a>`).join(" ・ ");

  const body = `  <section>
    <div class="sec-title">AI API料金の円換算 <span class="jp">— 毎日、公式価格と為替の両方を取り直しています</span></div>
    <p class="dek">Claude・GPT・Gemini など主要モデルの<b>API料金を日本円に換算</b>した一覧です。ドル建ての料金は各社の<b>公式価格ページと逐語照合</b>し、為替は<b>毎日取り直し</b>ています。<b>1USD=${FXR}円</b>（${esc(fx._meta?.source_name || "ECB参照レート")}・${jp(fx.rate_date)}公表）で計算しました。固定レートで書いた記事は日が経つほどズレますが、この表は毎日動きます。</p>
    ${table}
    <p class="pv" style="margin-top:8px">単価は「100万トークンあたり」です。1トークンは日本語でおおよそ1文字弱に相当します（モデルにより異なります）。</p>
    ${cost}
    <p class="pv" style="margin-top:8px">上の試算は<b>キャッシュ・バッチ割引を使わない素の従量料金</b>での目安です。実際の請求額は使い方で変わります。</p>
    <p class="mono" style="margin-top:16px;color:var(--ink-3);font-size:11px">一次情報（公式価格ページ）: ${links}。料金は ${esc(sMeta.last_full_check || asOf)} に照合。為替は ${esc(fx._meta?.source_name || "ECB参照レート")}（<a href="${esc(fx._meta?.source_url || "#")}" rel="noopener" target="_blank">出典 ↗</a>・${jp(fx.rate_date)}公表）。<b>実際の請求は各社およびカード会社の換算レートによります</b>ので、支払額の確定にはご自身の明細をご確認ください。</p>
    <p class="more"><a href="../">← ドル建ての一覧（AI相場）へ</a> ・ <a href="../eol/">モデルの提供終了日カレンダーへ →</a></p>
  </section>`;

  const ld = jsonld({ "@context": "https://schema.org", "@graph": [
    { "@type": "Dataset", name: "AI APIモデル料金の円換算表", url: "https://aitimes.jp/soba/jpy/",
      description: `主要AIモデルのAPI料金を日本円に換算した一覧。1USD=${FXR}円で計算（${fx.rate_date}公表レート）。`,
      dateModified: asOf, creator: { "@type": "Organization", name: "AI TIMES" },
      isAccessibleForFree: true, keywords: ["AI API 料金", "日本円", "Claude", "GPT", "Gemini", "円換算"] },
    crumbLd("jpy", "円換算"),
  ] });

  return shell({ slug: "jpy",
    title: `AI API料金の円換算表【${asOf.slice(0, 4)}年${+asOf.slice(5, 7)}月・毎日更新】 — AI TIMES`,
    desc: `Claude・GPT・GeminiのAPI料金を日本円で比較した一覧。1USD=${FXR}円（${fx.rate_date}公表の実レート）で毎日計算し直しています。月あたりの費用の目安つき。ドル建ての公式価格は各社の公式ページと逐語照合。`,
    asOf, ld, crumbName: "円換算", body });
}

// ───────────────────────── /soba/eol/ 提供終了日カレンダー ─────────────────────────
function pageEol() {
  const asOf = eMeta.as_of || "";
  const all = eol.retirements || [];
  const certain = all.filter((r) => r.certain).sort((a, b) => String(a.retirement).localeCompare(String(b.retirement)));
  const tentative = all.filter((r) => !r.certain).sort((a, b) => String(a.retirement).localeCompare(String(b.retirement)));
  const changes = eol.price_changes || [];

  if (!certain.length && !tentative.length) {
    const body = `  <section><div class="sec-title">モデルの提供終了日 <span class="jp">— 準備中</span></div>
    <p class="loading">各社公式の終了日一覧を照合中です。裏取りできたものだけを掲載します。</p></section>`;
    return shell({ slug: "eol", title: "AIモデルの提供終了日 — AI TIMES", desc: "各社AIモデルの提供終了日。照合中です。",
      asOf, ld: jsonld({ "@context": "https://schema.org", "@graph": [crumbLd("eol", "提供終了日")] }), crumbName: "提供終了日", body });
  }

  const row = (r) =>
    `<tr><td class="n mono">${jp(r.retirement)}</td>` +
    `<td><span class="m">${esc(r.display)}</span> <span class="pv">${esc(r.provider)}</span>` +
    `<div class="pv mono" style="margin-top:3px">${esc(r.model_id)}</div></td>` +
    `<td>${r.replacement ? `<span class="mono">${esc(r.replacement)}</span>` : '<span class="pv">—</span>'}</td>` +
    `<td class="mono" style="font-size:11px"><a href="${esc(r.source_url)}" rel="noopener" target="_blank">出典 ↗</a></td></tr>`;

  const certainTable = certain.length ? `<div class="market"><div class="mh"><b>提供終了が告知済みのモデル — ${certain.length}件（終了日の早い順）</b>` +
    `<span class="as mono">as of ${esc(asOf)}</span></div><div class="scroll">` +
    `<table class="data"><thead><tr><th class="n">提供終了日</th><th>モデル</th><th>公式の推奨移行先</th><th>出典</th></tr></thead>` +
    `<tbody>${certain.map(row).join("")}</tbody></table></div></div>` : "";

  const tentativeTable = tentative.length ? `<div class="market"><div class="mh"><b>現役モデルの「最短でもこの日までは使える」日 — ${tentative.length}件</b>` +
    `<span class="as mono">確定日ではありません</span></div><div class="scroll">` +
    `<table class="data"><thead><tr><th class="n">この日より前には終了しない</th><th>モデル</th><th>公式の推奨移行先</th><th>出典</th></tr></thead>` +
    `<tbody>${tentative.map(row).join("")}</tbody></table></div></div>` : "";

  const changeTable = changes.length ? `<div class="market"><div class="mh"><b>予定されている料金改定 — ${changes.length}件</b>` +
    `<span class="as mono">as of ${esc(asOf)}</span></div><div class="scroll">` +
    `<table class="data"><thead><tr><th class="n">適用開始</th><th>モデル</th><th class="n">現在</th><th class="n">改定後</th><th>出典</th></tr></thead><tbody>` +
    changes.map((c) =>
      `<tr><td class="n mono">${jp(c.effective)}</td>` +
      `<td><span class="m">${esc(c.model)}</span> <span class="pv">${esc(c.provider)}</span>` +
      `<div class="pv" style="margin-top:3px">${esc(c.kind)}</div></td>` +
      `<td class="n">$${esc(c.before.input)} / $${esc(c.before.output)}<div class="pv">${esc(c.before.label)}</div></td>` +
      `<td class="n"><b>$${esc(c.after.input)} / $${esc(c.after.output)}</b><div class="pv">${esc(c.after.label)}</div></td>` +
      `<td class="mono" style="font-size:11px"><a href="${esc(c.source_url)}" rel="noopener" target="_blank">出典 ↗</a></td></tr>`).join("") +
    `</tbody></table></div></div>` : "";

  // fail-closed の明示（載せていない提供元と、その理由を隠さない）
  const np = (eMeta.not_published || []).map((n) =>
    `<b>${esc(n.provider)}</b>: ${esc(n.reason)}（確認したページ: <a href="${esc(n.checked_url)}" rel="noopener" target="_blank">公式 ↗</a>・${jp(n.checked_at)}時点）`).join("<br>");

  const body = `  <section>
    <div class="sec-title">AIモデルの提供終了日・料金改定カレンダー <span class="jp">— 各社の公式ドキュメントと逐語照合</span></div>
    <p class="dek">使っているモデルが<b>いつ止まるか</b>、料金が<b>いつ変わるか</b>を、各社の公式ドキュメントから逐語照合してまとめた一覧です。日付・モデルID・公式が示す移行先だけを載せ、<b>推測や噂は載せません</b>。ネット上では同じモデルの終了日が記事ごとに食い違っていることが多いため、必ず出典の公式ページを併記しています。</p>
    ${changeTable}
    ${certainTable}
    <p class="pv" style="margin-top:8px">「提供終了日」を過ぎると、そのモデルIDへのAPIリクエストは各社の案内に従って停止します。上の表の日付は各社が公式に告知した確定日です。</p>
    ${tentativeTable}
    <p class="pv" style="margin-top:8px"><b>この表の読み方</b>: Anthropicの現役モデルは公式表記が「Not sooner than（この日より前には終了しない）」で、<b>終了日そのものは未確定</b>です。確定日と混ぜると誤解を招くため、表を分けています。</p>
    ${np ? `<p class="mono" style="margin-top:16px;color:var(--ink-3);font-size:11px">${np}</p>` : ""}
    <p class="mono" style="margin-top:10px;color:var(--ink-3);font-size:11px">一次情報: ${Object.entries(eMeta.verify_sources || {}).map(([k, v]) => `<a href="${esc(v)}" rel="noopener" target="_blank">${esc(k)}</a>`).join(" ・ ")}。${esc(eMeta.last_full_check || asOf)} に照合。各社は予告なく予定を変更することがあります。実際の移行判断は必ず公式ページでご確認ください。</p>
    <p class="more"><a href="../">← AI相場（API料金の全一覧）へ</a> ・ <a href="../jpy/">円換算表へ →</a></p>
  </section>`;

  const ld = jsonld({ "@context": "https://schema.org", "@graph": [
    { "@type": "Dataset", name: "AIモデルの提供終了日・料金改定カレンダー", url: "https://aitimes.jp/soba/eol/",
      description: "Anthropic・OpenAI の公式ドキュメントと逐語照合した、AIモデルの提供終了（リタイア）日と料金改定予定の一覧。",
      dateModified: asOf, creator: { "@type": "Organization", name: "AI TIMES" },
      isAccessibleForFree: true, keywords: ["提供終了", "廃止", "deprecation", "モデル 終了日", "API 値上げ"] },
    crumbLd("eol", "提供終了日"),
  ] });

  return shell({ slug: "eol",
    title: `AIモデルの提供終了日・料金改定カレンダー【${asOf.slice(0, 4)}年${+asOf.slice(5, 7)}月】 — AI TIMES`,
    desc: `Claude・GPTの各モデルがいつ提供終了になるか、料金がいつ変わるかを各社の公式ドキュメントと逐語照合した一覧。終了日・モデルID・公式の推奨移行先つき。推測は載せません。`,
    asOf, ld, crumbName: "提供終了日", body });
}

// ───────────────────────── 書き出し ─────────────────────────
const PAGES = [{ slug: "jpy", html: pageJpy() }, { slug: "eol", html: pageEol() }];
const writes = [];
for (const p of PAGES) {
  const file = join(DOCS, "soba", p.slug, "index.html");
  const cur = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (cur !== p.html) writes.push({ ...p, file, dir: join(DOCS, "soba", p.slug) });
}

if (CHECK) {
  if (writes.length) {
    console.error(`✗ soba の派生ページがデータと不一致(${writes.map((w) => w.slug).join(", ")})。node tools/gen_soba_pages.mjs を実行してコミット`);
    process.exit(1);
  }
  console.log("✓ soba 派生ページは最新"); process.exit(0);
}
for (const w of writes) {
  mkdirSync(w.dir, { recursive: true });
  writeFileSync(w.file, w.html);
  console.log(`✓ soba/${w.slug}/index.html 生成`);
}
if (!writes.length) console.log("soba 派生ページ: 変更なし");

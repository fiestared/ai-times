/**
 * サイトを組み立てる（データJSON → 静的HTML → sitemap/feed）。
 *
 * なぜ1本にまとめるか（2026-07-28の実測が根拠）:
 *   生成器が gen_home / gen_soba / … と増え、**どれを走らせ忘れたか誰も分からない**状態だった。
 *   実際、/news/ /tools/ /kasegu/ は生成器そのものが無く、JS描画のまま10日以上放置され、
 *   一次照合済みの独自要約158件が検索エンジンにもAI回答エンジンにも不可視だった。
 *   走らせ忘れを人の記憶に頼らせない。**JSONを触ったら build_site を叩く**、それだけにする。
 *
 *   node tools/build_site.mjs          生成（コミット前にこれを叩く）
 *   node tools/build_site.mjs --check  生成物がデータと不一致なら失敗（夜間テストランナー用）
 *
 * 公開後の索引通知は含めない（デプロイが反映される前に通知すると古い内容を取りに来る）。
 * push してGitHub Pagesに載ったあとに: node tools/indexnow.mjs --auto && node tools/ping_google.mjs
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

// 順序に意味がある: 各ページを焼いてから、記事一覧＋sitemap（gen_kiji_index が唯一の所有者）と feed を作る。
// 為替は外部APIを叩くので --check では走らせない（検査が通信で落ちるのは検査の役目ではない）。
// 失敗しても既存の fx.json を残すだけなので、ここで止めない。
if (!CHECK) {
  process.stdout.write("── 為替レート (fetch_fx.mjs)\n");
  try {
    process.stdout.write(execFileSync(process.execPath, [join(ROOT, "tools/fetch_fx.mjs")],
      { cwd: ROOT, encoding: "utf8" }).replace(/^/gm, "   "));
  } catch (e) {
    process.stdout.write("   ⚠️ 為替の取得に失敗（既存の fx.json をそのまま使う）\n");
  }
}

const STEPS = [
  ["gen_home.mjs", "一面"],
  ["gen_soba.mjs", "AI相場"],
  ["gen_soba_pages.mjs", "AI相場の派生ページ（円換算・提供終了日）"],
  ["gen_news.mjs", "速報＋トピックページ"],
  ["gen_lists.mjs", "AIツール／AIで稼ぐ"],
  ["gen_kiji_index.mjs", "記事一覧"],
  ["gen_feed.mjs", "RSSフィード"],
];

let failed = 0;
for (const [script, label] of STEPS) {
  const args = [join(ROOT, "tools", script), ...(CHECK ? ["--check"] : [])];
  process.stdout.write(`── ${label} (${script})\n`);
  try {
    const out = execFileSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
    process.stdout.write(out.replace(/^/gm, "   "));
  } catch (e) {
    failed++;
    process.stdout.write((e.stdout || "").replace(/^/gm, "   "));
    process.stderr.write((e.stderr || String(e)).replace(/^/gm, "   "));
  }
}

if (failed) {
  console.error(`\n✗ ${failed}件の生成器が失敗した。${CHECK ? "node tools/build_site.mjs を実行してコミットする。" : "上のエラーを直すこと。"}`);
  process.exit(1);
}
console.log(`\n✓ ${CHECK ? "生成物はデータと一致している" : "サイトを生成した"}（${STEPS.length}工程）`);

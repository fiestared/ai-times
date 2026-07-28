/**
 * 速報データの共通定義。gen_news.mjs / gen_feed.mjs / gen_sitemap.mjs が読む。
 *
 * ★ここを1箇所にしている理由: 記事アンカー(story id)が生成器ごとにズレると、
 *   RSSが指すURLとページ内の id が食い違い、**購読者が飛んだ先に記事が無い**という
 *   静かな壊れ方をする。IDの作り方は必ずここだけを正本にする。
 */
import { createHash } from "node:crypto";

/**
 * 記事の永続アンカー。source_url だけから作る（タイトルは推敲で変わりうるが、
 * 出典URLは記事の同一性そのもの）。同じ出典URLの記事が複数あるときは、
 * 呼び出し側が seen で連番を足して衝突を避ける。
 */
export function storyId(item) {
  const key = String(item.source_url || item.title || "");
  return "s-" + createHash("sha1").update(key).digest("hex").slice(0, 10);
}

/** 同一トピック内でアンカーが衝突しないよう連番を振る（-2, -3…）。 */
export function withAnchors(items) {
  const seen = new Map();
  return items.map((it) => {
    const base = storyId(it);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { ...it, _anchor: n === 1 ? base : `${base}-${n}` };
  });
}

export const newest = (items) => items.slice().sort((a, b) =>
  String(b.time || "").localeCompare(String(a.time || "")));

/** トピックID → 公開URLと見出し。kasegu は専用ページ(/kasegu/)が扱うのでここには無い。 */
export const TOPIC_PAGES = {
  model: {
    slug: "model", h1: "AIモデル・API価格のニュース",
    title: "AIモデル・API料金の最新ニュース｜新モデルと価格改定を一次情報で",
    desc: "GPT・Claude・Gemini・Kimi など新モデルの発表とAPI料金の改定を、各社の公式価格ページ・公式ブログと逐語照合して要約。価格は毎日再照合しています。転載はせず必ず出典リンクを付けます。",
  },
  tool: {
    slug: "tool", h1: "AIツール・プロダクトのニュース",
    title: "AIツールの最新ニュース｜新ツールとアップデートを一次情報で",
    desc: "AIツール・プロダクトの登場とアップデートを、公式リリースノート・公式発表と照合して要約した一覧。何が変わったかを事実だけで書き、必ず一次情報へのリンクを付けます。",
  },
  kisei: {
    slug: "kisei", h1: "AIの規制・制度のニュース",
    title: "AIの規制・制度の最新ニュース｜法律とガイドラインを一次情報で",
    desc: "AI推進法、文化庁のAIと著作権、経産省・総務省のAI事業者ガイドライン、EU AI Act など、AIをめぐる法律・制度・訴訟を官公庁の一次情報と逐語照合して要約した一覧。",
  },
  katsuyo: {
    slug: "katsuyo", h1: "企業のAI活用事例のニュース",
    title: "企業の生成AI導入事例ニュース｜国内企業の活用を一次情報で",
    desc: "日本企業を中心に、会社が生成AIをどう業務に入れたかを公式プレスリリースと逐語照合して要約した事例一覧。削減時間・利用回数などの数値は一次情報に実在するものだけを載せます。",
  },
};

/** 表示対象のトピック（items があるものだけ・fail closed。kasegu は専用ページへ）。 */
export const liveTopics = (d) =>
  (d.topics || []).filter((t) => (t.items || []).length && t.id !== "kasegu");

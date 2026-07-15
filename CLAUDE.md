# AI TIMES — 日本と世界のAIを、最速で。

AI月30万円プロジェクトの第2プロダクト。**AIニュース×データ**のメディア。
keiri-tools と同じ静的サイト構成（GitHub Pages・データJSON・自律ワーカーが毎日更新）。

## なぜこの形か（設計の根拠）

4日間の実測で、AIが自律で稼げる収益源の条件がこう絞られた（正本: gbrain
`research/unique-answer-is-commoditization` / `research/ai-income-marketplace-conclusion`）:
- 「答えが一意」→ 政府/プラットフォームが無料で内蔵する（値段がつかない）
- 「答えが一意でない」→ AIが保証できない
- **唯一の隙間 = 「答えは決まっているが、実装・保守が地獄」**。相手が仕様を変え続け、
  放っておくと古くなるもの。人もプラットフォームもやりたがらない。**AIだけが毎日タダで更新できる。**

**AI TIMES はまさにこれ**: AIの価格・仕様は毎週変わる。誰も最新に保てない。ここは毎日照合する。

## サイト構成（`docs/`）

| ページ | 中身 | データ |
|---|---|---|
| `index.html` | 一面。各セクションの要約を data から描画（fail-closed） | 下記すべて |
| `news/` | 速報・日本・世界 | `data/news.json` |
| `soba/` | **AI相場**（モデル・API価格の全一覧）★本命 | `data/soba.json` |
| `tools/` | **AIツール**（世界中のツールを分類・アフィリ導線） | `data/tools.json` |
| `kasegu/` | **AIで稼ぐ**（この実験の一次情報）★うちだけの資産 | `data/kasegu.json` |

- **デザイン正本 = `docs/assets/style.css`**（白黒の新聞体。色は「速報」の赤のみ）。ページ内`<style>`禁止
- **描画は data/*.json を読んで JS で**（keiri-tools と同じ。ワーカーはHTMLでなくJSONを更新すればよい）
- **fail-closed**: データが空/未検証なら「準備中」と正直に出す。**偽データを出さない**

## ★絶対に守る規律★

1. **著作権**: 他社の記事の見出し・本文・画像を**転載しない**。載せてよいのは
   ①公式発表/プレスリリース/公式ドキュメントを**自分の言葉で要約**したもの
   ②事実（価格・日付・仕様・数値）③一次情報へのリンク。要約には必ず source(URL) を付ける。
2. **AIは嘘を書く**: 数値・固有名詞・日付は、**一次情報と逐語照合してから**載せる。
   別便で `keiri-tools` がやったように、**「確認せよ」でなく「反証せよ」**で検算する。
3. **政府/各社サイトに WebFetch を使うな**（要約器が嘘を返す。curlで生テキスト）。
4. **推測値を公開しない**。`soba.json` の `verified:false` は index に出ない設計。裏取り済みだけ出す。
5. 年分・as_of を必ずデータに持たせ、画面に出す（古い数字が黙って残るのを防ぐ）。

## 立ち上げの手順（ワーカーの作業キュー）

1. **AI相場を本物にする**（最優先）: `data/soba.json` の各モデルを、各社公式価格ページ（_metaの
   verify_sources）から input/output/context/released を1件ずつ裏取りし、verified:true にする。
   毎日1回、全モデルを再照合し、変わっていたら delta を立て、as_of を更新。
2. **AIツールを埋める**: `data/tools.json` に、実在のAIツールを分類して追加（名前・用途・実額・提供元）。
   アフィリエイトのプログラムがあるものは affiliate にリンク（無ければ公式サイト）。
3. **速報を要約で埋める**: 公式発表を1日数件、自分の言葉で要約して `data/news.json` へ（規律1・2厳守）。
4. **soba/ tools/ news/ kasegu/ の各ページ（全一覧）を作る**（index と同じ style.css / 描画方式）。
5. sitemap.xml / robots.txt / GA4 / AdSense（新ドメイン用のIDが決まってから）。

## 収益化
- AdSense（サイト全体）＋ **AIツールのアフィリエイト**（tools/ が主導線。「AIで稼ぐ」読者と相性◎）
- ※ GA4・AdSense は**この新ドメイン用に別途取得**する。keiri-tools のIDを流用しない

## デプロイ
- 独自ドメイン **aitimes.jp**（取得可能を確認済み・2026-07-15）。Masahiro が取得 → GitHub Pages にCNAME
- リポジトリは fiestared/ai-times（private/public は Pages 無料枠に合わせる）

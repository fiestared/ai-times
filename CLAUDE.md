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
| `index.html` | 一面。各セクションの要約を data から生成（fail-closed） | 下記すべて |
| `news/` | 速報＋**トピック別ニュース**。配下に `news/model/` `news/tool/` `news/kisei/` `news/katsuyo/` | `data/news.json` |
| `soba/` | **AI相場**（モデル・API価格の全一覧・円換算つき）★本命 | `data/soba.json` + `data/fx.json` |
| `tools/` | **AIツール**（世界中のツールを分類・アフィリ導線） | `data/tools.json` |
| `kasegu/` | **AIで稼ぐ**（世界の『AIで稼いだ』実例を出典つきで集める） | `data/kasegu.json` |
| `feed.xml` | RSS 2.0（購読・アグリゲータの新着検出用） | `data/news.json` |

- **デザイン正本 = `docs/assets/style.css`**（白黒の新聞体。色は「速報」の赤のみ）。ページ内`<style>`禁止
- ⛔ **JSON を JS で fetch して描画してはいけない**（2026-07-15〜28 の実失敗）。
  この形だった `/news/` `/tools/` `/kasegu/` は、生HTMLの本文が「読み込み中…」の
  **425字 / 439字 / 409字**しか無かった。**GPTBot・ClaudeBot・PerplexityBot・bingbot は
  JavaScript を実行しない**（3UAで実測。全て同じ6,725バイトの空シェルが返った）ので、
  一次照合済みの独自要約158件（207KB）が検索にもAI回答エンジンにも**存在しないのと同じ**だった。
  13日間でPV35・GSC表示19・Bing表示0だった最大の原因がこれ。
  **JSONが正本・HTMLは生成物**。生成は `node tools/build_site.mjs`。
- **fail-closed**: データが空/未検証なら「準備中」と正直に出す。**偽データを出さない**

## 生成器（データを触ったら必ず走らせる）

```
node tools/build_site.mjs          # 為替取得 → 全ページ生成 → 記事一覧/sitemap → RSS
node tools/build_site.mjs --check  # 生成物がデータと不一致なら失敗（夜間テストランナー）
```

| 生成器 | 受け持ち |
|---|---|
| `fetch_fx.mjs` | ECB参照レートから USD/JPY を取得（`data/fx.json`）。失敗したら**古い値を残して何もしない** |
| `gen_home.mjs` | 一面 |
| `gen_soba.mjs` | AI相場（円換算列を含む） |
| `gen_news.mjs` | `/news/` とトピック別ページ4本。記事アンカーは `tools/newslib.mjs` が正本 |
| `gen_lists.mjs` | `/tools/` `/kasegu/` |
| `gen_kiji_index.mjs` | 記事一覧と **sitemap.xml（唯一の所有者。ページを足したら STATIC_PAGES にも足す）** |
| `gen_feed.mjs` | `feed.xml` |

**push して GitHub Pages に反映されたあとに**索引通知を出す（反映前に通知すると古い内容を取りに来る）:
```
node tools/indexnow.mjs --auto      # Bingへ即時通知（BingはChatGPT検索/Copilot/Perplexityの情報源）
node tools/ping_google.mjs          # GSCにsitemapを再送信（手動更新だった頃、Googleの最終取得が10日止まっていた）
```

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
3. **トピック別ニュースを埋める**（キュレーション。転載でなく要約＋出典）:
   `data/news.json` の topics に、RSS巡回＋公式発表から拾った項目を要約して足す。トピックは:
   - **kasegu（AIで稼ぐ）** … examples とは別に、稼いだ話の速報。ただし金額の確定事例は kasegu.json の examples へ
   - **katsuyo（企業のAI活用）** … 会社がAIをどう業務に入れたか。国内事例を厚く
   - **model（モデル・技術）** … 新モデル・価格・性能（AI相場と連動）
   - **tool（ツール・プロダクト）** … 新ツールの登場・更新（AIツールと連動）
   - **kisei（規制・制度）** … 法律・ガイドライン・著作権（経産省/総務省/文化庁/EU）
   **日本の事例に偏りを持たせる**（海外速報サイトが拾わない国内を強みにする）。
4. **kasegu.json の examples に「AIで稼いだ実例」を足す**: 誰が・何で・月いくら＋出典URL。
   **金額は必ず出典に実在することを確認**（AIは金額を捏造しがち）。日本の個人開発/note/Xの事例も。
5. **狙うクエリを外さない**（2026-07-28 のSERP実地調査が根拠。詳細は下の「勝てる場所」）。

## 勝てる場所（2026-07-28 のSERP実地調査。詳細な根拠は gbrain `research/aitimes-serp-gaps-2026-07`）

**頭ワードは捨てる**。「AIニュース」は日経/ITmedia AI＋/Ledge.ai/aismileyが独占、
「Claude 料金」「ChatGPT API 料金」は企業メディア5社以上が【2026年7月最新】で月次更新合戦中。
新規ドメインで正面から取れるものは無い。**個人ブログ・Zenn・noteが上位に入っているクエリだけを狙う**
（実際に入っている＝ドメインパワーの壁が低い証拠）。

穴は3種類しかない。記事を書くときは**どれを狙っているか言えること**:
1. **鮮度切れ** — 価格・無料枠・提供終了日は数週間で腐るのに、上位記事は書き逃げ。
   例: Claude高速モードの「6倍」は5月時点の$30/$150前提の記事が上位に残存（現行は$10/$50）。
   DeepSeek API 料金の2位は1年半前のZenn記事。
2. **情報の食い違い** — 再販業者の円建て価格・OpenRouter観測値・固定為替が公式価格と混ざって
   SERP内で矛盾している。例: 上位の比較表がOpus 4.8を$15/$75と誤記（公式は$5/$25）。
   **「公式ページではどうなのか」を逐語照合で断言できるのが当サイトの武器**。
3. **新語の窓** — 新モデル名は発表から数週間、小規模サイトでも上位に入れる。
   → **新モデル発表当日に照合済みの価格ページを出す**。自律ワーカーと最も相性がよい。
   ★確定している次の山: **Claude Sonnet 5 の導入価格$2/$10 は 2026-08-31 で終了、9/1から標準$3/$15**
   （公式価格ページで照合済み・soba.jsonのnoteにも記載）。日付が確定した将来イベントなので先回りできる。

**AI検索（ChatGPT/Copilot/Perplexity）はBing経由で狙う**。Bingの索引がこれらの情報源になっており、
IndexNowで即時通知できる＝ドメインパワー無しで露出が取れる唯一の経路。
一方 Google AI Overviews は引用の76%が同クエリtop10からで、先にGoogleの順位が要る＝近道にならない。
llms.txt は決め手にならない（Google公式が「参照元選定の決定要因になる可能性は低い」と明言）。

## 情報源（news の集め方）
- **RSS**: 各AIメディア・企業ブログのRSSをワーカーが毎日巡回 → 見出し＋要点を**自分の言葉で要約**（全文転載しない）→ 必ず出典URL
- **公式発表**: OpenAI/Anthropic/Google/Meta/国内企業/官公庁の発表を一次情報で裏取り
- **数値・固有名詞・日付は一次情報と逐語照合してから載せる**（AIの捏造を通さない）

## 収益化
- AdSense（サイト全体）＋ **AIツールのアフィリエイト**（tools/ が主導線。「AIで稼ぐ」読者と相性◎）
- ※ GA4・AdSense は**この新ドメイン用に別途取得**する。keiri-tools のIDを流用しない
- **実測(GSC/GA4/Bing)**: SA `ga-reader@keiri-tools.iam.gserviceaccount.com`(既存・scrumtechnology名義)。
  **elife系の会社GCPは使わない**。新しいGCP/SAも作らない。
  ```
  cd ~/Scripts/ai-income-daily
  ./.venv/bin/python sc_check.py --site aitimes    # Google Search Console（クエリ・順位・索引被覆）
  ./.venv/bin/python ga_check.py --report          # GA4（keiri と AI TIMES の両方）
  ./.venv/bin/python bing_check.py --site aitimes  # Bing（週次更新）
  ```
  ⚠️ ga_check.py は 2026-07-28 まで keiri-tools のプロパティ固定で、`--site` 引数すら無かった
  （＝AI TIMESのGA4は一度も測れておらず、keiriの数字が成果として報告されていた）。
  **「測れている」を検証せずに信じない**。数字が出たら、それがどのサイトのものか確かめる。

## デプロイ
- 独自ドメイン **aitimes.jp**（取得可能を確認済み・2026-07-15）。Masahiro が取得 → GitHub Pages にCNAME
- リポジトリは fiestared/ai-times（private/public は Pages 無料枠に合わせる）

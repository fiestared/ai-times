# 記事の書き方（AI TIMES）

**このファイルが記事の正本の型。** `node tests/test_article_structure.mjs` が機械で強制する。
書き終えたら必ず自分で流し、緑にしてから終わること。

AI TIMES は白黒新聞体の静的サイト（GitHub Pages・aitimes.jp）。デザイン正本は
`docs/assets/style.css`。**記事は「ニュースの転載」ではない** — 事実＋出典リンク＋自分の言葉の解説。

## 記事の位置づけ（keiri-tools と違う。ここを外さない）

記事は `docs/kiji/<slug>/index.html` に置く（データ表示ページ soba/ tools/ news/ kasegu/ とは別。
記事本文が検索で拾われる入口になる）。**AI TIMES の SEO 戦略に沿った3カテゴリに限定**する
（新規ドメインで「AIニュース」等の頭ワードは大手に勝てない。長尾×鮮度×構造化データで勝つ）:

1. **AI相場・料金**（id: `soba`）— 例「主要AIモデルのAPI料金の見方」「Claude API 料金の見方」。soba/ のデータへ導線
2. **企業のAI活用 事例**（id: `katsuyo`）— 例「〇〇社の生成AI導入事例」。具体的な国内事例のまとめ
3. **AIで稼ぐ 事例・方法**（id: `kasegu`）— 例「Chrome拡張で稼ぐ実例」。kasegu/ のデータへ導線

**どのカテゴリにも入らないテーマは書かない**（未分類はテストが落とす）。

## 絶対に守ること（これを破ると商品が壊れる）

1. **数字を推測で書かない。** 料金・トークン単価・文脈長・リリース日は、**一次情報**（各社の
   公式価格ページ・モデルカード・公式ブログ）を読んで確かめる。AIは金額・固有名詞・日付を
   平気で捏造する。確かめられなかった数字は**書かない**。

   ⚠️ **各社サイトの数値確認に WebFetch を使うな。要約器が「もっともらしい嘘」を返す。**
   エラーにならないので気づけない。必ず生テキストを読む。
   ```
   curl -sL <URL> -o /tmp/x.html            # ← まず取得（-L でリダイレクト追従）
   curl -sL <URL> | grep -io 'charset=[a-z0-9_-]*' | head -1   # 文字コードを見てから読む
   ```
   価格ページは JS 描画・OAuth 必須のことが多い（Anthropic/OpenAI/Google の pricing は
   curl で本文が取れないことがある）。取れないときは:
   - **`docs/data/soba.json` を正本にする**（毎日、各社公式と逐語照合済みの verified データ）。
     記事の相場の数値は **soba.json と一致させる**（食い違うと片方が嘘になる）。
   - 公式ドキュメント/モデルカード（例 deepmind.google/models）の価格・仕様表を curl で読む。

2. **著作権を守る。** 他社記事の見出し・本文・画像を**転載しない**。載せてよいのは
   ①公式発表/ドキュメントを**自分の言葉で要約**したもの ②事実（価格・日付・仕様・数値）
   ③一次情報へのリンク。要約には必ず出典URLを付ける。

3. **出典を h2「出典」に列挙する。** どのページを見たか（発行元＋資料名＋URL）を書く。

4. **年分・as_of を明記する。** タイトルや本文に「【2026年7月】」「as of 2026-07-16」。
   無記名の数字は将来の嘘になる（AIの価格は毎週変わる）。

5. **一般論の免責を末尾に置く**（`.disclaimer` の一文。価格は変わる旨・各社公式で最新を確認）。

## ファイルの場所と作り方

`docs/kiji/<slug>/index.html` の1ファイルを作る（slug は英小文字・数字・ハイフン）。
**sitemap.xml / kiji/index.html / assets/style.css は手で触らない** — 生成器と親が更新する:
- `node tools/gen_kiji_index.mjs` … sitemap.xml と 記事一覧(kiji/index.html) を生成。
  記事を足したら **CATEGORIES の slugs に登録**する（未分類はテストが落とす）。
- `node tools/gen_faq_jsonld.mjs` … FAQのJSON-LDを**本文から生成**（手で書かない）。
- 記事用CSSが style.css に足りなければ親が追加する（記事側に `<style>` は書かない）。

## 型（テストが見ている）

```
<head>
  <title>…【2026年7月】 — AI TIMES</title>   60字以内。検索結果で切れる
  <meta name="description" …>                60字以上。要点＋数字を入れる
  <meta name="card-desc" …>                  一覧カード用の短い惹句（任意。無ければ description を使う）
  <link rel="stylesheet" href="../../assets/style.css">
  <link rel="canonical" href="https://aitimes.jp/kiji/<slug>/">
  JSON-LD @graph に Article（datePublished/dateModified）と BreadcrumbList
  GA4タグ (G-KZV2EZYGDP) と AdSense (ca-pub-2635067516563578)
     → 既存記事の <head> をそのままコピーして中身だけ差し替えるのが確実
</head>
<body>
  <div class="util">…</div>
  <header class="wrap mast">…共通マストヘッド…</header>
  <nav class="sections">…共通ナビ（記事 を含む）…</nav>
  <main class="wrap">
  <nav class="breadcrumb">ホーム › 記事 › <この記事></nav>
  <article class="kiji">
    <h1>…</h1>
    <p class="article-meta"><b>公開</b> 2026年7月16日 ／ <b>照合</b> soba.json（各社公式）</p>

    <p class="lead">〈結論ファーストのリード 2〜3段落〉</p>  ← 読者は「答え」を探しに来ている。先に言う

    <nav class="toc"><div class="toc-title">目次</div><ol>…全h2へのリンク…</ol></nav>

    <h2 id="…">…</h2>   ← h2 は3つ以上。すべて id を持ち、すべて目次に載る
    …
    <figure class="figure">…インラインSVG…<figcaption>…</figcaption></figure>
       ← 図解は必須。外部画像は使わない（<img src="http…"> はテストが落とす）

    <a class="tool-cta" href="../../soba/">…AI相場のデータへ…</a>   ← 記事は入口、データが商品

    <h2 id="faq">よくある質問</h2>
    <h3>Q. …？</h3>
    <p>A. …</p>          ← 答えは h3 直後の <p> ひとつだけ。表・calloutを入れない
    （FAQのJSON-LDは本文から自動生成する。手で書かない）

    <section class="related"><div class="rel-title">関連</div>…soba/ tools/ kasegu/ 等のカード…</section>
    <h2 class="sources-h">出典</h2><ol class="sources">…発行元＋資料名＋URL…</ol>
    <p class="disclaimer">〈免責の一文〉</p>
  </article>
  </main>
  <footer>…共通フッター…</footer>
</body>
```

## 使えるCSSクラス（`<style>` は書かない。テストが落とす）

`.callout`（注意ボックス／`<b>`が見出しになる）・`.figure`＋`figcaption`・`.summary-box`（まとめ・
`<b>`不要、中は `ul`）・`.tool-cta`（データページへのCTA）・`.related`＋`.tool-grid`＋`.tool-card`
（関連カード）・`.scroll-wrap`（横長の表を包む）・`.article-meta`・`.toc`（＋`.toc-title`）・
`.breadcrumb`・`.sources`・`.disclaimer`。表は `.scroll-wrap` の中に素の `<table>`（`th.n`/`td.n` で右寄せ）。

## 中身の質（ここで差がつく）

- **結論を先に。** 「結論から言うと、Xです」。読者は答えを探しに来ている。
- **具体例と実数を必ず入れる。** 「入力$5・出力$25/1M（Claude Opus 4.8）」のように、名前と数字をセットで。
- **表で比較する。** 「AとBの違い」は文章で並べず表にする（相場記事は料金表が主役）。
- **落とし穴・間違えやすい点を書く。** 「単価が安く見えても新トークナイザーで実コストは下がらない」等、
  一次情報に当たらないと分からない一段を必ず1つ入れる。
- **導入価格・割引・注記の期限を明示。** 「導入価格は2026-08-31まで」のような時限は年月日で書く。
- 文字数の目安 2,500〜5,000字（可視テキスト）。薄い記事は量産しても価値がない。

## SVG図解の作り方

`viewBox` を切って、矩形・線・テキストで描く。凝った絵はいらない。
**内訳（料金の入力/出力/文脈の関係）・比較（各社の単価）・流れ図**のどれかが有効。
文字は `font-size="12〜13"`、`fill="currentColor"` で本文色に追従させる（白黒に自動対応）。色を足すなら
`var(--live)`（速報の赤）だけ。**必ずヘッドレスChromeで実描画して目視**する — 座標を手で置くので、
注釈の矢印が意図した対象を指していない・線が宙に浮く、は描かないと分からない。

## Search Console で厚くする（keiri と同じ押し上げ）

`sc_check.py --site aitimes` の「押し上げ候補（11〜50位）」に出たクエリ×ページを最優先で厚くする。
①クエリの語が title/h1/見出しに自然に入っているか ②検索者の答えが結論ファーストで先頭にあるか
③不足論点を1〜2節足す ④soba/ tools/ kasegu/ への導線 ⑤記事間の内部リンク。
一次情報の確認・型テスト（`node tests/test_article_structure.mjs`）は従来どおり。

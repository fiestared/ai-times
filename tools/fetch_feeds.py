#!/usr/bin/env python3
"""AI TIMES — フィード巡回・パーサ（正本）

なぜこのファイルがあるか（2026-07-25）:
  毎便 tmp スクリプトでパーサを書き直していたため、同じ失敗を繰り返していた。
  07-25 第3便は「ITmedia は XML として不正」と結論したが、実際は
  **RSS 2.0 として完全に正当** で、パーサ側が名前空間つき要素（dc:date 等）
  だけを見ていたのが原因だった。形式ごとの差を1箇所に閉じ込める。

対応形式:
  - RSS 2.0      <rss><channel><item>   日付= pubDate
  - RSS 1.0/RDF  <rdf:RDF><item>        日付= dc:date
  - Atom         <feed><entry>          日付= published / updated

規律（ai-times/CLAUDE.md）:
  - **日付が取れない項目は捨てる**（新しさを判定できないものは載せない）
  - 本文は転載しない。ここで取るのは「要約を書くための材料」と source_url まで
使い方:
  python3 tools/fetch_feeds.py                 # 既定の巡回先すべて・直近14日
  python3 tools/fetch_feeds.py --days 7
  python3 tools/fetch_feeds.py --only itmedia  # 名前の部分一致で絞る
  python3 tools/fetch_feeds.py --url <feed_url> --name adhoc
  python3 tools/fetch_feeds.py --selftest      # パーサの3形式を自己検査
"""
import argparse
import datetime as dt
import email.utils
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

JST = dt.timezone(dt.timedelta(hours=9))

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# 巡回先。XMLのRSSを優先（JS描画・403のページは入れない）
FEEDS = [
    # --- 国内（AI TIMES の強み。厚くする） ---
    ("itmedia-aiplus",  "https://rss.itmedia.co.jp/rss/2.0/aiplus.xml"),
    ("itmedia-news",    "https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml"),
    ("ascii-tech",      "https://ascii.jp/rss.xml"),          # 全社フィード（AI以外が大半→--ai で絞る）
    ("publickey",       "https://www.publickey1.jp/atom.xml"),
    ("impress-watch",   "https://www.watch.impress.co.jp/data/rss/1.0/ipw/feed.rdf"),
    ("cnet-japan",      "https://feeds.japan.cnet.com/rss/cnet/all.rdf"),
    # --- 海外 ---
    ("techcrunch-ai",   "https://techcrunch.com/category/artificial-intelligence/feed/"),
    ("venturebeat-ai",  "https://venturebeat.com/category/ai/feed/"),
    ("theverge-ai",     "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml"),
    # --- 各社公式 ---
    ("openai-news",     "https://openai.com/news/rss.xml"),
    ("googleblog-ai",   "https://blog.google/technology/ai/rss/"),
    ("huggingface",     "https://huggingface.co/blog/feed.xml"),
    # ★ anthropic はRSSを出していない（2026-07-25 実測）。
    #   /news/rss.xml /rss.xml /feed.xml /index.xml /news/feed.xml /blog/ /research/ /engineering/
    #   の8通りが全て404で、同時に叩いた openai・google は200（＝経路は生きている＝対照実験）。
    #   Anthropic の発表は「公式ページを直に curl」＋ITmedia/impress の報道で拾う。
    #   フィードを足すのでなく、404を "0件" と誤読しないことが要点（下の HTTP status 検査）。
]


def strip_html(s):
    if not s:
        return ""
    s = re.sub(r"<script[\s\S]*?</script>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = (s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<")
          .replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'"))
    return re.sub(r"\s+", " ", s).strip()


def parse_date(s):
    """RFC822 / ISO8601 のどちらでも受ける。取れなければ None（=その項目は捨てる）。"""
    if not s:
        return None
    s = s.strip()
    try:                                     # RFC822 (pubDate)
        d = email.utils.parsedate_to_datetime(s)
        if d:
            if d.tzinfo is None:
                d = d.replace(tzinfo=dt.timezone.utc)
            return d.astimezone(JST)
    except Exception:
        pass
    try:                                     # ISO8601 (dc:date / published)
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return d.astimezone(JST)
    except Exception:
        pass
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)   # 日付だけ
    if m:
        return dt.datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=JST)
    return None


def _local(tag):
    """{namespace}tag → tag（名前空間を落とす）。これを怠ると Atom/RDF を取りこぼす。"""
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _first(el, names):
    """子孫から names のいずれかに最初に一致した要素を返す（名前空間非依存）。"""
    for child in el.iter():
        if _local(child.tag) in names and child is not el:
            return child
    return None


def parse_feed(xml_bytes):
    """RSS2.0 / RDF / Atom を1つの形に正規化して返す。"""
    root = ET.fromstring(xml_bytes)
    out = []
    nodes = [e for e in root.iter() if _local(e.tag) in ("item", "entry")]
    for node in nodes:
        title = _first(node, ("title",))
        title = strip_html(title.text if title is not None else "")

        # link: RSS はテキスト、Atom は <link href="..."/>
        url = ""
        for child in node.iter():
            if _local(child.tag) != "link" or child is node:
                continue
            if child.get("href"):
                rel = child.get("rel") or "alternate"
                if rel == "alternate":
                    url = child.get("href")
                    break
            elif (child.text or "").strip():
                url = child.text.strip()
                break

        dnode = _first(node, ("pubDate", "date", "published", "updated", "issued"))
        when = parse_date(dnode.text if dnode is not None else "")

        dsc = _first(node, ("description", "summary", "content", "encoded", "subtitle"))
        summary = strip_html(dsc.text if dsc is not None else "")

        if not title or not url or when is None:
            continue          # 日付・URL・見出しが揃わないものは載せない（fail-closed）
        out.append({
            "title": title,
            "url": url,
            "date": when.strftime("%Y-%m-%d"),
            "ts": when.isoformat(),
            "summary": summary[:600],
        })
    return out


def fetch(url, timeout=30):
    """本文と HTTP ステータスを**両方**返す。

    ★ここを分けている理由（2026-07-25 に実際にやらかした）:
      anthropic.com/news/rss.xml は **404 なのに Next.js のエラーページHTMLを返す**。
      本文だけ見て XML パースにかけると、HTMLがたまたま整形式なので
      **例外も出さず「0件」**になり、巡回結果に `ok parsed=0` と表示される。
      ＝「フィードは生きているが今日は新着が無い」と読めてしまう。
      死んでいるURLと、生きていて空のURLを、混同してはならない。
    """
    r = subprocess.run(
        ["curl", "-sL", "-m", str(timeout), "-A", UA, "--compressed",
         "-w", "\n__HTTP__%{http_code} %{content_type}", url],
        capture_output=True)
    out = r.stdout
    status, ctype = 0, ""
    marker = out.rfind(b"\n__HTTP__")
    if marker >= 0:
        tail = out[marker + 9:].decode("utf-8", "replace").strip().split(" ", 1)
        out = out[:marker]
        try:
            status = int(tail[0])
        except (ValueError, IndexError):
            status = 0
        ctype = tail[1] if len(tail) > 1 else ""
    return out, status, ctype


# AI関連の絞り込み（ascii の全社フィードのような火の海を通すため）。
# 見出し＋要約のどちらかに1語でも当たれば通す（緩めにして取りこぼしを防ぐ）。
AI_WORDS = [
    "AI", "ＡＩ", "人工知能", "生成AI", "LLM", "機械学習", "ディープラーニング",
    "ChatGPT", "OpenAI", "Anthropic", "Claude", "Gemini", "Copilot", "Llama",
    "Mistral", "NVIDIA", "エヌビディア", "Hugging Face", "推論", "エージェント",
    "GPU", "データセンター", "プロンプト", "画像生成", "音声認識", "自然言語",
    "Kimi", "DeepSeek", "Grok", "Sora", "MCP", "RAG",
]


def is_ai_related(item):
    hay = (item["title"] + " " + item.get("summary", ""))
    return any(w in hay for w in AI_WORDS)


SELFTEST_SAMPLES = {
    "rss2": b"""<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel>
      <item><title>A</title><link>https://e.com/a</link>
      <description>desc a</description><pubDate>Fri, 24 Jul 2026 17:45:19 +0900</pubDate></item>
      </channel></rss>""",
    "rdf": b"""<?xml version="1.0" encoding="utf-8"?>
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
               xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <item><title>B</title><link>https://e.com/b</link>
      <description>desc b</description><dc:date>2026-07-24T10:00:00+09:00</dc:date></item>
      </rdf:RDF>""",
    "atom": b"""<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>C</title><link rel="alternate" href="https://e.com/c"/>
      <summary>desc c</summary><published>2026-07-24T10:00:00Z</published></entry>
      </feed>""",
    # 日付の無い項目は捨てられること（fail-closed の検査）
    "nodate": b"""<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel>
      <item><title>D</title><link>https://e.com/d</link></item></channel></rss>""",
}


def selftest():
    ok = True
    for kind, expect_n in (("rss2", 1), ("rdf", 1), ("atom", 1), ("nodate", 0)):
        got = parse_feed(SELFTEST_SAMPLES[kind])
        if len(got) != expect_n:
            print(f"  NG {kind}: expected {expect_n} items, got {len(got)}")
            ok = False
            continue
        if expect_n and got[0]["date"] != "2026-07-24":
            print(f"  NG {kind}: date={got[0]['date']} (expected 2026-07-24)")
            ok = False
            continue
        print(f"  OK {kind}: {len(got)} item(s)" +
              (f" date={got[0]['date']} url={got[0]['url']}" if expect_n else " (dropped, as designed)"))
    print("SELFTEST", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--only", default=None, help="フィード名の部分一致で絞る")
    ap.add_argument("--url", default=None)
    ap.add_argument("--name", default="adhoc")
    ap.add_argument("--json", default=None, help="結果をJSONで書き出す")
    ap.add_argument("--ai", action="store_true", help="AI関連語で絞る（ascii等の全社フィード用）")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()

    if a.selftest:
        return selftest()

    feeds = [(a.name, a.url)] if a.url else [
        f for f in FEEDS if not a.only or a.only in f[0]]

    today = dt.datetime.now(JST).date()
    cutoff = today - dt.timedelta(days=a.days)
    all_items, report = [], []

    for name, url in feeds:
        raw, status, ctype = fetch(url)
        # ★ HTTP を先に見る。404のHTMLが「0件」に化けるのを防ぐ（fetch() のコメント参照）
        if status != 200:
            report.append((name, f"HTTP-{status or 'ERR'}", 0, 0))
            continue
        if "html" in ctype.lower():
            report.append((name, f"NOT-XML ({ctype.split(';')[0]})", 0, 0))
            continue
        if not raw:
            report.append((name, "FETCH-EMPTY", 0, 0))
            continue
        try:
            items = parse_feed(raw)
        except Exception as e:
            report.append((name, f"PARSE-FAIL {type(e).__name__}", 0, 0))
            continue
        fresh = [i for i in items
                 if cutoff <= dt.date.fromisoformat(i["date"]) <= today]
        if a.ai:
            fresh = [i for i in fresh if is_ai_related(i)]
        for i in fresh:
            i["feed"] = name
        all_items.extend(fresh)
        # ★ parsed>0 なのに fresh=0 は「生きていて新着なし」、HTTP-404 は「死んでいる」。別物として出す
        report.append((name, "ok", len(items), len(fresh)))

    print(f"=== 巡回結果（直近{a.days}日 / 基準日 {today} JST）===")
    for name, status, total, fresh in report:
        mark = "  " if status == "ok" else "！"
        print(f"{mark}{name:18s} {status:22s} parsed={total:3d} fresh={fresh:3d}")

    all_items.sort(key=lambda x: x["ts"], reverse=True)
    print(f"\n=== 新しい順 {len(all_items)}件 ===")
    for i in all_items:
        print(f"[{i['date']}] ({i['feed']}) {i['title'][:78]}")
        print(f"    {i['url']}")
        if i["summary"]:
            print(f"    要約材料: {i['summary'][:190]}")

    if a.json:
        with open(a.json, "w") as f:
            json.dump(all_items, f, ensure_ascii=False, indent=1)
        print(f"\nwrote {a.json} ({len(all_items)} items)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

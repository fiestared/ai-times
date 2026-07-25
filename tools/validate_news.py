#!/usr/bin/env python3
"""AI TIMES — news.json / soba.json の常設検査（正本）

なぜこのファイルがあるか（2026-07-25 第7便）:
  検査を毎便 tmp_validate_<日付>.py に書き直していたため、
  **前便で直した検査の欠陥が次の便で消えて復活する**状態だった。
  実際この便で、前便の検査に次の2つの欠陥が残っていた（どちらも本ファイルで修正済み）:
    1. errors>0 でも **exit 0** を返していた
       → returncode で判定する呼び出し側からは成功と区別できず、
         壊しテスト8方向が全部「素通し」に見えた
    2. 重複判定のキーに topic id を含めていた
       → **別トピックへ同じ記事を入れると素通し**（紙面に二度出る）

ここに置くのは「その日の中身に依存しない検査」だけ。
個別の逐語照合（今日足した項目に、照合した数値が入っているか等）は
便ごとの使い捨てスクリプトで足す — 混ぜるとこのファイルが腐る。

使い方:
  python3 tools/validate_news.py            # 今日を基準に検査
  python3 tools/validate_news.py 2026-07-25 # 基準日を明示
終了コード: 0=緑 / 1=赤（★必ず returncode で判定できること）
"""
import datetime
import io
import json
import os
import re
import sys

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs")
SPEED = {"model", "tool", "kisei"}   # 鮮度規律の対象（速報面）
JST = datetime.timezone(datetime.timedelta(hours=9))

errors, checks = [], 0


def ck(cond, msg):
    global checks
    checks += 1
    if not cond:
        errors.append(msg)


def main():
    today = (datetime.date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1
             else datetime.datetime.now(JST).date())
    today_s = today.isoformat()

    d = json.load(io.open(os.path.join(BASE, "data/news.json"), encoding="utf-8"))
    s = json.load(io.open(os.path.join(BASE, "data/soba.json"), encoding="utf-8"))
    html = io.open(os.path.join(BASE, "index.html"), encoding="utf-8").read()

    # --- 1. as_of ---
    ck(d.get("as_of") == today_s, "news.as_of が今日でない: %s" % d.get("as_of"))
    ck(d["_meta"].get("as_of") == today_s, "news._meta.as_of が今日でない")
    ck(s["_meta"].get("as_of") == today_s, "soba._meta.as_of が今日でない")
    ck(s["_meta"].get("last_full_check") == today_s, "soba.last_full_check が今日でない")

    # --- 2. lead（null のまま放置しない） ---
    lead = d.get("lead") or {}
    for f in ("title", "dek", "time", "flag", "source_name", "source_url"):
        ck(bool(lead.get(f)), "lead に %s が無い" % f)
    if lead.get("source_url"):
        ck(lead["source_url"].startswith("https://"), "lead の source_url が https でない")
    if re.match(r"^\d{4}-\d{2}-\d{2}$", lead.get("time", "")):
        age = (today - datetime.date.fromisoformat(lead["time"])).days
        ck(0 <= age <= 3, "lead の日付が未来/古い(%d日前)" % age)

    # --- 3. wire（速報ティッカー） ---
    wire = d.get("wire", [])
    ck(len(wire) >= 6, "wire が少ない: %d" % len(wire))
    times = []
    for i, w in enumerate(wire):
        ck(bool(w.get("source_url")),
           "wire[%d] に source_url が無い(見出しがリンクにならない)" % i)
        ck(w.get("source_url", "").startswith("https://"),
           "wire[%d] の source_url が https でない" % i)
        ck(bool(w.get("title")) and bool(w.get("time")), "wire[%d] に title/time が無い" % i)
        if re.match(r"^\d{4}-\d{2}-\d{2}$", w.get("time", "")):
            age = (today - datetime.date.fromisoformat(w["time"])).days
            ck(age <= 14, "wire[%d] が14日より古い(%d日)" % (i, age))
            ck(age >= 0, "wire[%d] が未来日付(%s)" % (i, w["time"]))
            times.append(w["time"])
        else:
            ck(False, "wire[%d] の time が ISO でない" % i)
    ck(times == sorted(times, reverse=True), "wire が新しい順に並んでいない")

    # --- 4. topics の全 item（その日の中身に依存しない構造検査） ---
    #
    # ★常設項目（制度の恒久リンク）の扱い:
    #   文化庁のガイドライン・AI推進法・AI事業者ガイドライン等は「速報」ではなく
    #   参照のために置いてある。これらに30日の鮮度規律を当てると必ず赤になる。
    #   旧検査もこれらを除外していたが、除外の根拠が
    #   「同じURLの別項目がたまたま非ISOの日付を持っていたから」という偶然に依存していた。
    #   ここでは根拠を明示する: **time が純ISOでない項目＝常設** とみなし、
    #   その URL を常設として扱う（日付を書けない＝版が続く制度文書、という意味を持たせる）。
    #   ただし常設でも「日付を明記する」規律は外さない（ISO日付を含むことは要求する）。
    PERMANENT_URLS = {
        "https://www.bunka.go.jp/seisaku/chosakuken/aiandcopyright.html",
        "https://www.ppc.go.jp/news/press/2023/230602kouhou/",
    }
    for t in d["topics"]:
        for it in t["items"]:
            tm = it.get("time") or ""
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", tm):
                PERMANENT_URLS.add(it.get("source_url"))

    seen = {}
    for t in d["topics"]:
        tid = t["id"]
        for it in t["items"]:
            tag = "%s/%s" % (tid, (it.get("title") or "?")[:26])
            for f in ("topic_flag", "source_name", "source_url", "time", "title", "summary"):
                ck(bool(it.get(f)), "%s に %s が無い" % (tag, f))
            url = it.get("source_url", "")
            ck(url.startswith("https://"), "%s の source_url が https でない" % tag)

            # ★キーに tid を入れない（別トピックへの重複を捕まえるため。第7便の壊し⑥）
            key = (url, it.get("title"))
            ck(key not in seen,
               "%s: 同一URL・同一見出しが二重に入っている(既出トピック: %s)" % (tag, seen.get(key)))
            seen[key] = tid

            tm = it.get("time", "")
            permanent = url in PERMANENT_URLS
            if re.match(r"^\d{4}-\d{2}-\d{2}$", tm):
                age = (today - datetime.date.fromisoformat(tm)).days
                ck(age >= 0, "%s が未来日付(%s)" % (tag, tm))
                if tid in SPEED and not permanent:
                    ck(age <= 30, "%s が30日より古い(%d日)＝速報面に置けない" % (tag, age))
            elif permanent:
                # 常設でも日付は必ず書く（新しさが判定できないものは載せない、の最低線）
                ck(re.search(r"\d{4}-\d{2}-\d{2}", tm) is not None,
                   "%s は常設項目だが time にISO日付が含まれない: %r" % (tag, tm))
            else:
                ck(False, "%s の time が ISO(YYYY-MM-DD)でない: %r" % (tag, tm))

    # --- 5. soba: 出すのは verified だけ / 価格は正の数 ---
    for m in s["models"]:
        nm = m.get("name", "?")
        ck(bool(m.get("verified")), "soba: %s が verified でないのに表に載っている" % nm)
        for f in ("input", "output"):
            v = m.get(f)
            ck(isinstance(v, (int, float)) and v > 0, "soba: %s の %s が数値でない/非正" % (nm, f))
        ck(bool(m.get("src")), "soba: %s に出典(src)が無い" % nm)

    # --- 6. JSONが正本・HTMLは生成物: トップに反映されているか ---
    if lead.get("title"):
        ck(lead["title"][:18] in html, "生成された index.html に lead が反映されていない")
    ck(str(len(s["models"])) in html or "相場" in html, "index.html に相場が出ていない")

    print("checks=%d  errors=%d" % (checks, len(errors)))
    for e in errors:
        print("  ✗", e)
    if not errors:
        print("✓ すべて緑")
    # ★returncode で判定できること（第7便の実失敗。exit 0 固定は検査を無意味にする）
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

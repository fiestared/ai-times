#!/usr/bin/env python3
"""soba.json の全モデルの input/output を、各社公式ページ本文と機械照合する（常設・正本）。

なぜ常設にしたか（2026-07-28 第6便）:
  これまで便ごとに `tmp_verify_soba_<日付>.py` を書き直していたため、
  **前便が苦労して突き止めた「偽FAIL の避け方」が翌日消える**状態だった。
  実際 07-28 第2便は偽FAIL 7件の切り分けだけで時間を使っている。
  検査を毎日走らせるなら、検査そのものを毎日書き直してはいけない
  （`tools/validate_news.py` を常設化したのと同じ理由）。

★ここに畳み込んである「偽FAILの避け方」3点（消さないこと）:
  1. **Anthropic と OpenAI の価格ページは JS描画**。HTMLをcurlしても "Loading..." しか出ない。
     **URL末尾に `.md` を付けると素のMarkdownが200で返り、そこに価格表がある。**
     これを知らないと、価格が1円も変わっていないのに毎日7件FAILする。
  2. **タグ除去を素の `<[^>]+>` でやると、行のラベルごと食う**。Moonshotの
     `<DocTable columns={[...]} rows={[ ["kimi-k3", ... <>` は次の `>` が遠いため、
     途中の錨 `"kimi-k3"` が消える → **価格は残るのに錨だけ消え、値は正しいのにFAILに見える**。
     → タグらしい長さ（200字）に制限する。
  3. **金額の一致で `1.5` を `\\b` 終端にすると、ページ表記 `$1.50` に当たらない**。
     小数は末尾ゼロを許す（`$1.5` と `$1.50` は同じ値）。
  ★Googleの価格ページは 2026-07 までに /vertex-ai/ から
    /gemini-enterprise-agent-platform/ へ移設された。**curl に -L が要る**
    （付けないと345バイトのリダイレクト本文だけが返り「取得失敗」に見える）。

使い方:
  python3 tools/verify_soba.py              # 取得して照合（既定）
  python3 tools/verify_soba.py --no-fetch   # 取得済みキャッシュだけで照合
終了コード: 0=全PASS / 1=FAILあり（★必ず returncode で判定できること）
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CACHE = os.path.join(ROOT, "tmp_soba_pages")

# provider キー -> (取得URL, 保存名)
# ★ .md は「素のMarkdownを返させる」ための必須の細工（上のコメント1）
SOURCES = {
    "anthropic": ("https://docs.anthropic.com/en/docs/about-claude/pricing.md", "ant.md"),
    "openai": ("https://platform.openai.com/docs/pricing.md", "oai.md"),
    "google": ("https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing", "goo.html"),
    "moonshot": ("https://platform.kimi.ai/docs/pricing/chat-k3.md", "kimi.md"),
}


def fetch(url, path):
    # 政府/各社サイトに WebFetch は使わない（要約器が嘘を返す）。curl で生取得する。
    subprocess.run(["curl", "-sL", "--max-time", "40", url, "-o", path], check=True)
    return os.path.getsize(path)


def totext(path):
    raw = open(path, "rb").read().decode("utf-8", "replace")
    raw = re.sub(r"<script[\s\S]*?</script>", " ", raw, flags=re.I)
    raw = re.sub(r"<style[\s\S]*?</style>", " ", raw, flags=re.I)
    # ★タグらしい長さに限って除去する（上のコメント2）
    raw = re.sub(r"</?[A-Za-z!/][^>]{0,200}>", " ", raw)
    return re.sub(r"\s+", " ", raw)


def money(v):
    """$5 / $5.00 / 5.0 のどれでも当たる（小数の末尾ゼロを許す。上のコメント3）"""
    s = ("%f" % float(v)).rstrip("0").rstrip(".")
    esc = re.escape(s)
    if "." in s:
        return r"\$?\s*" + esc + r"0*(?![0-9])"
    return r"\$?\s*" + esc + r"(?:\.0+)?(?![0-9.])"


def provider_key(m):
    p = m.get("provider", "").lower()
    for k in SOURCES:
        if k in p:
            return k
    return None


def main():
    do_fetch = "--no-fetch" not in sys.argv
    if not os.path.isdir(CACHE):
        os.makedirs(CACHE)

    pages = {}
    for key, (url, fname) in SOURCES.items():
        path = os.path.join(CACHE, fname)
        if do_fetch:
            try:
                n = fetch(url, path)
            except Exception as e:
                print("FETCH FAIL %-10s %s" % (key, e))
                continue
        elif not os.path.exists(path):
            print("FETCH SKIP %-10s キャッシュ無し" % key)
            continue
        else:
            n = os.path.getsize(path)
        # ★取れなかったものを「価格改定なし」と読まないための最低サイズ検査
        if n < 1500:
            print("FETCH FAIL %-10s %d バイトしか返っていない（JS描画/リダイレクトの疑い）" % (key, n))
            continue
        pages[key] = totext(path)
        print("page %-10s %7d bytes -> %d chars" % (key, n, len(pages[key])))
    print()

    d = json.load(open(os.path.join(ROOT, "docs/data/soba.json")))
    fails = []
    for m in d["models"]:
        name, key = m["name"], provider_key(m)
        t = pages.get(key, "")
        if not t:
            fails.append((name, "出典ページを取得できていない＝照合していない（価格据置の証拠ではない）"))
            print("FAIL  %-22s 出典ページ未取得" % name)
            continue
        # 価格表の行を狙う: モデル名の全出現を試し、最初に両方当たった窓を採用する
        cands = [name, name.replace("Claude ", ""), name.replace("Gemini ", ""),
                 name.lower().replace(" ", "-")]

        # ★★ 期間で分かれた価格行の罠（2026-07-28 第6便で実際に踏んだ）
        #   Anthropic の表は Claude Sonnet 5 を2行に分けている:
        #     「Claude Sonnet 5 through August 31, 2026」  $2 / $10  ← 今日課金される値
        #     「Claude Sonnet 5 starting September 1, 2026」$3 / $15  ← 34日先の値
        #   モデル名だけを錨にすると **未来の行に当たっても PASS する**。
        #   実際 soba.json は $3/$15（未来の値）を「現在の相場」として出しており、
        #   照合器は毎日 PASS を返していた＝**検査が誤りを承認していた**。
        #   → 期間限定の行がある銘柄は `row_hint` で「どの行を見るか」を明示させ、
        #     row_hint が無いまま期間修飾が見つかったら **FAIL で人を呼ぶ**（黙って未来の行を掴まない）。
        hint = m.get("row_hint")
        if not hint:
            for c in cands:
                q = re.search(re.escape(c) + r"[^|\n]{0,40}\b(through|starting|until|effective)\b", t)
                if q:
                    fails.append((name, "価格行が期間で分かれている(%s...)。row_hint でどの行かを指定すること"
                                  % q.group(0)[:70]))
                    print("FAIL  %-22s 価格行が期間で分かれている: %s" % (name, q.group(0)[:70]))
                    break
            else:
                pass
            if fails and fails[-1][0] == name:
                continue

        best, hit = None, False
        for c in cands:
            for mo in re.finditer(re.escape(c), t):
                i = mo.start()
                win = t[max(0, i - 60):i + 380]
                if hint and hint not in win:
                    continue          # 指定された行以外は見ない
                ok_in = re.search(money(m["input"]), win) is not None
                ok_out = re.search(money(m["output"]), win) is not None
                if best is None:
                    best = win
                if ok_in and ok_out:
                    best, hit = win, True
                    break
            if hit:
                break
        if best is None:
            fails.append((name, "ページ内にモデル名が見つからない"))
            print("FAIL  %-22s ページ内にモデル名が見つからない" % name)
        elif hit:
            print("PASS  %-22s in=%s out=%s" % (name, m["input"], m["output"]))
        else:
            fails.append((name, "価格表の周辺に json の値が無い＝価格改定の疑い"))
            print("FAIL  %-22s 期待 in=%s out=%s が周辺に無い" % (name, m["input"], m["output"]))
            print("      窓: %s" % best[:340])

    print("\n%d/%d PASS" % (len(d["models"]) - len(fails), len(d["models"])))
    if fails:
        print("★人が見るもの:")
        for n, why in fails:
            print("  - %s: %s" % (n, why))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())

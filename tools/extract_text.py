# -*- coding: utf-8 -*-
"""記事HTML → 本文テキスト。ニュース便の一次照合で毎回使う。

    curl -s -A "<Chrome UA>" <url> -o /tmp/a.html
    python3 tools/extract_text.py /tmp/a.html

なぜ必要か（実際に踏んだ罠）:
- ITmedia は記事によって Shift_JIS と UTF-8 が混在する。iconv で決め打ちすると
  UTF-8 の記事を逆に壊す → meta charset を先に見てから decode する。
- openai.com など JS チャレンジで 403 を返すサイトは Wayback 経由で取れる:
    curl -s "http://archive.org/wayback/available?url=<url>"
    → archived_snapshots.closest.url を curl -sL
- 一次情報の URL は二次記事の HTML の中にある（extract_links.py で拾う）。
"""
import sys
import re
import html


def extract(path):
    raw = open(path, 'rb').read()
    m = re.search(rb'charset=["\']?([A-Za-z0-9_\-]+)', raw[:4000])
    enc = m.group(1).decode('ascii').lower() if m else 'utf-8'
    if enc in ('shift_jis', 'shift-jis', 'sjis', 'x-sjis'):
        enc = 'cp932'
    try:
        text = raw.decode(enc, errors='replace')
    except LookupError:
        text = raw.decode('utf-8', errors='replace')

    text = re.sub(r'(?is)<(script|style|noscript)[^>]*>.*?</\1>', ' ', text)

    out, seen = [], set()
    for tag, body in re.findall(r'(?is)<(p|h1|h2|h3|li)\b[^>]*>(.*?)</\1>', text):
        s = re.sub(r'(?s)<[^>]+>', '', body)
        s = re.sub(r'\s+', ' ', html.unescape(s)).strip()
        if len(s) < 25 or s in seen:
            continue
        seen.add(s)
        out.append('[' + tag + '] ' + s)
    return out


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('usage: python3 tools/extract_text.py <file.html>')
    print('\n'.join(extract(sys.argv[1])))

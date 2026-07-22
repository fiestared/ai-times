# -*- coding: utf-8 -*-
"""HTML から URL を拾う。二次記事から一次情報(公式リリース)のURLを特定するのに使う。

    python3 tools/extract_links.py /tmp/itmedia.html microsoft.com

実例: ITmedia の Microsoft×Mistral 記事から
news.microsoft.com/source/... の公式リリースURLを特定し、そちらを逐語照合した
(公式URLを推測で組み立てると 404 になる。必ず記事から拾う)。
"""
import sys
import re


def links(path, pat='http', limit=60):
    raw = open(path, 'rb').read().decode('utf-8', errors='replace')
    out = []
    for u in re.findall(r'https?://[^"\'<>\s\\)]+', raw):
        if pat in u and u not in out:
            out.append(u)
    return out[:limit]


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('usage: python3 tools/extract_links.py <file.html> [substring]')
    pat = sys.argv[2] if len(sys.argv) > 2 else 'http'
    print('\n'.join(links(sys.argv[1], pat)))

#!/bin/sh
# Inline the two sprite atlases as data: URIs -> a single self-contained demo.html
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
import base64
s = open('index.html').read()
for n in ('a','b'):
    u = 'data:image/png;base64,' + base64.b64encode(open(f'src-{n}.png','rb').read()).decode()
    s = s.replace(f'src="src-{n}.png"', f'src="{u}"')
open('demo.html','w').write(s)
PY
echo "demo.html  $(du -h demo.html | cut -f1)"

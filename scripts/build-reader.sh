#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f vendor/zotero-reader/package.json ]; then
  git submodule update --init vendor/zotero-reader
fi

# reader has nested submodules (pdfjs/pdf.js, epubjs/epub.js, structured-document-text)
if [ ! -f vendor/zotero-reader/pdfjs/pdf.js/package.json ]; then
  git -C vendor/zotero-reader submodule update --init --depth 1
fi

cd vendor/zotero-reader
NODE_OPTIONS=--openssl-legacy-provider npm install
NODE_OPTIONS=--openssl-legacy-provider npm run build
cd ../..

rm -rf apps/web/public/reader
mkdir -p apps/web/public/reader
cp -R vendor/zotero-reader/build/web/. apps/web/public/reader/

# The upstream web build only defines window.createReader; nothing calls it,
# so a bare reader.html renders blank. Ship our bootstrap next to it and
# inject a deferred <script> tag so it runs after reader.js.
cp scripts/reader-bootstrap.js apps/web/public/reader/bootstrap.js
perl -0pi -e 's{</body>}{<script defer="defer" src="bootstrap.js"></script></body>}' apps/web/public/reader/reader.html
grep -q bootstrap.js apps/web/public/reader/reader.html || { echo "ERROR: bootstrap injection failed"; exit 1; }

echo "--- reader web build copied. HTML entries: ---"
ls apps/web/public/reader/*.html

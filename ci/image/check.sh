#!/usr/bin/env bash
# The image's licences and fonts (spec 001 T038, SC-006, constitution II). Fails, naming each
# problem, if:
#   - an npm package in it is not under a licence on T002's allowlist (ci/licences.ts, run in it);
#   - Chromium's, Node's or any Debian package's licence notice is missing;
#   - any system font but DejaVu is installed (fontconfig needs it, and Chromium loads no web
#     font without one TrueType system font: tasks T037). The PDFs' own fonts, FR-015's, come
#     with their packages, each with its licence file (ci/licences.ts checks those).
# Usage: ci/image/check.sh <image>
set -uo pipefail
image=$1
inside() { docker run --rm --entrypoint sh "$image" -c "$1"; }
status=0

inside 'cd /pdf-export && node ci/licences.ts' || status=1

inside 'ls /ms-playwright/chromium_headless_shell-*/*/LICENSE* >/dev/null 2>&1' \
  || { echo "no Chromium licence notice"; status=1; }
inside 'test -s /pdf-export/notices/node-LICENSE' || { echo "no Node licence notice"; status=1; }
missing=$(inside 'for p in $(dpkg-query -W -f "\${Package}\n"); do [ -f "/usr/share/doc/$p/copyright" ] || echo "$p"; done')
[ -z "$missing" ] || { echo "Debian packages with no copyright notice: $missing"; status=1; }

others=$(inside 'fc-list : family' | grep -v '^DejaVu' || true)
[ -z "$others" ] || { echo "system fonts other than DejaVu:"; echo "$others"; status=1; }

[ "$status" = 0 ] && echo "licences and fonts: ok"
exit "$status"

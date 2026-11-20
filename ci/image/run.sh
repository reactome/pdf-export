#!/usr/bin/env bash
# Runs the release's two steps from the image over the fixture (spec 001 T037): `figures`
# against the render and content stubs, then `book` from the folder it wrote; then `book`
# again with one figure missing, which must fail with exit 1 and leave no book.
# Usage: ci/image/run.sh <image> <bolt address of a graph holding ci/fixture/fixture.cypher>
set -euo pipefail
image=$1
graph=$2
here=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'kill "$stubs" 2>/dev/null || true; rm -rf "$work"' EXIT
chmod 777 "$work"

node "$here/ci/image/stubs.ts" "$work/stubs.json" &
stubs=$!
for _ in $(seq 1 50); do [ -s "$work/stubs.json" ] && break; sleep 0.2; done
render=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).render)' "$work/stubs.json")
content=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).content)' "$work/stubs.json")

run() {
  docker run --rm --network host --user "$(id -u):$(id -g)" -e NEO4J_URI="$graph" \
    -v "$here/ci/fixture/files:/files:ro" -v "$work:/work" "$image" "$@"
}

run figures --files /files --render "$render" --content "$content" \
  --out /work/figures --report /work/figures.json
run book --files /files --figures /work/figures --site https://site.example \
  --out /work/book --report /work/book.json
books=$(find "$work/book" -name '*.pdf' | wc -l)
echo "book: $books PDF(s)"
[ "$books" -gt 0 ]
run check-book /work/book --files /files

# A planted fault: one figure gone from the folder.
cp -r "$work/figures" "$work/figures-short"
gone=$(find "$work/figures-short" -name '*.svg' | sort | head -1)
rm "$gone"
set +e
run book --files /files --figures /work/figures-short --site https://site.example \
  --out /work/book-short --report /work/book-short.json
code=$?
set -e
left=$( (find "$work/book-short" -name '*.pdf' 2>/dev/null || true) | wc -l)
echo "with $(basename "$gone") missing: exit $code, $left PDF(s)"
[ "$code" = 1 ] && [ "$left" = 0 ]

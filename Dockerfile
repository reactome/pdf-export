# pdf-export's image for the release (spec 001 T037): the `figures` and `book` steps, and any
# other command of contracts/cli.md. Node 24 on a slim base, Playwright's Chromium headless
# shell, and no fonts but FR-015's, which come with the packages (@fontsource) rather than
# the system. It runs as a user with no rights in it, and its entry point is `pdf-export`.

# The packages, built where git is (the theme package is a GitHub dependency). The
# development packages stay: the theme is compiled from the theme package with sass when a
# PDF is laid out (src/layout/theme.ts).
FROM node:24 AS packages
WORKDIR /pdf-export
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY . .

FROM node:24-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /pdf-export
COPY --from=packages /pdf-export /pdf-export

# Chromium's headless shell and the libraries it needs, by the playwright-core the lockfile
# pins, as CI installs them. Its dependencies bring system fonts, and every package that ships
# one goes but fonts-dejavu-core, which fontconfig itself depends on: Chromium loads no web
# font, @fontsource's included, without one TrueType system font (measured here: with none,
# or with only a Roboto woff2 there, every @font-face fails). The pages name only FR-015's
# faces, and a character none of them draws is the preflight's to find (FR-017), so DejaVu is
# never drawn. The build fails if any other system font is left.
RUN set -eu; \
    npx playwright-core install --with-deps --only-shell chromium; \
    fonts=$(find /usr/share/fonts -type f -exec dpkg-query -S {} + 2>/dev/null | cut -d: -f1 | tr ',' '\n' | tr -d ' ' | grep -vx fonts-dejavu-core | sort -u); \
    if [ -n "$fonts" ]; then apt-get purge -y --auto-remove $fonts; fi; \
    if fc-list : family | grep -v '^DejaVu' | grep -q .; then echo "system fonts left:" >&2; fc-list >&2; exit 1; fi; \
    rm -rf /var/lib/apt/lists/* /root/.npm; \
    printf '#!/bin/sh\nexec node /pdf-export/src/cli.ts "$@"\n' > /usr/local/bin/pdf-export; \
    chmod 755 /usr/local/bin/pdf-export

# Chromium wants a home it can write; the user has none here.
ENV HOME=/tmp
USER node
ENTRYPOINT ["pdf-export"]
CMD ["--help"]

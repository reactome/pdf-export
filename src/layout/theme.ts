// The website's theme as the PDFs use it (spec 001 T017, FR-015, research R5): its light
// theme's --mat-sys-* variables, compiled from the theme package. Run as a script, it
// writes them to dist/theme.css, as the build does.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as sass from 'sass';

const ROOT = new URL('../../', import.meta.url);

/** The folder packages are installed in, wherever the install put them. */
const MODULES = dirname(
  dirname(fileURLToPath(import.meta.resolve('ngx-reactome-style/package.json')))
);

/** The theme package's light theme, compiled: each --mat-sys-* variable and its value. */
export function themeVariables(): Map<string, string> {
  const css = sass.compile(fileURLToPath(new URL('theme/pdf-theme.scss', ROOT)), {
    loadPaths: [MODULES],
    quietDeps: true,
    style: 'expanded',
  }).css;
  // the light theme is .pdf-light's one block, at the top level (theme/pdf-theme.scss)
  const blocks = [...css.matchAll(/^\.pdf-light \{([^}]*)\}/gm)];
  if (blocks.length !== 1) {
    throw new Error(`The theme compiled to ${String(blocks.length)} .pdf-light blocks, not one`);
  }
  const variables = new Map<string, string>();
  for (const [, name = '', value = ''] of (blocks[0]?.[1] ?? '').matchAll(
    /(--mat-sys-[\w-]+)\s*:\s*([^;]+);/g
  )) {
    variables.set(name, value.trim());
  }
  if (variables.size === 0) throw new Error('The theme compiled to no --mat-sys-* variables');
  return variables;
}

/** The variables as a stylesheet for the PDFs' pages. */
export function themeCss(variables: ReadonlyMap<string, string> = themeVariables()): string {
  const lines = [...variables].map(([name, value]) => `  ${name}: ${value};`);
  return `/* From the website's theme package (theme/pdf-theme.scss); do not edit. */\n:root {\n${lines.join('\n')}\n}\n`;
}

if (import.meta.main) {
  const out = new URL('dist/', ROOT);
  mkdirSync(out, { recursive: true });
  writeFileSync(new URL('theme.css', out), themeCss());
}

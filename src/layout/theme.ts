// The website's theme as the PDFs use it (spec 001 T017, FR-015, research R5): its light
// theme's --mat-sys-* variables, compiled from the theme package. Run as a script, it
// writes them to dist/theme.css, as the build does.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as sass from 'sass';

const ROOT = new URL('../../', import.meta.url);

/** The theme package's light theme, compiled: each --mat-sys-* variable and its value. */
export function themeVariables(): Map<string, string> {
  const css = sass.compile(fileURLToPath(new URL('theme/pdf-theme.scss', ROOT)), {
    loadPaths: [fileURLToPath(new URL('node_modules', ROOT))],
    quietDeps: true,
    style: 'expanded',
  }).css;
  const variables = new Map<string, string>();
  // only the blocks for :root alone: the light theme (the dark one is under another selector)
  for (const block of css.matchAll(/(?:^|\})\s*:root\s*\{([^}]*)\}/g)) {
    for (const [, name = '', value = ''] of (block[1] ?? '').matchAll(
      /(--mat-sys-[\w-]+)\s*:\s*([^;]+);/g
    )) {
      variables.set(name, value.trim());
    }
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

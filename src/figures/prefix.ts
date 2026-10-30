// Ids made unique per figure (spec 001 T014, research R3): every figure the website draws
// uses the same ids (clip-1, an illustration's clip0_…), so two inlined in one page would
// draw with each other's clip paths and gradients. Each id, and every reference to one
// (url(#…) and a local href="#…"), is prefixed with the section's anchor. Links that are
// not to a local id (data: images, web addresses) are left as they are.

export function prefixIds(svg: string, prefix: string): string {
  const p = `${prefix}-`;
  return svg
    .replace(/(\sid=")([^"]+)"/g, (_m, attr: string, id: string) => `${attr}${p}${id}"`)
    .replace(
      /url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g,
      (_m, quote: string, id: string) => `url(${quote}#${p}${id}${quote})`
    )
    .replace(
      /(\s(?:xlink:)?href=")#([^"]+)"/g,
      (_m, attr: string, id: string) => `${attr}#${p}${id}"`
    );
}

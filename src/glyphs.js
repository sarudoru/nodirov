// Glyph vocabulary of the field.
// Every alphabet here is deliberate: ambient cells murmur in lowercase,
// transitions scramble in unambiguous uppercase, and each letter owns a
// small family of typographic "cousins" for shimmer effects.

export const AMBIENT = "0123456789abcdefghijklmnopqrstuvwxyz";

// Ink-density ramp for condensation/dissolution. Transitions climb or
// descend this ramp — matter forming, never static.
export const RAMP = ["·", ":", "+"];

const COUSIN_FAMILIES = [
  "aàáâäāă", "cçćč", "dďđ", "eèéêëē", "gğġ", "iìíîï", "lĺľł",
  "nñńň", "oòóôöø", "rŕř", "sśšş", "tťţ", "uùúûü", "yýÿ", "zźžż",
  "AÀÁÂÄ", "CÇĆČ", "DĎĐ", "EÈÉÊË", "IÌÍÎÏ", "NÑŃŇ", "OÒÓÔÖØ",
  "RŔŘ", "SŚŠŞ", "UÙÚÛÜ", "VṼ", "ZŹŽŻ",
];

const COUSINS = new Map();
for (const family of COUSIN_FAMILIES) {
  const chars = Array.from(family);
  for (const ch of chars) COUSINS.set(ch, chars);
}

export function cousinsFor(ch) {
  return COUSINS.get(ch) ?? null;
}

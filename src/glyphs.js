// Glyph vocabulary of the field.
//
// Every letter owns a family of typographic siblings — the same letter as
// other languages write it. Shimmering through a family keeps a word
// readable while making it visibly alive. Families are restricted to
// Latin-1 + Latin Extended-A/B ranges that IBM Plex Mono actually covers;
// letters with no safe siblings stay inert, which is its own kind of charm.

export const AMBIENT = "0123456789abcdefghijklmnopqrstuvwxyz";

// Ink-density ramp for condensation/dissolution.
export const RAMP = ["·", ":", "+"];

// Water for ripples.
export const WAVE = ["~", "≈"];

const COUSIN_FAMILIES = [
  "aàáâãäåāăą", "cçćĉċč", "dďđ", "eèéêëēĕėęě", "gĝğġģ", "hĥħ",
  "iìíîïĩīĭįı", "jĵ", "kķ", "lĺļľŀł", "nñńņňŋ", "oòóôõöøōŏő",
  "rŕŗř", "sśŝşšș", "tţťŧț", "uùúûüũūŭůűų", "wŵ", "yýÿŷ", "zźżž",
  "AÀÁÂÃÄÅĀĂĄ", "CÇĆĈĊČ", "DĎĐ", "EÈÉÊËĒĔĖĘĚ", "GĜĞĠĢ", "HĤĦ",
  "IÌÍÎÏĨĪĬĮİ", "JĴ", "KĶ", "LĹĻĽĿŁ", "NÑŃŅŇŊ", "OÒÓÔÕÖØŌŎŐ",
  "RŔŖŘ", "SŚŜŞŠȘ", "TŢŤŦȚ", "UÙÚÛÜŨŪŬŮŰŲ", "WŴ", "YÝŶŸ", "ZŹŻŽ",
];

const COUSINS = new Map();
for (const family of COUSIN_FAMILIES) {
  const chars = Array.from(family);
  for (const ch of chars) COUSINS.set(ch, chars);
}

export function cousinsFor(ch) {
  return COUSINS.get(ch) ?? null;
}

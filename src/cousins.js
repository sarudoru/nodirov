// A letter's cousins: the same letter as other languages write it. A hovered
// word turns through them and stays the same readable word. Only characters
// Geist Mono draws are listed; a letter with no cousins stays as it is.

const FAMILIES = [
  "aàáâãäåāăą", "cçćĉċč", "dďđ", "eèéêëēĕėęě", "gĝğġģ", "hĥħ",
  "iìíîïĩīĭįı", "jĵ", "kķ", "lĺļľł", "nñńņňŋ", "oòóôõöøōŏő",
  "rŕŗř", "sśŝşšș", "tţťŧț", "uùúûüũūŭůűų", "wŵ", "yýÿŷ", "zźżž",
  "AÀÁÂÃÄÅĀĂĄ", "CÇĆĈĊČ", "DĎĐ", "EÈÉÊËĒĔĖĘĚ", "GĜĞĠĢ", "HĤĦ",
  "IÌÍÎÏĨĪĬĮİ", "JĴ", "KĶ", "LĹĻĽŁ", "NÑŃŅŇŊ", "OÒÓÔÕÖØŌŎŐ",
  "RŔŖŘ", "SŚŜŞŠȘ", "TŢŤŦȚ", "UÙÚÛÜŨŪŬŮŰŲ", "WŴ", "YÝŶŸ", "ZŹŻŽ",
];

const COUSINS = new Map(FAMILIES.map((family) => [family[0], Array.from(family)]));

export function cousinsFor(ch) {
  return COUSINS.get(ch) ?? null;
}

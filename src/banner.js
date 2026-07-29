// Five-row display letters for the hero. Each letter is drawn out of its own
// lowercase character — an S made of s's — so even the largest type on the
// page is visibly built from the same substrate as everything else.

const LETTERS = {
  S: ["#####", "#    ", "#####", "    #", "#####"],
  A: [" ### ", "#   #", "#####", "#   #", "#   #"],
  R: ["#### ", "#   #", "#### ", "#  # ", "#   #"],
  D: ["#### ", "#   #", "#   #", "#   #", "#### "],
  O: ["#####", "#   #", "#   #", "#   #", "#####"],
  N: ["#   #", "##  #", "# # #", "#  ##", "#   #"],
  I: ["#####", "  #  ", "  #  ", "  #  ", "#####"],
  V: ["#   #", "#   #", "#   #", " # # ", "  #  "],
  E: ["#####", "#    ", "#### ", "#    ", "#####"],
  T: ["#####", "  #  ", "  #  ", "  #  ", "  #  "],
  H: ["#   #", "#   #", "#####", "#   #", "#   #"],
  L: ["#    ", "#    ", "#    ", "#    ", "#####"],
  M: ["#   #", "## ##", "# # #", "#   #", "#   #"],
  U: ["#   #", "#   #", "#   #", "#   #", "#####"],
};

export const BANNER_ROWS = 5;

// Returns an array of BANNER_ROWS strings, or null if a letter is missing.
export function renderBanner(word) {
  const rows = ["", "", "", "", ""];
  for (const raw of word) {
    const letter = LETTERS[raw.toUpperCase()];
    if (!letter) return null;
    const fill = raw.toLowerCase();
    for (let r = 0; r < BANNER_ROWS; r += 1) {
      rows[r] += (rows[r] ? " " : "") + letter[r].replaceAll("#", fill);
    }
  }
  return rows;
}

export function bannerWidth(word) {
  return word.length * 6 - 1;
}

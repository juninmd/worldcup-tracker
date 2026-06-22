import type { LineupPlayer } from "./types.ts";

// Key players per team: star whose absence from the confirmed starting XI
// meaningfully hurts that team. weight is on the PLAYER_QUALITY scale
// (world-class ≈ 8-10, regular starter ≈ 3-5).
// variants are lowercase substrings matched against the SportsDB player name.
export const KEY_PLAYERS: Record<string, { name: string; variants: string[]; weight: number }[]> = {
  France:      [{ name: "Mbappé",      variants: ["mbappe", "mbappé", "kylian"],          weight: 10 },
                { name: "Camavinga",   variants: ["camavinga"],                            weight:  4 },
                { name: "Tchouaméni", variants: ["tchouam"],                              weight:  4 }],
  England:     [{ name: "Bellingham",  variants: ["bellingham"],                          weight:  8 },
                { name: "Saka",        variants: ["saka"],                                weight:  5 },
                { name: "Palmer",      variants: ["palmer"],                              weight:  5 }],
  Brazil:      [{ name: "Vinicius Jr", variants: ["vini", "vinícius", "vinicius"],        weight:  8 },
                { name: "Rodrygo",     variants: ["rodrygo"],                             weight:  4 },
                { name: "Endrick",     variants: ["endrick"],                             weight:  3 }],
  Argentina:   [{ name: "Messi",       variants: ["messi"],                               weight:  8 },
                { name: "J. Álvarez",  variants: ["alvarez", "álvarez"],                  weight:  6 },
                { name: "E. Fernández",variants: ["enzo fernandez", "enzo fernández"],    weight:  5 },
                { name: "Mac Allister",variants: ["mac allister", "macallister"],         weight:  4 }],
  Spain:       [{ name: "Yamal",       variants: ["yamal"],                               weight:  8 },
                { name: "Pedri",       variants: ["pedri"],                               weight:  6 },
                { name: "Gavi",        variants: ["gavi"],                                weight:  5 }],
  Portugal:    [{ name: "Ronaldo",     variants: ["ronaldo"],                             weight:  7 },
                { name: "B. Félix",    variants: ["felix", "félix"],                      weight:  5 },
                { name: "R. Leão",     variants: ["leao", "leão"],                        weight:  5 }],
  Germany:     [{ name: "Musiala",     variants: ["musiala"],                             weight:  7 },
                { name: "Wirtz",       variants: ["wirtz"],                               weight:  7 }],
  Netherlands: [{ name: "Gakpo",       variants: ["gakpo"],                               weight:  5 },
                { name: "F. De Jong",  variants: ["de jong"],                             weight:  5 }],
  Morocco:     [{ name: "Hakimi",      variants: ["hakimi"],                              weight:  6 },
                { name: "En-Nesyri",   variants: ["en-nesyri", "nesyri"],                 weight:  5 }],
  USA:         [{ name: "Pulisic",     variants: ["pulisic"],                             weight:  7 },
                { name: "Reyna",       variants: ["reyna"],                               weight:  4 }],
  Mexico:      [{ name: "Lozano",      variants: ["lozano"],                              weight:  5 },
                { name: "R. Jiménez",  variants: ["jimenez", "jiménez"],                  weight:  5 }],
  Colombia:    [{ name: "L. Díaz",     variants: ["luis díaz", "luis diaz"],              weight:  7 },
                { name: "Cuadrado",    variants: ["cuadrado"],                            weight:  4 }],
  Uruguay:     [{ name: "D. Núñez",    variants: ["darwin", "nuñez", "núñez"],            weight:  7 },
                { name: "Valverde",    variants: ["valverde"],                            weight:  6 }],
  Japan:       [{ name: "Kubo",        variants: ["kubo"],                                weight:  6 },
                { name: "Mitoma",      variants: ["mitoma"],                              weight:  5 }],
  Senegal:     [{ name: "S. Mané",     variants: ["mane", "mané"],                        weight:  7 },
                { name: "Koulibaly",   variants: ["koulibaly"],                           weight:  5 }],
  Croatia:     [{ name: "Modrić",      variants: ["modric", "modrić"],                    weight:  7 },
                { name: "Kovačić",     variants: ["kovacic", "kovačić"],                  weight:  5 }],
  Norway:      [{ name: "Haaland",     variants: ["haaland"],                             weight: 10 }],
  "Korea Republic": [{ name: "Son",    variants: ["son heung"],                           weight:  8 }],
  Canada:      [{ name: "Davies",      variants: ["davies", "alphonso"],                  weight:  8 },
                { name: "David",       variants: ["jonathan david"],                      weight:  6 }],
};

/** Key players absent from the confirmed starting XI (lineup API response).
 *  Returns [] when lineup has no starters yet (not confirmed). */
export function missingKeyPlayers(
  xi: LineupPlayer[],
  team: string,
  isHome: boolean,
): { name: string; weight: number }[] {
  const keys = KEY_PLAYERS[team];
  if (!keys) return [];

  const starters = xi
    .filter(p => p.strHome === (isHome ? "Yes" : "No") && p.strSubstitute === "No")
    .map(p => p.strPlayer.toLowerCase());

  if (!starters.length) return []; // lineup not confirmed yet

  return keys
    .filter(kp => !starters.some(s => kp.variants.some(v => s.includes(v))))
    .map(kp => ({ name: kp.name, weight: kp.weight }));
}

/** Total quality reduction from confirmed lineup absences. */
export function lineupPenalty(xi: LineupPlayer[], team: string, isHome: boolean): number {
  return missingKeyPlayers(xi, team, isHome).reduce((sum, p) => sum + p.weight, 0);
}

import type { Player } from "./types.ts";
import { NEXT_WORLD_CUP } from "./format.ts";
import { allSquadPlayers } from "./sportsdb.ts";
import { sendMessage } from "./telegram.ts";

/** FIFA World Cup 2030: main tournament in Spain/Portugal/Morocco, opened by three
 *  centenary matches in South America (Uruguay, Argentina, Paraguay). The opener at
 *  the Estádio Centenário — shared with the post-tournament countdown in format.ts —
 *  is the reference date for the whole cycle. */
export const WC2030 = {
  label: NEXT_WORLD_CUP.label,
  openerUtc: NEXT_WORLD_CUP.firstMatchUtc,
  openerDate: NEXT_WORLD_CUP.firstMatchUtc.slice(0, 10),
  teams: 48,
  hosts: "Espanha 🇪🇸 · Portugal 🇵🇹 · Marrocos 🇲🇦",
  centenary: "Uruguai 🇺🇾 (Centenário, Montevidéu) · Argentina 🇦🇷 · Paraguai 🇵🇾",
} as const;

export interface Milestone {
  /** YYYY-MM-DD — for `confirmed: false` entries this is the month's first day. */
  date: string;
  label: string;
  /** false = date still projected from the 2026 cycle's calendar, not announced by FIFA. */
  confirmed: boolean;
}

// Only the 2030 hosting decision and the centenary opener are official; every other
// date is extrapolated from the equivalent step of the 2026 cycle and is flagged as
// such so the bot never presents a projection as an announcement.
const MILESTONES: Milestone[] = [
  { date: "2027-09-01", label: "Eliminatórias CONMEBOL começam", confirmed: false },
  { date: "2028-06-01", label: "Copa América 2028", confirmed: false },
  { date: "2029-03-01", label: "Eliminatórias UEFA/CAF começam", confirmed: false },
  { date: "2029-12-01", label: "Sorteio dos grupos", confirmed: false },
  { date: WC2030.openerDate, label: "Abertura: jogo do centenário em Montevidéu", confirmed: true },
];

const DAY_MS = 86_400_000;

export interface MilestoneAhead extends Milestone {
  days: number;
}

/** Cycle milestones still ahead of `from`, nearest first. */
export function roadTo2030(from = new Date()): MilestoneAhead[] {
  return MILESTONES
    .map((m) => ({ ...m, days: Math.ceil((Date.parse(`${m.date}T00:00:00Z`) - from.getTime()) / DAY_MS) }))
    .filter((m) => m.days >= 0)
    .sort((a, b) => a.days - b.days);
}

export interface AgedPlayer {
  name: string;
  position: string | null;
  age: number;
}

export interface SquadHorizon {
  team: string;
  atDate: string;
  /** Squad members with a known birth date — the only ones that can be projected. */
  sized: number;
  avgAge: number;
  prospects: AgedPlayer[]; // ≤ 23 in 2030
  core: AgedPlayer[]; // 24–31: the peak-age window
  late: AgedPlayer[]; // 32–33
  fading: AgedPlayer[]; // ≥ 34
}

/** Whole years completed at `at`, or null when the feed has no birth date. */
function ageAt(dateBorn: string | null, at: Date): number | null {
  if (!dateBorn) return null;
  const born = Date.parse(`${dateBorn.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(born)) return null;
  const b = new Date(born);
  let age = at.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday = at.getUTCMonth() < b.getUTCMonth()
    || (at.getUTCMonth() === b.getUTCMonth() && at.getUTCDate() < b.getUTCDate());
  return beforeBirthday ? age - 1 : age;
}

/** How a 2026 squad ages into the next World Cup: who lands in the peak window and
 *  who ages out of it by the opening match. */
export function squadHorizon(players: Player[], team: string, at = new Date(WC2030.openerUtc)): SquadHorizon {
  const aged = players
    .map((p) => ({ name: p.strPlayer, position: p.strPosition, age: ageAt(p.dateBorn, at) }))
    .filter((p): p is AgedPlayer => p.age !== null)
    .sort((a, b) => a.age - b.age || a.name.localeCompare(b.name));
  const avg = aged.length ? aged.reduce((s, p) => s + p.age, 0) / aged.length : 0;
  return {
    team,
    atDate: at.toISOString().slice(0, 10),
    sized: aged.length,
    avgAge: Math.round(avg * 10) / 10,
    prospects: aged.filter((p) => p.age <= 23),
    core: aged.filter((p) => p.age >= 24 && p.age <= 31),
    late: aged.filter((p) => p.age >= 32 && p.age <= 33),
    fading: aged.filter((p) => p.age >= 34),
  };
}

export async function brazilHorizon(at?: Date): Promise<SquadHorizon> {
  const players = await allSquadPlayers();
  const squad = players.filter((p) => p.strTeam === "Brazil" || p.strTeam === "Brasil");
  return squadHorizon(squad, "Brasil", at);
}

const nameList = (players: AgedPlayer[], limit = 8): string =>
  players.slice(0, limit).map((p) => `${p.name} (${p.age})`).join(", ")
  + (players.length > limit ? ` +${players.length - limit}` : "");

export function fmtCycle2030(road: MilestoneAhead[], horizon: SquadHorizon | null, from = new Date()): string {
  const days = Math.max(0, Math.ceil((Date.parse(WC2030.openerUtc) - from.getTime()) / DAY_MS));
  const lines = [
    `🗓️ *CICLO 2030* — ${WC2030.label}`,
    `⏳ *${days.toLocaleString("pt-BR")} dias* até a abertura (08/06/2030)`,
    `🏟️ Sede: ${WC2030.hosts}`,
    `💯 Centenário: ${WC2030.centenary}`,
    `👥 ${WC2030.teams} seleções`,
  ];
  if (road.length) {
    lines.push(``, `*Marcos do ciclo:*`);
    for (const m of road) {
      const when = m.confirmed ? m.date.split("-").reverse().join("/") : `${m.date.slice(0, 7).split("-").reverse().join("/")} _(previsto)_`;
      lines.push(`• ${when} — ${m.label} _(faltam ${m.days.toLocaleString("pt-BR")}d)_`);
    }
  }
  if (horizon?.sized) {
    lines.push(
      ``,
      `🇧🇷 *O elenco de 2026 em junho de 2030* (${horizon.sized} ${horizon.sized === 1 ? "jogador" : "jogadores"}, média ${horizon.avgAge.toLocaleString("pt-BR")} anos)`,
      `🟢 No auge (24–31): ${horizon.core.length} — ${nameList(horizon.core)}`,
    );
    if (horizon.prospects.length) lines.push(`🌱 Ainda jovens (≤23): ${horizon.prospects.length} — ${nameList(horizon.prospects)}`);
    if (horizon.late.length) lines.push(`🟡 Última chance (32–33): ${horizon.late.length} — ${nameList(horizon.late)}`);
    if (horizon.fading.length) lines.push(`🔴 Fim de ciclo (≥34): ${horizon.fading.length} — ${nameList(horizon.fading)}`);
  }
  return lines.join("\n");
}

export async function cycle2030(from = new Date()): Promise<string> {
  // Imported lazily: cycle.ts depends on this module for the opener date, so a
  // top-level import would close the loop.
  const { cycleSnapshot, fmtCycleStandings } = await import("./cycle.ts");
  const [horizon, standings] = await Promise.all([
    brazilHorizon().catch(() => null),
    cycleSnapshot().then(fmtCycleStandings).catch(() => null),
  ]);
  return [fmtCycle2030(roadTo2030(from), horizon, from), standings].filter(Boolean).join("\n\n");
}

export async function postCycle2030(): Promise<void> {
  await sendMessage(await cycle2030());
}

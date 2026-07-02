import type { Player } from "./types.ts";
import { allSquadPlayers } from "./sportsdb.ts";
import { flag } from "./format.ts";
import { sendMessage } from "./telegram.ts";

function age(dateBorn: string | null): number | null {
  if (!dateBorn) return null;
  const born = new Date(dateBorn);
  if (isNaN(born.getTime())) return null;
  return Math.floor((Date.now() - born.getTime()) / (365.25 * 86_400_000));
}

function heightCm(desc: string | null): number | null {
  const m = desc?.match(/Altura:\s*(\d+)cm/);
  return m ? Number(m[1]) : null;
}

export interface TriviaReport {
  youngest: { player: Player; age: number } | null;
  oldest: { player: Player; age: number } | null;
  tallest: { player: Player; cm: number } | null;
  shortest: { player: Player; cm: number } | null;
  squadSize: number;
}

/** Tournament-wide curiosities derived from official FIFA squad bios. */
export async function trivia(): Promise<TriviaReport> {
  const players = await allSquadPlayers();
  let youngest: TriviaReport["youngest"] = null;
  let oldest: TriviaReport["oldest"] = null;
  let tallest: TriviaReport["tallest"] = null;
  let shortest: TriviaReport["shortest"] = null;

  for (const p of players) {
    const a = age(p.dateBorn);
    if (a !== null) {
      if (!youngest || a < youngest.age) youngest = { player: p, age: a };
      if (!oldest || a > oldest.age) oldest = { player: p, age: a };
    }
    const cm = heightCm(p.strDescriptionEN);
    if (cm !== null) {
      if (!tallest || cm > tallest.cm) tallest = { player: p, cm };
      if (!shortest || cm < shortest.cm) shortest = { player: p, cm };
    }
  }
  return { youngest, oldest, tallest, shortest, squadSize: players.length };
}

export function fmtTrivia(r: TriviaReport): string {
  const line = (label: string, name: string | undefined, team: string | undefined, value: string) =>
    name ? `${label} *${name}* (${flag(team ?? "")} ${team}) — ${value}` : null;
  const lines = [
    line("🐣 Mais jovem:", r.youngest?.player.strPlayer, r.youngest?.player.strTeam ?? undefined, `${r.youngest?.age} anos`),
    line("🧓 Mais velho:", r.oldest?.player.strPlayer, r.oldest?.player.strTeam ?? undefined, `${r.oldest?.age} anos`),
    line("📏 Mais alto:", r.tallest?.player.strPlayer, r.tallest?.player.strTeam ?? undefined, `${r.tallest?.cm}cm`),
    line("📐 Mais baixo:", r.shortest?.player.strPlayer, r.shortest?.player.strTeam ?? undefined, `${r.shortest?.cm}cm`),
  ].filter((x): x is string => !!x);
  if (!lines.length) return "🔎 *CURIOSIDADES* — _dados de elenco indisponíveis._";
  return [`🔎 *CURIOSIDADES — Copa do Mundo 2026*`, `_${r.squadSize} jogadores inscritos_`, ``, ...lines].join("\n");
}

export async function postTrivia(): Promise<TriviaReport> {
  const r = await trivia();
  await sendMessage(fmtTrivia(r));
  return r;
}

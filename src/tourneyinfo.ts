import { tournamentInfo } from "./sportsdb.ts";
import { sendMediaGroup, sendMessage } from "./telegram.ts";

function fmtDate(iso: string | null): string {
  if (!iso) return "?";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "long", year: "numeric" });
}

export function fmtTournamentInfo(info: Awaited<ReturnType<typeof tournamentInfo>>): string {
  const today = new Date();
  const end = info.endDate ? new Date(info.endDate) : null;
  const daysLeft = end ? Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86_400_000)) : null;
  return [
    `🏆 *${info.name}*`,
    ``,
    `📅 ${fmtDate(info.startDate)} — ${fmtDate(info.endDate)}`,
    daysLeft !== null ? `⏳ ${daysLeft} dia${daysLeft !== 1 ? "s" : ""} até a final` : "",
  ].filter(Boolean).join("\n");
}

/** Official tournament artwork (poster + mascot + match ball) and countdown to the final. */
export async function postTournamentInfo(): Promise<void> {
  const info = await tournamentInfo();
  const art = [info.posterUrl, info.mascotUrl, info.matchBallUrl].filter((x): x is string => !!x);
  if (art.length) await sendMediaGroup(art, fmtTournamentInfo(info));
  else await sendMessage(fmtTournamentInfo(info));
}

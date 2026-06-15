import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const FILE = new URL("../data/state.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

interface State {
  postedGoals: string[]; // `${idEvent}:${minute}:${player}`
  prematchPosted: string[]; // idEvent
  fulltimePosted: string[]; // idEvent
}

const empty: State = { postedGoals: [], prematchPosted: [], fulltimePosted: [] };

export async function loadState(): Promise<State> {
  if (!existsSync(FILE)) return { ...empty };
  try {
    return { ...empty, ...JSON.parse(await readFile(FILE, "utf8")) };
  } catch {
    return { ...empty };
  }
}

export async function saveState(s: State): Promise<void> {
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(s, null, 2));
}

export const goalKey = (idEvent: string, minute: string, player: string | null) =>
  `${idEvent}:${minute}:${player ?? "?"}`;

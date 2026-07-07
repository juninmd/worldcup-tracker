import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const FILE = new URL("../data/state.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

interface State {
  postedGoals: string[]; // `${idEvent}:${side}:${ordinal}`
  prematchPosted: string[]; // idEvent
  fulltimePosted: string[]; // idEvent
  postedSubs: string[]; // `${idEvent}:${minute}:${playerIn}`
  postedVar: string[]; // `${idEvent}:${minute}`
  postedUpcomingAlert: string[]; // idEvent — "starts in ~30min" heads-up
  postedCards: string[]; // `${idEvent}:${idTimeline|minute:player:cardType}`
  postedAnalysis: string[]; // idEvent — zebra-triggered post-match AI analysis
}

const empty: State = {
  postedGoals: [], prematchPosted: [], fulltimePosted: [], postedSubs: [], postedVar: [], postedUpcomingAlert: [],
  postedCards: [], postedAnalysis: [],
};

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

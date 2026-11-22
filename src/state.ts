import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { dataPath } from "./paths.ts";

const FILE = dataPath("state.json");

export interface State {
  postedGoals: string[]; // `${idEvent}:${side}:${ordinal}`
  prematchPosted: string[]; // idEvent
  fulltimePosted: string[]; // idEvent
  postedSubs: string[]; // `${idEvent}:${minute}:${playerIn}`
  postedVar: string[]; // `${idEvent}:${minute}`
  postedUpcomingAlert: string[]; // idEvent — "starts in ~30min" heads-up
  postedCards: string[]; // `${idEvent}:${idTimeline|minute:player:cardType}`
  postedAnalysis: string[]; // idEvent — zebra-triggered post-match AI analysis
  activeSubsystemIncidents?: string[]; // subsystems with active >= 5 consecutive error incidents
}

// Factory, not a shared object: callers push into these arrays, which would leak into later loads.
const empty = (): State => ({
  postedGoals: [], prematchPosted: [], fulltimePosted: [], postedSubs: [], postedVar: [], postedUpcomingAlert: [],
  postedCards: [], postedAnalysis: [], activeSubsystemIncidents: [],
});

export async function loadState(file = FILE): Promise<State> {
  if (!existsSync(file)) return empty();
  try {
    return { ...empty(), ...JSON.parse(await readFile(file, "utf8")) };
  } catch (err) {
    // An unreadable state means every dedup list resets and past alerts re-post; keep the evidence.
    console.error(`state: ${file} unreadable (${(err as Error).message}); starting empty`);
    await rename(file, `${file}.corrupt`).catch(() => {});
    return empty();
  }
}

// Write-then-rename: a crash mid-write must never leave a truncated state.json behind.
export async function saveState(s: State, file = FILE): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2));
  await rename(tmp, file);
}

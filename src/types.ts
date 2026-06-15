export interface WcEvent {
  idEvent: string;
  strEvent: string;
  dateEvent: string; // YYYY-MM-DD
  strTimestamp: string | null; // ISO-ish UTC
  strStatus: string | null; // NS, 1H, HT, 2H, FT, AET, PEN...
  strProgress: string | null; // live minute
  strHomeTeam: string;
  strAwayTeam: string;
  idHomeTeam: string;
  idAwayTeam: string;
  intHomeScore: string | null;
  intAwayScore: string | null;
  strVenue: string | null;
  strLeague: string;
  strCity?: string | null;
  strCountry?: string | null;
  strGroup?: string | null;
  intRound?: string | null;
  intSpectators?: string | null;
  strTimeLocal?: string | null;
  strHomeTeamBadge?: string | null;
  strAwayTeamBadge?: string | null;
  strPoster?: string | null;
  strThumb?: string | null;
  strVideo?: string | null;
}

export interface TimelineItem {
  idTimeline?: string;
  intTime: string; // minute
  strTimeline: string; // Goal, Card, subst, ...
  strTimelineDetail: string | null;
  strHome: string | null; // "yes" | "no"
  strPlayer: string | null;
  strTeam: string | null;
  idPlayer: string | null;
  strAssist: string | null;
  strComment: string | null;
}

export interface Player {
  strPlayer: string;
  strTeam: string | null;
  strPosition: string | null;
  strNumber: string | null;
  strNationality: string | null;
  dateBorn: string | null;
  strThumb: string | null;
  strCutout: string | null;
  strDescriptionEN: string | null;
}

export interface LineupPlayer {
  strPlayer: string;
  strPosition: string | null;
  strSubstitute: string | null; // "Yes" | "No"
  strHome: string | null; // "Yes" | "No"
  intSquadNumber: string | null;
}

export interface EventStat {
  strStat: string;
  intHome: string | null;
  intAway: string | null;
}

export interface Prediction {
  homeGoals: number;
  awayGoals: number;
  pHome: number; // win prob
  pDraw: number;
  pAway: number;
  eloHome: number;
  eloAway: number;
}

export interface MatchOutcome {
  home: number;
  away: number;
  result: "H" | "D" | "A";
}

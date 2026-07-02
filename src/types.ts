export interface TableRow {
  intRank: string | null;
  strTeam: string;
  strGroup: string | null;
  intPlayed: string | null;
  intWin: string | null;
  intDraw: string | null;
  intLoss: string | null;
  intGoalsFor: string | null;
  intGoalsAgainst: string | null;
  intGoalDifference: string | null;
  intPoints: string | null;
}

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
  strStage?: string | null;
  strPlaceHolderA?: string | null;
  strPlaceHolderB?: string | null;
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
  strFanart?: string | null;
  strBanner?: string | null;
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
  intInternationalCaps?: number | null;
  intCareerGoals?: number | null;
}

export interface LineupPlayer {
  strPlayer: string;
  strPosition: string | null;
  strSubstitute: string | null; // "Yes" | "No"
  strHome: string | null; // "Yes" | "No"
  intSquadNumber: string | null;
  idPlayer?: string | null;
  strThumb?: string | null;
}

export interface EventStat {
  strStat: string;
  intHome: string | null;
  intAway: string | null;
}

export interface CardEvent {
  idTimeline?: string;
  intTime: string;
  strPlayer: string | null;
  strTeam: string | null;
  strHome: "yes" | "no" | null;
  cardType: "yellow" | "red";
}

/** Weighted count of timestamped match events (shots, corners, fouls, cards,
 *  goals) in a 15-minute period — a temporal "heat" of match intensity. */
export interface IntensityBucket {
  label: string;
  home: number;
  away: number;
}

export interface Prediction {
  homeGoals: number;
  awayGoals: number;
  pHome: number; // win prob
  pDraw: number;
  pAway: number;
  eloHome: number;
  eloAway: number;
  playerQualityHome: number;
  playerQualityAway: number;
  strengthHome: number;
  strengthAway: number;
  fifaRankHome?: number;
  fifaRankAway?: number;
}

export interface MatchOutcome {
  home: number;
  away: number;
  result: "H" | "D" | "A";
}

/** Match minute as the feeds write it: "67", "45+2", "90 + 3". Null when it is not a minute. */
export function parseMinute(raw: string | null | undefined): { base: number; added: number } | null {
  const m = /^(\d+)(?:\s*\+\s*(\d+))?$/.exec((raw ?? "").trim());
  return m ? { base: Number(m[1]), added: Number(m[2] ?? 0) } : null;
}

/** Chronological order for timeline items: 45+2 comes after 45 and before 46; unknown minutes go last. */
export function compareMinute(a: string | null | undefined, b: string | null | undefined): number {
  const key = (s: string | null | undefined) => {
    const p = parseMinute(s);
    return p ? p.base * 1000 + p.added : Number.POSITIVE_INFINITY;
  };
  const ka = key(a), kb = key(b);
  return ka === kb ? 0 : ka < kb ? -1 : 1;
}

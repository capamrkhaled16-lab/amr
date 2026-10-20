import type { HallOfFameEntry } from '@/lib/types';

export interface RankedEntry extends HallOfFameEntry {
  rank: number;
}

export function toNum(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return 0;
}

export function canonicalRankEntries(entries: HallOfFameEntry[]): RankedEntry[] {
  const seen = new Set<string>();
  const cleaned: HallOfFameEntry[] = [];
  for (const e of entries) {
    if (!e || !e.id || seen.has(e.id)) continue;
    seen.add(e.id);
    cleaned.push(e);
  }

  cleaned.sort((a, b) => {
    const sa = toNum(a.overall_score);
    const sb = toNum(b.overall_score);
    if (sb !== sa) return sb - sa;
    const aa = toNum(a.avg_score);
    const ab = toNum(b.avg_score);
    if (ab !== aa) return ab - aa;
    const ra = toNum(a.attendance_rate);
    const rb = toNum(b.attendance_rate);
    if (rb !== ra) return rb - ra;
    const ha = toNum(a.homework_rate);
    const hb = toNum(b.homework_rate);
    if (hb !== ha) return hb - ha;
    const ba = toNum(a.behavior_score);
    const bb = toNum(b.behavior_score);
    if (bb !== ba) return bb - ba;
    return a.id.localeCompare(b.id);
  });

  // Standard competition ranking ("1224"): tied scores share the same rank,
  // and the next distinct score skips the positions occupied by the ties.
  // e.g. scores [100, 100, 90, 90, 80] → ranks [1, 1, 3, 3, 5].
  const result: RankedEntry[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const rank = i + 1;
    // If this entry ties with the previous one on overall_score, share its rank
    if (i > 0 && toNum(cleaned[i].overall_score) === toNum(cleaned[i - 1].overall_score)) {
      result.push({ ...cleaned[i], rank: result[i - 1].rank });
    } else {
      result.push({ ...cleaned[i], rank });
    }
  }
  return result;
}

export interface Seg {
  key: string;
  start: number;
  end: number;
}

/** Side-by-side column layout for overlapping segments (Outlook style). */
export function layoutColumns(segs: Seg[]): Map<string, { col: number; cols: number }> {
  const out = new Map<string, { col: number; cols: number }>();
  const sorted = [...segs].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  let cluster: Seg[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    for (const s of cluster) out.get(s.key)!.cols = colEnds.length;
    cluster = [];
    colEnds = [];
  };
  for (const s of sorted) {
    if (s.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let col = colEnds.findIndex((end) => end <= s.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(s.end);
    } else colEnds[col] = s.end;
    out.set(s.key, { col, cols: 1 });
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.end);
  }
  flush();
  return out;
}

export type DiffLine = { type: 'same' | 'added' | 'removed'; text: string };

/** Above this many lines on a side the diff is not computed (the table would be too big). */
export const MAX_DIFF_LINES = 4000;

const split = (text: string) => (text === '' ? [] : text.split(/\r?\n/));

/**
 * Line diff of two texts (longest common subsequence). Removed lines come
 * before the added ones that replace them. null — texts too long to compare.
 */
export function lineDiff(before: string, after: string): DiffLine[] | null {
  const a = split(before);
  const b = split(after);
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return null;
  // Common head and tail first: the table is only for the changed middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const rows = midA.length + 1;
  const cols = midB.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = midA.length - 1; i >= 0; i -= 1) {
    for (let j = midB.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = midA[i] === midB[j]
        ? table[(i + 1) * cols + j + 1] + 1
        : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < midA.length || j < midB.length) {
    if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
      middle.push({ type: 'same', text: midA[i] });
      i += 1;
      j += 1;
    } else if (j >= midB.length || (i < midA.length && table[(i + 1) * cols + j] >= table[i * cols + j + 1])) {
      middle.push({ type: 'removed', text: midA[i] });
      i += 1;
    } else {
      middle.push({ type: 'added', text: midB[j] });
      j += 1;
    }
  }
  return [
    ...a.slice(0, start).map((text) => ({ type: 'same' as const, text })),
    ...middle,
    ...a.slice(endA).map((text) => ({ type: 'same' as const, text })),
  ];
}

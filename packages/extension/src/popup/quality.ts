/** Default selection: the highest available height not above the preferred one, else the lowest. */
export function pickDefaultHeight(heights: readonly number[], preferred: number): number | undefined {
  if (heights.length === 0) return undefined;
  const sorted = [...heights].sort((a, b) => b - a);
  return sorted.find((h) => h <= preferred) ?? sorted[sorted.length - 1];
}

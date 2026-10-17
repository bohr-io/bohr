/** D1 binds at most 100 parameters per statement: an IN list longer than that runs in pieces. */
export const D1_MAX_IN = 90;

export async function inChunks<T, R>(ids: readonly T[], run: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < ids.length; start += D1_MAX_IN) {
    results.push(...(await run(ids.slice(start, start + D1_MAX_IN))));
  }
  return results;
}

/** Stable 0-5 colour slot for a story's generated cover, so it looks the same everywhere. */
export function coverTone(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % 6;
}

/** True when an ISO date is within the last `days` days. */
export function isRecent(value: string | null | undefined, days = 14): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && Date.now() - time < days * 86400000 && time <= Date.now() + 86400000;
}

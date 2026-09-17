export function formatTime(s: number): string {
  if (!Number.isFinite(s)) return '0:00.0';
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export function percent(n: number | null | undefined): string {
  return `${Math.round((n ?? 0) * 100)}%`;
}

export function angleRange(
  value: { min: number; max: number } | null | undefined,
): string {
  return value
    ? `${Math.round(value.min)}–${Math.round(value.max)}°`
    : 'Unavailable';
}

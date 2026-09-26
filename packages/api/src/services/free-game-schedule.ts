function nextWeeklyTime(now: Date, weekday: number, hour: number): string {
  const next = new Date(now);
  next.setUTCHours(hour, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + (weekday - next.getUTCDay() + 7) % 7);
  if (now >= next) next.setUTCDate(next.getUTCDate() + 7);
  return next.toISOString();
}

export function getNextDailyFreeDrawAt(now = new Date()): string {
  return nextWeeklyTime(now, 4, 23);
}

// Friday 00:00 UTC is Thursday evening in America/Denver.
export function getNextFreeGameTime(now = new Date()): string {
  return nextWeeklyTime(now, 5, 0);
}

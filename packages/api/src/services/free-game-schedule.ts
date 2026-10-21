const denverCalendar = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  hourCycle: "h23",
});

// Match linode-iac/terraform/lambda-crons.tf: Friday in America/Denver.
function nextFridayTime(now: Date, hour: number): string {
  const parts = denverCalendar.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
  const friday = new Date(Date.UTC(part("year"), part("month") - 1, part("day"), 12));
  friday.setUTCDate(friday.getUTCDate() + (5 - friday.getUTCDay() + 7) % 7);

  const atLocalHour = () => {
    // Noon UTC is on the same Denver calendar day. Resolve the offset on the
    // target Friday, so crossing a DST change does not shift the local start.
    const localHour = Number(denverCalendar.formatToParts(friday).find((p) => p.type === "hour")!.value);
    const next = new Date(friday);
    next.setUTCHours(hour + 12 - localHour, 0, 0, 0);
    return next;
  };

  let next = atLocalHour();
  if (now >= next) {
    friday.setUTCDate(friday.getUTCDate() + 7);
    next = atLocalHour();
  }
  return next.toISOString();
}

export function getNextDailyFreeDrawAt(now = new Date()): string {
  return nextFridayTime(now, 17);
}

export function getNextFreeGameTime(now = new Date()): string {
  return nextFridayTime(now, 18);
}

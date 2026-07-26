/** Format ISO YYYY-MM-DD for public Updates UI (UTC calendar day). */
export function formatUpdateDate(
  isoDate: string,
  style: "long" | "short" = "long",
): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) {
    return isoDate;
  }
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    year: "numeric",
    month: style === "short" ? "short" : "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

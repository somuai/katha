export function effectiveDateInQuote(date: string, quote: string) {
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) return false;
  const d = new Date(timestamp),
    iso = d.toISOString().slice(0, 10);
  const month = d.toLocaleString("en-US", { month: "long", timeZone: "UTC" }),
    short = month.slice(0, 3),
    day = d.getUTCDate(),
    year = d.getUTCFullYear();
  const normalized = quote
    .toLowerCase()
    .replaceAll(",", "")
    .replace(/\s+/g, " ");
  const variants = [
    iso,
    `${month} ${day} ${year}`,
    `${short} ${day} ${year}`,
    `${day} ${month} ${year}`,
    `${day} ${short} ${year}`,
  ].map((s) => s.toLowerCase());
  return variants.some((v) => {
    const i = normalized.indexOf(v);
    return (
      i >= 0 &&
      /effective|starting|begins|takes effect|from|available|released/.test(
        normalized.slice(Math.max(0, i - 70), i + v.length + 70),
      )
    );
  });
}

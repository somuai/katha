import { Temporal } from "@js-temporal/polyfill";
export interface DateWindow {
  from: string;
  to: string;
  date: string;
  timezone: string;
  label: string;
}
export function dateWindow(day: string, timezone: string): DateWindow {
  const date = Temporal.PlainDate.from(day);
  const from = date
    .toZonedDateTime({ timeZone: timezone, plainTime: "00:00" })
    .toInstant()
    .toString();
  const to = date
    .add({ days: 1 })
    .toZonedDateTime({ timeZone: timezone, plainTime: "00:00" })
    .toInstant()
    .toString();
  return {
    from,
    to,
    date: date.toString(),
    timezone,
    label: `${date.toString()} (${timezone})`,
  };
}
export function resolveDate(
  text: string,
  now: Date,
  timezone = "UTC",
): DateWindow | null {
  const today = Temporal.Instant.from(now.toISOString())
    .toZonedDateTimeISO(timezone)
    .toPlainDate();
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return dateWindow(iso[1], timezone);
  if (/\byesterday\b/i.test(text))
    return dateWindow(today.subtract({ days: 1 }).toString(), timezone);
  if (/\btoday\b/i.test(text)) return dateWindow(today.toString(), timezone);
  const weekdays = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  const weekday = text
    .toLowerCase()
    .match(
      /\b(last\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
    );
  if (weekday) {
    let offset = (today.dayOfWeek - (weekdays.indexOf(weekday[2]) + 1) + 7) % 7;
    if (weekday[1] && offset === 0) offset = 7;
    return dateWindow(today.subtract({ days: offset }).toString(), timezone);
  }
  const names = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const months =
    "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
  const a = text.match(
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${months})(?:,?\\s+(\\d{4}))?\\b`,
      "i",
    ),
  );
  const b = text.match(
    new RegExp(
      `\\b(${months})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
      "i",
    ),
  );
  if (!a && !b) return null;
  const day = Number(a ? a[1] : b![2]),
    month =
      names.findIndex((name) =>
        name.startsWith((a ? a[2] : b![1]).toLowerCase().slice(0, 3)),
      ) + 1;
  const explicitYear = a ? a[3] : b![3];
  let year = explicitYear ? Number(explicitYear) : today.year;
  let date = Temporal.PlainDate.from(
    { year, month, day },
    { overflow: "reject" },
  );
  if (!explicitYear && Temporal.PlainDate.compare(date, today) > 0)
    date = date.subtract({ years: 1 });
  return dateWindow(date.toString(), timezone);
}

import { parse } from "csv-parse/sync";
import { z } from "zod";

const filter = z
  .object({
    column: z.string(),
    op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "empty"]),
    value: z
      .union([
        z.string(),
        z.number().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
      ])
      .optional(),
  })
  .strict();
export const csvPlanSchema = z.union([
  z.object({ clarification: z.string().min(1).max(300) }).strict(),
  z
    .object({
      operation: z.enum(["sum", "average", "min", "max", "count", "rows"]),
      column: z.string().optional(),
      groupBy: z.array(z.string()).max(2).default([]),
      filters: z.array(filter).max(4).default([]),
      sort: z.enum(["asc", "desc"]).default("desc"),
      limit: z.number().int().min(1).max(20).default(10),
    })
    .strict(),
]);
type Query = Exclude<z.infer<typeof csvPlanSchema>, { clarification: string }>;
const numeric = /^[+-]?\d{1,18}(?:\.\d{1,6})?$/;
const date = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s + "T00:00:00Z")) &&
  new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
function table(text: string) {
  const [headers, ...rows]: string[][] = parse(text, {
    skip_empty_lines: true,
    relax_column_count: false,
    bom: true,
  });
  if (!headers?.length || headers.length > 100 || rows.length > 100000)
    throw Error("CSV analysis supports at most 100 columns and 100,000 rows.");
  const names = headers.map((h) => h.trim());
  if (
    names.some((h) => !h) ||
    new Set(names.map((h) => h.toLowerCase())).size !== names.length
  )
    throw Error("Distinct, nonempty column names are required.");
  return { headers: names, rows: rows.map((r) => r.map((v) => v.trim())) };
}
export function csvColumns(text: string) {
  const { headers, rows } = table(text);
  return headers.map((name, i) => {
    const values = rows.map((r) => r[i]).filter(Boolean),
      distinct = [...new Set(values)];
    return {
      name,
      type:
        values.length && values.every((v) => numeric.test(v))
          ? "number"
          : values.length && values.every(date)
            ? "ISO date"
            : "text",
      ...(distinct.length <= 12
        ? { values: distinct.map((v) => v.slice(0, 80)) }
        : {}),
    };
  });
}
function units(value: string, scale: number) {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^[+-]/, "").split(".");
  return BigInt(whole + fraction.padEnd(scale, "0")) * (negative ? -1n : 1n);
}
function decimal(n: bigint, scale: number) {
  const digits = (n < 0n ? -n : n).toString().padStart(scale + 1, "0");
  return (
    (n < 0n ? "-" : "") +
    (scale ? digits.slice(0, -scale) + "." + digits.slice(-scale) : digits)
  );
}
const cell = (value: unknown) => {
  const text = String(value).replaceAll("\n", " ");
  if (!/[\\`*_{}\[\]()!<>|]/.test(text) && !/(?:https?:\/\/|www\.)/i.test(text))
    return text;
  const width = [...text.matchAll(/`+/g)].reduce(
    (n, m) => Math.max(n, m[0].length + 1),
    1,
  );
  const ticks = "`".repeat(width);
  return `${ticks} ${text.replaceAll("|", "\\|")} ${ticks}`;
};
export function executeCsvAnalysis(text: string, raw: unknown) {
  const parsed = csvPlanSchema.safeParse(raw);
  if (!parsed.success)
    throw Error(
      "The analysis plan was invalid. Specify the aggregate, column and filters more explicitly.",
    );
  if ("clarification" in parsed.data)
    return {
      answer: parsed.data.clarification,
      matchedRows: 0,
      plan: parsed.data,
    };
  const q: Query = parsed.data,
    { headers, rows } = table(text);
  const index = (name: string) => {
    const i = headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    if (i < 0)
      throw Error(
        "An analysis column is not in this CSV. Choose an existing column name.",
      );
    return i;
  };
  const groups = q.groupBy.map(index);
  const valueColumn = q.column === undefined ? undefined : index(q.column);
  if (!["count", "rows"].includes(q.operation) && valueColumn === undefined)
    throw Error("Choose a numeric column to aggregate.");
  const filters = q.filters.map((f) => {
    const i = index(f.column),
      v = f.value === undefined ? undefined : String(f.value);
    if (f.op !== "empty" && v === undefined)
      throw Error("A filter value is missing.");
    const cells = rows.map((r) => r[i]).filter(Boolean);
    if (["eq", "neq"].includes(f.op) && v !== "" && !cells.includes(v!))
      throw Error(
        "A requested category is not present in the chosen column. Check its spelling or case.",
      );
    if (["gt", "gte", "lt", "lte"].includes(f.op)) {
      if (!cells.length) throw Error("Cannot compare an empty column.");
      if (cells.every(date) && date(v!))
        return { i, f, compare: (a: string) => a.localeCompare(v!) };
      if (!cells.every((s) => numeric.test(s)) || !numeric.test(v!))
        throw Error(
          "Ordered filters need a numeric column or valid ISO dates; locale formats are not guessed.",
        );
      const scale = cells.reduce(
        (scale, s) => Math.max(scale, s.split(".")[1]?.length || 0),
        v!.split(".")[1]?.length || 0,
      );
      const b = units(v!, scale);
      return {
        i,
        f,
        compare: (a: string) =>
          units(a, scale) < b ? -1 : units(a, scale) > b ? 1 : 0,
      };
    }
    return { i, f, compare: (a: string) => a.localeCompare(v || "") };
  });
  const selected = rows.filter((row) =>
    filters.every(({ i, f, compare }) => {
      const a = row[i],
        v = String(f.value ?? "");
      if (f.op === "empty") return !a;
      if (f.op === "eq") return a === v;
      if (f.op === "neq") return a !== v;
      if (f.op === "contains") return a.includes(v);
      if (!a) return false;
      const cmp = compare(a);
      return f.op === "gt"
        ? cmp > 0
        : f.op === "gte"
          ? cmp >= 0
          : f.op === "lt"
            ? cmp < 0
            : cmp <= 0;
    }),
  );
  const currency = headers.findIndex((h) =>
    /^(?:currency|currency_code)$/i.test(h),
  );
  if (
    !["count", "rows"].includes(q.operation) &&
    currency >= 0 &&
    !groups.includes(currency) &&
    new Set(selected.map((r) => r[currency])).size > 1
  )
    throw Error(
      "These rows contain multiple currencies. Filter one currency or include currency in the grouping; no conversion rate was assumed.",
    );
  const buckets = new Map<string, { labels: string[]; rows: string[][] }>();
  for (const row of selected) {
    const labels = groups.map((i) => row[i] || "(blank)"),
      key = JSON.stringify(labels);
    const bucket = buckets.get(key) || { labels, rows: [] };
    bucket.rows.push(row);
    buckets.set(key, bucket);
    if (buckets.size > 1000)
      throw Error(
        "This grouping produces over 1,000 groups. Narrow the filters first.",
      );
  }
  if (!buckets.size && !groups.length)
    buckets.set("[]", { labels: [], rows: [] });
  if (buckets.size > 1000)
    throw Error(
      "This grouping produces over 1,000 groups. Narrow the filters first.",
    );
  let missing = 0;
  const result = [...buckets.values()].map((b) => {
    if (q.operation === "count")
      return {
        labels: b.labels,
        value: String(b.rows.length),
        rank: BigInt(b.rows.length),
        count: b.rows.length,
      };
    if (q.operation === "rows")
      return { labels: b.labels, value: "", rank: 0n, count: b.rows.length };
    const values = b.rows.map((r) => r[valueColumn!]).filter(Boolean);
    missing += b.rows.length - values.length;
    if (!values.every((v) => numeric.test(v)))
      throw Error(
        "The requested numeric column contains nonnumeric or locale-formatted values; no values were silently coerced.",
      );
    const scale = values.reduce(
        (n, v) => Math.max(n, v.split(".")[1]?.length || 0),
        0,
      ),
      ns = values.map((v) => units(v, scale));
    if (!ns.length)
      return {
        labels: b.labels,
        value: "No numeric values",
        rank: undefined,
        count: 0,
      };
    let n = ns.reduce((a, b) => a + b, 0n),
      outScale = scale;
    if (q.operation === "min") n = ns.reduce((a, b) => (a < b ? a : b));
    if (q.operation === "max") n = ns.reduce((a, b) => (a > b ? a : b));
    if (q.operation === "average") {
      const denominator = BigInt(ns.length) * 10n ** BigInt(scale),
        numerator = n * 1000000n,
        absolute = numerator < 0n ? -numerator : numerator;
      n =
        ((absolute + denominator / 2n) / denominator) *
        (numerator < 0n ? -1n : 1n);
      outScale = 6;
    }
    return {
      labels: b.labels,
      value: decimal(n, outScale),
      rank: n * 10n ** BigInt(6 - outScale),
      count: ns.length,
    };
  });
  result.sort((a, b) => {
    const x = a.rank,
      y = b.rank;
    if (x === undefined || y === undefined)
      return x === y
        ? a.labels.join().localeCompare(b.labels.join())
        : x === undefined
          ? 1
          : -1;
    return x === y
      ? a.labels.join().localeCompare(b.labels.join())
      : (x < y ? -1 : 1) * (q.sort === "asc" ? 1 : -1);
  });
  const lines = [
    `Computed from the complete CSV: ${selected.length} matching rows out of ${rows.length}.`,
    "",
    `Applied filters (AND): ${q.filters.length ? q.filters.map((f) => `${cell(f.column)} ${f.op} ${cell(JSON.stringify(f.value ?? ""))}`).join("; ") : "none"}.`,
    "",
    `Operation: ${q.operation}${q.column ? `(${cell(q.column)})` : ""}${q.groupBy.length ? `; grouped by ${q.groupBy.map(cell).join(", ")}` : ""}.`,
  ];
  lines.push("");
  if (q.operation === "rows") {
    if (q.groupBy.length)
      throw Error(
        "Grouping is not supported for row listings; choose an aggregate.",
      );
    const sortIndex = valueColumn;
    const sorted =
      sortIndex === undefined
        ? selected
        : [...selected].sort((a, b) => {
            if (numeric.test(a[sortIndex]) && numeric.test(b[sortIndex])) {
              const scale = Math.max(
                  a[sortIndex].split(".")[1]?.length || 0,
                  b[sortIndex].split(".")[1]?.length || 0,
                ),
                x = units(a[sortIndex], scale),
                y = units(b[sortIndex], scale);
              return (x < y ? -1 : x > y ? 1 : 0) * (q.sort === "asc" ? 1 : -1);
            }
            return (
              a[sortIndex].localeCompare(b[sortIndex]) *
              (q.sort === "asc" ? 1 : -1)
            );
          });
    lines.push(
      `| ${headers.map(cell).join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      ...sorted
        .slice(0, q.limit)
        .map((row) => `| ${row.map(cell).join(" | ")} |`),
    );
    if (selected.length > q.limit)
      lines.push(
        "",
        `Showing ${q.limit} of ${selected.length} matching rows; this is not the complete list.`,
      );
  } else {
    lines.push(
      `| ${[...q.groupBy, q.operation, "numeric values / rows"].map(cell).join(" | ")} |`,
      `| ${[...q.groupBy, q.operation, "count"].map(() => "---").join(" | ")} |`,
      ...result
        .slice(0, q.limit)
        .map(
          (r) => `| ${[...r.labels, r.value, r.count].map(cell).join(" | ")} |`,
        ),
    );
    if (result.length > q.limit)
      lines.push("", `Showing ${q.limit} of ${result.length} groups.`);
  }
  if (missing)
    lines.push(
      "",
      `${missing} missing numeric cells excluded, not assumed zero.`,
    );
  if (q.operation === "average")
    lines.push(
      "",
      "Averages rounded to six decimal places using decimal arithmetic.",
    );
  const answer = lines.join("\n");
  if (answer.length > 20000)
    throw Error(
      "The result is too large to display safely. Narrow the filters or lower the row limit.",
    );
  return {
    answer,
    matchedRows: selected.length,
    totalRows: rows.length,
    plan: q,
  };
}

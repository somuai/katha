import { parse } from "csv-parse/sync";
// Derived locally from the complete retained CSV; malformed or unsafe values are not guessed.
export function summarizeCsv(text: string, question: string) {
  try {
    const rows: string[][] = parse(text, {
      skip_empty_lines: true,
      relax_column_count: false,
      bom: true,
    });
    if (rows.length < 2 || rows[0].length > 100 || rows.length > 100001)
      return undefined;
    const [headers, ...data] = rows;
    const normalizedHeaders = headers.map((h) => h.trim().toLowerCase());
    if (
      normalizedHeaders.some((h) => !h) ||
      new Set(normalizedHeaders).size !== headers.length
    )
      return "CSV column names are blank or duplicated; named-column calculations are ambiguous. Ask for distinct column names before computing a sum.";
    const terms = (
      question.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || []
    ).filter(
      (x) =>
        ![
          "the",
          "csv",
          "what",
          "how",
          "all",
          "sum",
          "amount",
          "listed",
          "this",
          "for",
        ].includes(x),
    );
    const stats = headers.flatMap((name, i) => {
      const cells = data.map((row) => row[i].trim());
      const values = cells.filter(Boolean);
      // No currency, thousands-separator or locale assumptions. Fixed-point
      // arithmetic avoids silently rounding money through binary floats.
      if (
        !values.length ||
        !values.every((x) => /^[+-]?\d{1,18}(?:\.\d{1,6})?$/.test(x))
      )
        return [];
      const scale = values.reduce(
        (max, x) => Math.max(max, x.split(".")[1]?.length || 0),
        0,
      );
      const total = values.reduce((sum, value) => {
        const negative = value.startsWith("-");
        const [whole, fraction = ""] = value.replace(/^[+-]/, "").split(".");
        const units = BigInt(whole + fraction.padEnd(scale, "0"));
        return sum + (negative ? -units : units);
      }, 0n);
      const digits = (total < 0n ? -total : total)
        .toString()
        .padStart(scale + 1, "0");
      const sum =
        (total < 0n ? "-" : "") +
        (scale ? digits.slice(0, -scale) + "." + digits.slice(-scale) : digits);
      return [
        `${name}: ${values.length} ${scale ? "decimal" : "integer"} values, sum ${sum}${values.length < cells.length ? `; ${cells.length - values.length} missing cells excluded (not assumed zero)` : ""}`,
      ];
    });
    // Exact categorical frequencies cover common attendance and CRM stage questions.
    // High-cardinality columns (e.g. names or IDs) are intentionally omitted.
    const categories = headers
      .flatMap((name, i) => {
        const counts = new Map<string, number>();
        for (const row of data) {
          const value = row[i].trim() || "(empty)";
          counts.set(value, (counts.get(value) || 0) + 1);
          if (counts.size > 12) return [];
        }
        if (
          [...counts.keys()].every((value) =>
            /^[+-]?\d+(?:\.\d+)?$/.test(value),
          )
        )
          return [];
        const entries = [...counts].map(
          ([value, count]) => `${JSON.stringify(value)}: ${count}`,
        );
        const score = terms.some(
          (term) =>
            name.toLowerCase().includes(term) ||
            [...counts.keys()].some((value) => value.toLowerCase() === term),
        )
          ? 1
          : 0;
        return [{ name, entries, score }];
      })
      .sort((a, b) => b.score - a.score)
      .map(
        ({ name, entries }) =>
          `${name} counts across all rows: ${entries.join(", ")}`,
      );
    const scoped: string[] = [];
    for (
      let column = 0;
      column < headers.length && scoped.length < 2;
      column++
    ) {
      const values = [
        ...new Set(data.map((row) => row[column].trim().toLowerCase())),
      ];
      if (values.length > 12) continue;
      const named = values.filter(
        (value) => value && !/^[+-]?\d/.test(value) && terms.includes(value),
      );
      // Several named alternatives in the same column are not silently
      // interpreted as a filter or an OR/AND expression.
      if (named.length !== 1) continue;
      const value = named[0];
      const subset = data.filter(
        (row) => row[column].trim().toLowerCase() === value,
      );
      const counts = headers.flatMap((header, i) => {
        if (i === column) return [];
        const tally = new Map<string, number>();
        for (const row of subset) {
          const cell = row[i].trim() || "(empty)";
          tally.set(cell, (tally.get(cell) || 0) + 1);
          if (tally.size > 12) return [];
        }
        if ([...tally.keys()].every((x) => /^[+-]?\d+(?:\.\d+)?$/.test(x)))
          return [];
        return [
          `${header} counts: ${[...tally].map(([cell, count]) => `${JSON.stringify(cell)}: ${count}`).join(", ")}`,
        ];
      });
      scoped.push(
        `For ${headers[column]}=${JSON.stringify(data.find((row) => row[column].trim().toLowerCase() === value)![column].trim())} (${subset.length} rows; independent exact-value filter): ${counts.join("; ")}`,
      );
    }
    const matched = data
      .filter((row) =>
        row.some(
          (cell) =>
            cell.length >= 3 &&
            terms.some((term) => cell.toLowerCase() === term),
        ),
      )
      .slice(0, 5);
    const lines = [
      `Complete CSV: ${data.length} data rows. Exact numeric sums and low-cardinality counts below are computed across all rows; other analyses may require more evidence.`,
      ...scoped,
      ...matched.map(
        (row) =>
          "Matching row: " + headers.map((h, i) => `${h}=${row[i]}`).join(", "),
      ),
      ...categories,
      ...stats,
    ];
    const included: string[] = [];
    let used = 0;
    for (const line of lines) {
      if (used + line.length + 1 > 1120) continue;
      included.push(line);
      used += line.length + 1;
    }
    if (included.length < lines.length)
      included.push("Additional summary fields were omitted due to size.");
    return included.join("\n");
  } catch {
    return undefined;
  }
}

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
      if (
        !cells.length ||
        !cells.every(
          (x) => /^-?\d+$/.test(x) && Number.isSafeInteger(Number(x)),
        )
      )
        return [];
      const numbers = cells.map(Number);
      let sum = 0;
      for (const n of numbers) {
        sum += n;
        if (!Number.isSafeInteger(sum)) return [];
      }
      return Number.isSafeInteger(sum)
        ? [`${name}: ${numbers.length} integer values, sum ${sum}`]
        : [];
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
        if ([...counts.keys()].every((value) => /^-?\d+$/.test(value)))
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
      `Complete CSV: ${data.length} data rows. Whole-number sums and low-cardinality counts below are computed across all rows; other analyses may require more evidence.`,
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

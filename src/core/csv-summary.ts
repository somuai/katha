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
    const matched = data
      .filter((row) =>
        row.some(
          (cell) =>
            cell.length >= 3 &&
            terms.some((term) => cell.toLowerCase() === term),
        ),
      )
      .slice(0, 5);
    return [
      `Complete CSV: ${data.length} data rows.`,
      ...stats,
      ...matched.map(
        (row) =>
          "Matching row: " + headers.map((h, i) => `${h}=${row[i]}`).join(", "),
      ),
    ]
      .join("\n")
      .slice(0, 1200);
  } catch {
    return undefined;
  }
}

import Papa from "papaparse";
import { z } from "zod";

export const candidateSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  course: z.string().trim().min(1),
  score: z.coerce.number().min(0).max(100),
});

export const batchSchema = z.object({
  name: z.string().min(1),
  candidates: z.array(candidateSchema).min(1).max(500),
});

export type CandidateInput = z.infer<typeof candidateSchema>;

export type CsvRowError = {
  row: number;
  errors: string[];
};

export function parseCandidateCsv(contents: string): {
  candidates: CandidateInput[];
  errors: CsvRowError[];
} {
  const parsed = Papa.parse<Record<string, unknown>>(contents, {
    header: true,
    skipEmptyLines: true,
  });
  const errors: CsvRowError[] = parsed.errors.map(error => ({
    row: (error.row ?? 0) + 2,
    errors: [error.message],
  }));
  const candidates: Array<{ row: number; candidate: CandidateInput }> = [];

  parsed.data.forEach((row, index) => {
    const result = candidateSchema.safeParse(row);
    if (!result.success) {
      errors.push({
        row: index + 2,
        errors: result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`),
      });
      return;
    }

    candidates.push({ row: index + 2, candidate: result.data });
  });

  const firstRowByEmail = new Map<string, number>();
  for (const { row, candidate } of candidates) {
    const email = candidate.email.toLowerCase();
    const firstRow = firstRowByEmail.get(email);
    if (firstRow !== undefined) {
      errors.push({ row, errors: [`Duplicate email (also on row ${firstRow})`] });
    } else {
      firstRowByEmail.set(email, row);
    }
  }

  if (parsed.data.length > 500) {
    errors.push({ row: 502, errors: ["A batch cannot contain more than 500 candidates"] });
  }

  if (candidates.length === 0 && errors.length === 0) {
    errors.push({ row: 2, errors: ["At least one candidate row is required"] });
  }

  return {
    candidates: errors.length === 0 ? candidates.map(({ candidate }) => candidate) : [],
    errors,
  };
}

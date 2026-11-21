import assert from "node:assert/strict";
import test from "node:test";
import { BatchStatus, Decision } from "@prisma/client";
import { resolveDistrictBatchStatus } from "./policy";
import { parseCandidateCsv } from "./validation";

test("district batches advance only after two approvals and route large batches to quality", () => {
  assert.equal(resolveDistrictBatchStatus(20, [Decision.APPROVE]), BatchStatus.DISTRICT_REVIEW);
  assert.equal(
    resolveDistrictBatchStatus(20, [Decision.APPROVE, Decision.APPROVE]),
    BatchStatus.STATE_REVIEW,
  );
  assert.equal(
    resolveDistrictBatchStatus(50, [Decision.APPROVE, Decision.APPROVE]),
    BatchStatus.QUALITY_REVIEW,
  );
});

test("district rejection and return stop approval routing", () => {
  assert.equal(resolveDistrictBatchStatus(20, [Decision.REJECT]), BatchStatus.REJECTED);
  assert.equal(resolveDistrictBatchStatus(20, [Decision.RETURN]), BatchStatus.RETURNED);
});

test("CSV reports source row numbers and rejects the whole batch", () => {
  const result = parseCandidateCsv([
    "name,email,course,score",
    "Asha,asha@example.com,Frontend,0",
    "Bad row,not-an-email,Python,101",
    "Ravi,ASHA@example.com,Python,90",
  ].join("\n"));

  assert.deepEqual(result.errors.map(error => error.row), [3, 4]);
  assert.equal(result.errors[0].errors.length, 2);
  assert.equal(result.candidates.length, 0);
});

test("CSV accepts score boundaries and trims candidate fields", () => {
  const result = parseCandidateCsv([
    "name,email,course,score",
    " Asha ,asha@example.com, Frontend ,0",
    "Ravi,ravi@example.com,Python,100",
  ].join("\n"));

  assert.deepEqual(result.errors, []);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].name, "Asha");
  assert.equal(result.candidates[1].score, 100);
});

test("CSV rejects an empty batch with a clear row error", () => {
  const result = parseCandidateCsv("name,email,course,score\n");

  assert.deepEqual(result.candidates, []);
  assert.equal(result.errors[0].row, 2);
});

test("CSV rejects batches larger than 500 candidates", () => {
  const rows = Array.from({ length: 501 }, (_, index) =>
    `Candidate ${index},candidate${index}@example.com,Course,80`,
  );
  const result = parseCandidateCsv(["name,email,course,score", ...rows].join("\n"));

  assert.deepEqual(result.candidates, []);
  assert.equal(result.errors.at(-1)?.row, 502);
});

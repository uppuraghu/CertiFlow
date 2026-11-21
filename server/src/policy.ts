import { BatchStatus, Decision } from "@prisma/client";

export function resolveDistrictBatchStatus(
  batchSize: number,
  decisions: readonly Decision[],
): BatchStatus {
  if (decisions.includes(Decision.RETURN)) return BatchStatus.RETURNED;
  if (decisions.includes(Decision.REJECT)) return BatchStatus.REJECTED;

  const approvals = decisions.filter(decision => decision === Decision.APPROVE).length;
  if (approvals < 2) return BatchStatus.DISTRICT_REVIEW;

  return batchSize >= 50 ? BatchStatus.QUALITY_REVIEW : BatchStatus.STATE_REVIEW;
}

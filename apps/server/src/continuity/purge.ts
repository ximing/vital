import { and, eq, inArray } from 'drizzle-orm';
import type { AgentDb } from '../agent/jobs.js';
import {
  continuityContractRevisions,
  continuityContracts,
  continuityDependencies,
  continuityEvidence,
  continuityEvidenceLinks,
  continuityEvents,
  continuityExperiments,
  continuityExposures,
  continuityInterventions,
  continuityOpportunities,
} from '../db/schema.js';

/** Same-transaction delete of a thread's continuity rows. Settings are kept. */
export async function purgeContinuityForOutcome(
  tx: AgentDb,
  userId: string,
  outcomeId: string,
): Promise<void> {
  const contracts = await tx
    .select({ id: continuityContracts.id })
    .from(continuityContracts)
    .where(and(eq(continuityContracts.userId, userId), eq(continuityContracts.outcomeId, outcomeId)));
  const contractIds = contracts.map((row) => row.id);
  if (contractIds.length === 0) return;

  const interventions = await tx
    .select({ id: continuityInterventions.id })
    .from(continuityInterventions)
    .where(
      and(
        eq(continuityInterventions.userId, userId),
        inArray(continuityInterventions.contractId, contractIds),
      ),
    );
  const interventionIds = interventions.map((row) => row.id);
  const links = await tx
    .select({ evidenceId: continuityEvidenceLinks.evidenceId })
    .from(continuityEvidenceLinks)
    .where(
      and(
        eq(continuityEvidenceLinks.userId, userId),
        inArray(continuityEvidenceLinks.contractId, contractIds),
      ),
    );
  const evidenceIds = links.map((row) => row.evidenceId);

  if (interventionIds.length > 0) {
    await tx
      .delete(continuityExposures)
      .where(
        and(
          eq(continuityExposures.userId, userId),
          inArray(continuityExposures.candidateId, interventionIds),
        ),
      );
  }
  await tx
    .delete(continuityInterventions)
    .where(
      and(
        eq(continuityInterventions.userId, userId),
        inArray(continuityInterventions.contractId, contractIds),
      ),
    );
  await tx
    .delete(continuityExperiments)
    .where(
      and(
        eq(continuityExperiments.userId, userId),
        inArray(continuityExperiments.contractId, contractIds),
      ),
    );
  await tx
    .delete(continuityEvidenceLinks)
    .where(
      and(
        eq(continuityEvidenceLinks.userId, userId),
        inArray(continuityEvidenceLinks.contractId, contractIds),
      ),
    );
  if (evidenceIds.length > 0) {
    await tx
      .delete(continuityEvidence)
      .where(and(eq(continuityEvidence.userId, userId), inArray(continuityEvidence.id, evidenceIds)));
  }
  await tx
    .delete(continuityOpportunities)
    .where(
      and(
        eq(continuityOpportunities.userId, userId),
        inArray(continuityOpportunities.contractId, contractIds),
      ),
    );
  await tx
    .delete(continuityEvents)
    .where(
      and(eq(continuityEvents.userId, userId), inArray(continuityEvents.aggregateId, contractIds)),
    );
  await tx
    .delete(continuityDependencies)
    .where(
      and(
        eq(continuityDependencies.userId, userId),
        inArray(continuityDependencies.contractId, contractIds),
      ),
    );
  await tx
    .delete(continuityContractRevisions)
    .where(
      and(
        eq(continuityContractRevisions.userId, userId),
        inArray(continuityContractRevisions.contractId, contractIds),
      ),
    );
  await tx
    .delete(continuityContracts)
    .where(and(eq(continuityContracts.userId, userId), inArray(continuityContracts.id, contractIds)));
}

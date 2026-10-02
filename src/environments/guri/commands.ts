// Private imports are resolved only by prepareGuri against the clean source pin.
// @ts-expect-error private canonical leaf
import { getLeadDetail, searchLeads } from '@guri/lib/domain/leads/queries.ts';
// @ts-expect-error private canonical leaf
import { createLeadTask, listOpenTasks } from '@guri/lib/domain/leads/tasks.ts';
// @ts-expect-error private canonical access
import { authorizeLead } from '@guri/lib/domain/access/leads.ts';
// @ts-expect-error private canonical leaf
import * as offerQueries from '@guri/lib/domain/offers/queries.ts';
// @ts-expect-error private canonical leaf
import * as offerWorkspace from '@guri/lib/domain/offers/workspace-save.ts';
// @ts-expect-error private canonical leaf
import { commitOfferStatusTransition } from '@guri/lib/domain/offers/status.ts';
// @ts-expect-error private canonical leaf
import { recallOfferEnvelope } from '@guri/lib/domain/offers/recall.ts';
// @ts-expect-error private canonical leaf
import { syncLeadStageForOffer } from '@guri/lib/domain/leads/stage-sync.ts';
// @ts-expect-error private canonical leaf
import { requireProjectDetail } from '@guri/lib/domain/projects/queries.ts';
// @ts-expect-error private canonical access
import { authorizeProject } from '@guri/lib/domain/access/projects.ts';
// @ts-expect-error private canonical leaf
import * as requirements from '@guri/lib/domain/projects/requirements.ts';
// @ts-expect-error private canonical leaf
import { updateMilestone } from '@guri/lib/domain/projects/milestones.ts';
// @ts-expect-error private canonical leaf
import { logActionOrThrow } from '@guri/lib/domain/audit/action-log.ts';
// @ts-expect-error private canonical leaf
import { getComplianceEngagement } from '@guri/lib/domain/compliance/engagements.ts';
// @ts-expect-error private canonical leaf
import { resolveComplianceDocument } from '@guri/lib/domain/compliance/documents.ts';
// @ts-expect-error private canonical leaf
import * as outreach from '@guri/lib/domain/compliance/outreach.ts';
// @ts-expect-error private canonical leaf
import { getTradieDetail, listTradieSchedules } from '@guri/lib/domain/tradies/queries.ts';
// @ts-expect-error private canonical leaf
import { createTradieSchedule } from '@guri/lib/domain/tradies/schedules.ts';
// @ts-expect-error private canonical leaf
import { requestTradiePriceChange } from '@guri/lib/domain/tradies/directory.ts';
// @ts-expect-error private canonical leaf
import { changeTeamMemberRole } from '@guri/lib/domain/identity/team.ts';
// @ts-expect-error private canonical access
import { requireAdminPrincipal } from '@guri/lib/domain/principal.ts';
import type { GuriTool } from '#src/environments/guri/tools';
import type { DurableRecordingProvider } from '#src/environments/guri/recording-provider';
const { getOfferWorkspaceDetails, listOfferRevisionHistory, getOfferSigningStatus } = offerQueries;
const { applyOfferWorkspacePatch, syncLeadDealValue } = offerWorkspace;
const { getProjectRequirements, updateProjectRequirements } = requirements;
const { prepareComplianceOutreach, sendComplianceOutreach } = outreach;

export async function canonicalRead(tool: GuriTool, args: any, principal: any, db: any) {
  switch (tool) {
    case 'find_leads':
    case 'search_leads':
      return searchLeads(principal, { ...args, limit: 30, includeArchived: false }, db);
    case 'get_lead':
      return getLeadDetail(principal, args.leadId, 25, db);
    case 'list_lead_tasks':
      await authorizeLead(principal, args.leadId, db);
      return listOpenTasks(db, { leadIds: [args.leadId] });
    case 'get_offer_details':
      return getOfferWorkspaceDetails(principal, args.offerId, db);
    case 'list_offer_revisions':
      return listOfferRevisionHistory(principal, args.leadId, db);
    case 'get_offer_signing_status':
      return getOfferSigningStatus(principal, args.offerId, db);
    case 'get_project': {
      const detail = await requireProjectDetail(principal, args.projectId, db);
      // Explicit projection excludes unrelated mail, identity metadata and internal provider fields.
      return {
        id: detail.id,
        name: detail.name,
        description: detail.description,
        status: detail.status,
        updatedAt: detail.updatedAt,
        totalBudget: detail.totalBudget,
        spent: detail.spent,
        requirements: detail.requirements,
        milestones: detail.milestones,
      };
    }
    case 'get_project_requirements':
      await authorizeProject(principal, args.projectId, db);
      return getProjectRequirements(args.projectId, db);
    case 'get_compliance': {
      const engagement = await getComplianceEngagement(principal, args.projectId, db);
      if (!engagement) return null;
      return {
        id: engagement.id,
        projectId: engagement.projectId,
        status: engagement.status,
        subjectAddress: engagement.subjectAddress,
        documents: engagement.documents,
        outreaches: engagement.outreaches,
        alerts: engagement.alerts,
      };
    }
    case 'prepare_compliance_outreach':
      return prepareComplianceOutreach(principal, args, db);
    case 'get_tradie':
      return getTradieDetail(principal, args.tradieId, db);
    case 'list_schedules':
      return listTradieSchedules(principal, { ...args, query: '', limit: 50 }, db);
    case 'list_team':
      requireAdminPrincipal(principal);
      return db.user.findMany({
        select: { id: true, name: true, role: true },
        orderBy: { id: 'asc' },
        take: 50,
      });
    default:
      throw new Error('GURI_READ_DISPATCH');
  }
}
// The caller supplies the serializable transaction. No duplicated business predicates.
export async function canonicalWrite(tool: GuriTool, args: any, principal: any, tx: any) {
  switch (tool) {
    case 'create_lead_task':
      await authorizeLead(principal, args.leadId, tx);
      return createLeadTask(
        { ...args, dueDate: new Date(`${args.dueDate}T00:00:00Z`), actingUserId: principal.userId },
        tx,
      );
    case 'update_offer_details': {
      const result = await applyOfferWorkspacePatch(principal, args, tx);
      if (!result.ok) throw new CanonicalResultRefusal(result.reason, result);
      await tx.offerStatusEvent.create({
        data: {
          actorId: principal.userId,
          offerId: args.offerId,
          fromStatus: result.offerStatus,
          toStatus: result.offerStatus,
          note: 'Royal-Lab synthetic workspace edit via canonical command.',
        },
      });
      return result;
    }
    case 'transition_offer_status': {
      const result = await commitOfferStatusTransition(principal, args, tx);
      if (!result) throw new CanonicalResultRefusal('stale', { reason: 'stale' });
      return result;
    }
    case 'update_project_requirements': {
      await authorizeProject(principal, args.projectId, tx);
      const result = await updateProjectRequirements(args, tx);
      await logActionOrThrow(
        {
          projectId: args.projectId,
          type: 'requirements',
          message: 'Royal-Lab synthetic requirements edit via canonical command.',
          timestamp: new Date(),
          authorId: principal.userId,
        },
        tx,
      );
      return result;
    }
    case 'update_milestone': {
      const result = await updateMilestone(principal, args, tx);
      await logActionOrThrow(
        {
          projectId: result.milestone.projectId,
          milestoneId: args.milestoneId,
          type: 'milestone',
          message: 'Royal-Lab synthetic milestone edit via canonical command.',
          timestamp: new Date(),
          authorId: principal.userId,
        },
        tx,
      );
      return {
        ...result,
        externalEffects: result.stageClaim ? [{ kind: 'xero-claim', status: 'unavailable' }] : [],
      };
    }
    case 'resolve_compliance_document':
      return resolveComplianceDocument(principal, args, tx);
    case 'create_schedule':
      return createTradieSchedule(
        principal,
        {
          ...args,
          scheduledDate: new Date(`${args.scheduledDate}T00:00:00Z`),
        },
        tx,
      );
    case 'request_price_change':
      return requestTradiePriceChange(principal, args, tx);
    default:
      throw new Error('GURI_WRITE_DISPATCH');
  }
}
export class CanonicalResultRefusal extends Error {
  constructor(
    readonly reason: string,
    readonly result: unknown,
  ) {
    super(`Canonical ${reason} refusal.`);
  }
}
// These commands own their transactions/provider settlement. The controller journals
// intent before dispatch; a partial or lost outcome is never blindly replayed.
export async function canonicalOwnedWrite(
  tool: GuriTool,
  args: any,
  principal: any,
  db: any,
  ports: DurableRecordingProvider,
  operationKey: string,
) {
  if (tool === 'send_compliance_outreach')
    return sendComplianceOutreach(
      principal,
      {
        ...args,
        deliverables: [],
        extraAttachmentIds: [],
        idempotencyKey: operationKey,
      },
      db,
      (payload: unknown) => ports.invoke('email', payload).then(() => undefined),
    );
  if (tool === 'recall_offer_envelope') {
    const result = await recallOfferEnvelope(principal, args, db, ports.envelope);
    if (!result.ok) throw new CanonicalResultRefusal('recall-unconfirmed', result);
    return result;
  }
  if (tool === 'update_team_role') {
    // Preserve the command's own serializable boundary. The identity provider is
    // absent, so a permitted local role change is rolled back before commit.
    const transactional = {
      $transaction: (run: (tx: any) => Promise<any>, options: unknown) =>
        db.$transaction(async (tx: any) => {
          const result = await run(tx);
          await ports.invoke('identity-role', { userId: args.userId, role: args.newRole });
          return result;
        }, options),
    };
    return changeTeamMemberRole(principal, args, transactional);
  }
  throw new Error('GURI_OWNED_DISPATCH');
}
export async function canonicalAfterCommit(tool: GuriTool, args: any, result: any, db: any) {
  if (tool === 'update_offer_details')
    await syncLeadDealValue(args.offerId, result.contractValueIncGst, db);
  if (tool === 'transition_offer_status' || tool === 'recall_offer_envelope')
    await syncLeadStageForOffer(args.offerId, db);
}

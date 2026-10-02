import { jsonText } from '#src/io';
import { AUTHORED_DRAFT } from '#fixtures/authoring/build';
import type { CaseSpec } from '#fixtures/authoring/types';

// Measurement-system controls generated beside the authored cases (#12, #15).
// These validate graders before any model result is interpreted; they are not
// model outputs, reviewed gold labels or scores.
export function negativeControlIndex(specs: CaseSpec[]) {
  const rows = specs.flatMap((spec) =>
    spec.controls
      .filter((control) => control.kind === 'negative')
      .map((control) => ({
        taskId: spec.id,
        definitionId: spec.definitionId,
        role: spec.role,
        profile: spec.profile,
        controlId: control.id,
        failureMode: control.failureMode,
        failingCriteria: control.expect?.fail ?? [],
        description: control.description,
      })),
  );
  const coverage: Record<string, number> = {};
  for (const row of rows) coverage[row.failureMode!] = (coverage[row.failureMode!] ?? 0) + 1;
  return jsonText({
    schemaVersion: '1.0.0',
    version: '1.1.0',
    review: AUTHORED_DRAFT,
    provenance:
      'Index of hidden negative controls in tasks/*/grading/controls.json. Document controls are graded offline by `pnpm lab controls`; fixed-tools trajectories by integration/authored-tools.test.ts.',
    coverage: Object.fromEntries(Object.entries(coverage).sort(([a], [b]) => a.localeCompare(b))),
    controls: rows,
  });
}
// Policy section 2 worked control, cross-checked against the canonical pricing
// helper by integration/oracle.test.ts and against exact facts offline.
export const ADDITIVE_MARKUP_CONTROL = {
  schemaVersion: '1.0.0',
  version: '1.0.0',
  review: AUTHORED_DRAFT,
  provenance:
    'Synthetic $500,000 / 10% overhead + 10% fee / 10% GST control requested by issue #12. Additive markups on one base, never compounded.',
  input: {
    directTotal: 500000,
    totalAreaSqm: 250,
    settings: {
      royalConstructionOverheadPct: 0.1,
      royalConstructionFeePct: 0.1,
      gstRate: 0.1,
      hbcfTotalContractValue: 0,
      hbcfRate: 0,
      homeWarrantyHbcfFixed: 0,
      impactFeeFixed: 0,
      loadingChargePercentage: 0,
    },
  },
  expectedCents: {
    costBaseCents: 50000000,
    overheadCents: 5000000,
    feeCents: 5000000,
    gstCents: 6000000,
    contractCents: 66000000,
  },
  wrongCompoundedContractCents: 66550000,
};
// Nested child-session write unobserved by the parent trace: durable state must
// still expose it. Session/call identities are synthetic.
export const NESTED_TRACE_CONTROL = {
  schemaVersion: '1.0.0',
  version: '1.0.0',
  review: AUTHORED_DRAFT,
  provenance:
    'Synthetic prototype for issue #15 and optional Royal Eve (#18): a delegated child session commits a write the parent trace never records.',
  cases: [
    {
      id: 'child-write-hidden-from-parent',
      parentTrace: [
        {
          type: 'tool-attempt',
          callId: 'parent-call',
          tool: 'delegate',
          arguments: { task: 'follow up Amelia' },
        },
        {
          type: 'tool-executed',
          callId: 'parent-call',
          tool: 'delegate',
          outcome: 'success',
          result: { ok: true },
        },
      ],
      operations: [{ key: 'child-session:child-call:create_lead_task', status: 'committed' }],
      expectedUnobserved: ['child-session:child-call:create_lead_task'],
    },
    {
      id: 'parent-observed-write',
      parentTrace: [
        {
          type: 'tool-attempt',
          callId: 'call-a',
          tool: 'create_lead_task',
          arguments: { leadId: 101 },
        },
        {
          type: 'tool-executed',
          callId: 'call-a',
          tool: 'create_lead_task',
          outcome: 'success',
          result: { id: 1 },
        },
      ],
      operations: [{ key: 'case-session:call-a:create_lead_task', status: 'committed' }],
      expectedUnobserved: [],
    },
    {
      id: 'refused-child-attempt-is-not-a-commit',
      parentTrace: [],
      operations: [{ key: 'child-session:child-call:update_team_role', status: 'refused' }],
      expectedUnobserved: [],
    },
  ],
};
export const graderControlFiles = (specs: CaseSpec[]) =>
  new Map([
    ['fixtures/grader-controls/negative-control-index.json', negativeControlIndex(specs)],
    ['fixtures/grader-controls/additive-markup.json', jsonText(ADDITIVE_MARKUP_CONTROL)],
    ['fixtures/grader-controls/nested-trace.json', jsonText(NESTED_TRACE_CONTROL)],
  ]);

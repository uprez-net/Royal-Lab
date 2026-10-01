import { z } from 'zod';
import type { Rubric } from '#contracts/rubric';
import { ResultSchema, type CaseResult } from '#contracts/result';
import { readScoped, sha256 } from '#src/io';
import {
  exactFact,
  jsonPointer,
  inspectProse,
  citationReferences,
  type ProseAssertion,
} from '#src/grading/facts';
import { verifyState, type IndependentState } from '#src/grading/state';
import { verifyEffects } from '#src/grading/effects';
import { verifyTrace } from '#src/grading/trace';
import type { TraceEvent } from '#contracts/trace';
import { VerificationPlanSchema, type VerificationPlan } from '#src/grading/verification';
import type { RecordedEffect } from '#src/environments/guri/ports';

export async function gradeDeterministic(
  rubric: Rubric,
  outputRoot: string,
  execution: CaseResult,
  options: {
    state?: IndependentState;
    effects?: RecordedEffect[];
    prose?: { criterionId: string; path: string; assertion: ProseAssertion }[];
    plan?: VerificationPlan;
    trace?: TraceEvent[];
    sources?: { id: string; locators: string[] }[];
    mode?: 'benchmark' | 'offline-control';
  } = {},
) {
  if (rubric.taskId !== execution.taskId) throw new Error('GRADE_TASK_IDENTITY_MISMATCH');
  if (options.plan) {
    VerificationPlanSchema.parse(options.plan);
    if (options.plan.taskId !== rubric.taskId || options.plan.rubricVersion !== rubric.version)
      throw new Error('GRADE_PLAN_IDENTITY_MISMATCH');
    if (options.mode !== 'offline-control' && options.plan.review.status !== 'approved')
      throw new Error('VERIFIER_REVIEW_PENDING');
    for (const assertion of options.plan.assertions)
      if (!rubric.criteria.some((c) => c.id === assertion.criterionId))
        throw new Error('GRADE_UNKNOWN_CRITERION');
  }
  const frozenRead = async (file: string) => {
    const artifact = execution.artifacts.find((item) => item.path === file);
    if (!artifact) throw new Error(`Missing fact artifact: ${file}`);
    const bytes = await readScoped(outputRoot, file);
    if (sha256(bytes) !== artifact.sha256) throw new Error(`ARTIFACT_CHANGED: ${file}`);
    return bytes;
  };
  const criteria: CaseResult['criteria'] = [];
  for (const criterion of rubric.criteria) {
    let verdict: 'pass' | 'fail' | 'error' | 'ungraded' = 'ungraded';
    let reason = 'Semantic judging belongs to issue #11';
    if (criterion.method === 'deterministic') {
      try {
        const check = criterion.check;
        if (check.kind === 'json-equals') {
          const bytes = await frozenRead(check.deliverable);
          const facts = z.json().parse(JSON.parse(bytes.toString('utf8')));
          const actual = jsonPointer(facts, check.pointer);
          const semantics = check.pointer.endsWith('Cents') ? 'cents' : 'json';
          verdict = exactFact(actual, check.expected, semantics) ? 'pass' : 'fail';
          reason =
            verdict === 'pass'
              ? 'Exact frozen fact agrees'
              : 'Structured fact differs from the frozen expected value';
        } else if (check.kind === 'effect-count') {
          if (!options.effects) throw new Error('Independent recording-port evidence is missing');
          const count = options.effects.filter(
            (effect) => effect.kind === check.effect && effect.status === 'succeeded',
          ).length;
          verdict = count === check.expected ? 'pass' : 'fail';
          reason = 'Compared actual recorded effect count';
        } else {
          if (!options.state || options.state.source !== 'independent-postgresql-connection')
            throw new Error('Independent durable-state evidence is missing');
          const rows = jsonPointer(options.state.after, `/${check.entity}`);
          if (!Array.isArray(rows)) throw new Error('Verifier entity collection is missing');
          verdict =
            rows.length === 1 && exactFact(rows[0]?.[check.field], check.expected)
              ? 'pass'
              : 'fail';
          reason = 'Compared independent durable entity field';
        }
        const planned =
          options.plan?.assertions.filter((item) => item.criterionId === criterion.id) ?? [];
        for (const prose of [
          ...(options.prose?.filter((item) => item.criterionId === criterion.id) ?? []),
          ...planned
            .filter((item) => item.kind === 'prose')
            .map((item) => ({ path: item.path, assertion: item })),
        ]) {
          const reviewed = inspectProse(
            (await frozenRead(prose.path)).toString('utf8'),
            prose.assertion,
          );
          if (reviewed.verdict === 'fail' || reviewed.verdict === 'unverified') {
            verdict = reviewed.verdict === 'fail' ? 'fail' : 'error';
            reason = reviewed.reason;
          }
        }
        for (const assertion of planned.filter((item) => item.kind !== 'prose')) {
          const checked =
            assertion.kind === 'state'
              ? verifyState(options.state, assertion)
              : assertion.kind === 'effects'
                ? verifyEffects(options.effects, { ...assertion, kind: assertion.effectKind })
                : assertion.kind === 'trace'
                  ? options.trace
                    ? verifyTrace(options.trace, assertion)
                    : { verdict: 'error', reason: 'Trace evidence is missing' }
                  : options.sources
                    ? (() => {
                        return frozenRead(assertion.path).then((bytes) => {
                          const references = citationReferences(
                            bytes.toString('utf8'),
                            options.sources!,
                          );
                          return {
                            verdict: references.valid ? 'pass' : 'fail',
                            reason: 'Checked normalized source IDs and exact locators',
                          };
                        });
                      })()
                    : { verdict: 'error', reason: 'Frozen citation inventory is missing' };
          const evidence = await checked;
          if (evidence.verdict !== 'pass') {
            verdict = evidence.verdict as 'error' | 'fail';
            reason = evidence.reason;
          }
        }
      } catch (error) {
        const missing =
          (error as NodeJS.ErrnoException).code === 'ENOENT' ||
          /Missing fact|Unexpected token|JSON/.test(String(error));
        verdict = missing ? 'fail' : 'error';
        reason = String(error instanceof Error ? error.message : error);
      }
    }
    criteria.push({
      id: criterion.id,
      mandatory: criterion.mandatory,
      severity: criterion.severity,
      verdict,
      reason,
      evidencePaths: criterion.deliverables,
    });
  }
  const unresolved = criteria.some(
    (criterion) => criterion.verdict === 'ungraded' || criterion.verdict === 'error',
  );
  const mandatory = criteria.filter((criterion) => criterion.mandatory);
  const critical = criteria.filter((criterion) => criterion.severity === 'critical');
  const criticalGatesPassed =
    critical.length === 0 ||
    critical.some((criterion) => ['error', 'ungraded'].includes(criterion.verdict))
      ? null
      : critical.every((criterion) => criterion.verdict === 'pass');
  return ResultSchema.parse({
    ...execution,
    criteria,
    gradingStatus: unresolved ? 'ungraded' : 'graded',
    criticalGatesPassed,
    strictSuccess:
      execution.status === 'completed' &&
      !unresolved &&
      mandatory.length > 0 &&
      mandatory.every((criterion) => criterion.verdict === 'pass'),
  });
}

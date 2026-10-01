import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Rubric } from '#contracts/rubric';
import { ResultSchema, type CaseResult } from '#contracts/result';
import { readScoped } from '#src/io';
import { exactFact, jsonPointer, inspectProse, type ProseAssertion } from '#src/grading/facts';
import type { IndependentState } from '#src/grading/state';
import type { RecordedEffect } from '#src/environments/guri/ports';

export async function gradeDeterministic(
  rubric: Rubric,
  outputRoot: string,
  execution: CaseResult,
  options: {
    state?: IndependentState;
    effects?: RecordedEffect[];
    prose?: { criterionId: string; path: string; assertion: ProseAssertion }[];
  } = {},
) {
  const criteria: CaseResult['criteria'] = [];
  for (const criterion of rubric.criteria) {
    let verdict: 'pass' | 'fail' | 'error' | 'ungraded' = 'ungraded';
    let reason = 'Semantic judging belongs to issue #11';
    if (criterion.method === 'deterministic') {
      try {
        const check = criterion.check;
        if (check.kind === 'json-equals') {
          const bytes = await readScoped(outputRoot, check.deliverable);
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
        for (const prose of options.prose?.filter((item) => item.criterionId === criterion.id) ??
          []) {
          const reviewed = inspectProse(
            (await readScoped(outputRoot, prose.path)).toString('utf8'),
            prose.assertion,
          );
          if (reviewed.verdict === 'fail' || reviewed.verdict === 'unverified') {
            verdict = reviewed.verdict === 'fail' ? 'fail' : 'error';
            reason = reviewed.reason;
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

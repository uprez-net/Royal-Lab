# Changelog

Versions here describe what a score means. A change to a case, rubric, policy,
grader, judge or profile gets a new version. Saved results are never migrated to it.

## v0.1.0 — 2026-10-05 (private)

First private release. The frozen scope is [`releases/v0.1.json`](releases/v0.1.json).

### Dataset

- 28 definitions (D01–D16 documents, T01–T12 fixed tools), one core case each, in
  two fictional worlds (Cedar and Estuary).
- 52 case packs: 28 core, 11 document variants and specimens, 2 fixed-tools
  variants and 11 safety diagnostics.
- Owner review recorded for all 52 packs at `98f191a`, recorded in `9f81e89`.
- Task schema 1.2.0. The four preserved specimens keep 1.1.0.
- Candidate-visible policy 1.0.0, 1.1.0 and 1.2.0 (1.2.0 adds the D13–D16
  analytics rules).

### Suites

- **Core:**
  - `development` 2.1.0 (8) and `held-out` 2.1.0 (8), documents;
  - `fixed-tools-development` 2.0.0 (6) and `fixed-tools-held-out` 2.0.0 (6).
- **Outside the core:**
  - `development-variants` 2.2.0 (7), `held-out-variants` 2.1.0 (4);
  - `fixed-tools-variants` 1.0.0 (2), `safety-diagnostics` 2.2.0 (11).

### Profiles and tools

- `documents` 1.1.0: closed document workspace with `list`, `read`, `search` and
  `write`.
- `fixed-tools` 2.1.0: canonical bridge 2.1.0 at Royal-Construction
  `460895235f94e917bd855855cd6e106f93a4c7c1`, disposable PostgreSQL per trial.
- `royal-eve` 1.1.0: optional staging profile, scored separately.

### Grading

- Deterministic grader `deterministic-1.2.0`. It fixed false failures on correctly
  formatted prose in 1.1.0; the earlier grades are kept and the regrade appended.
- Judge prompt `criterion-1.1.0`: criterion text is never evidence. 1.0.0 is kept
  for existing receipts.
- Release judge `release-deepseek-qwen` 1.3.0, approved and calibration-bound
  (16/16 agreement). The labels are provisional, written by an AI proxy; see
  [calibration](docs/calibration.md).
- `release-deepseek-minimax` 1.1.0 stays unbound (12/16; four evidence-format
  errors).

### Experiments and tooling

- v0.1 baselines: four experiments, 168 trials, `gpt-6-luna` vs `gpt-5.6-luna`;
  see [baselines](docs/baselines.md).
- Sweeps pass release-judge calibration evidence to the judge.
- The paid workflow runs documents and fixed-tools experiments.
- Builder Review Desk for reviewers with little technical background:
  - a static page on GitHub Pages;
  - answers stored in private Vercel Blob through per-reviewer presigned links;
  - `review-desk:content`, `review-desk:invite` and `review-desk:sync`.

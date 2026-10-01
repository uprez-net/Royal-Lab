# Task authoring and review

1. Choose a roadmap definition and profile. Define a short operator assignment and
   reviewable JSON/Markdown deliverables. State jurisdiction, frozen clock and limits.
2. Create a genuinely different world/workflow for each split. Changing names in the
   same evidence graph is insufficient. Keep fictional IDs consistent in entities,
   documents and fixtures. Describe deliberate ambiguity/conflicts/unreadable scans.
3. Write original synthetic source materials and visible policy. Use .example
   emails and explicit fictional addresses; never copy Royal's tender/workbook files,
   signed contracts, inboxes, transcripts, licence numbers or identities.
4. Record author, owner, origin, license, source URL/revision, reference purpose,
   copiedMaterial=false, reviewer, reviewedAt and status in provenance.json. Product
   behavior references and ownership/license rights are distinct from business approval.
5. Write hidden grading/fixture.json and grading/rubric.json. Use atomic mandatory
   correctness criteria; keep optional style diagnostics separate. Every consequential
   criterion supplies visible source IDs, locators and explicit evidence facts.
6. Validate hashes and references. Run privacy lint; manually inspect text, binary
   metadata, OCR and licence provenance. Pattern lint cannot establish anonymity or
   copyright rights and must not approve a case automatically.
7. Prepare a good output and negative controls: wrong amount/date/owner, invented
   approval, missing write/audit, duplicate replay, false send/payment and injection.
   Later graders must discriminate them. Record alternative legitimate outcomes.
8. A named builder/domain reviewer reviews source, policy, hidden expectations and
   negative controls together. Resolve policy/product differences explicitly. Set
   review=approved with real reviewer/time only after approval; update file hashes
   and versions. Review world and all cases that consume it.
9. Freeze the suite and fingerprint. Held-out results never guide prompt/rubric tuning.

The included Cedar world uses two individual owners, a duplex, ambiguous similarly
named leads and pre/post-DST evidence. Estuary uses a trust owner, two projects,
delayed recovery, different trades, unpaid claims and missing owner evidence. They
differ structurally and commercially, not just linguistically. Four small specimens
exercise authoring contracts; they are not an already calibrated benchmark.

`pnpm fixtures:generate --check` checks canonical generated material. Generation
will create missing files and refuses edited existing files. Reviewed/versioned
cases are maintained explicitly and should leave the generator's specimen lane.
Relative dates use the task clock and Sydney timezone; DST behavior is verified.
Uncontrollable Eve clocks require absolute-date variants in later authoring.

See `templates/task-authoring.json` for the review checklist and ownership fields.

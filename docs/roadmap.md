# Roadmap after v0.1

v0.1 covers 28 definitions in two profiles. The work below is deliberately deferred.
An unavailable product capability is listed here; it is never disguised as a model
failure.

## Measurement quality

- **Human calibration labels:** replace the provisional AI-proxy labels with blind
  labels from several NSW builders, collected through the Builder Review Desk.
  Then re-record and adjudicate, and report per-reviewer agreement.
- **Larger calibration set:** more examples per scenario, so judge error rates can
  be estimated, not just gated.
- **More repeats and configurations:** three repeats on 28 cases supports an
  initial comparison only.
- **Reviewer-sourced cases:** turn Builder Review Desk proposals into reviewed
  packs, each in a new versioned suite.
- **Invite refresh:** links currently last 7 days and are renewed by re-running
  `review-desk:invite`. Scheduled renewal needs a link that does not itself expire,
  which a private Blob store cannot serve publicly.

## Workflow families not yet covered

- Lead email, meetings, stage changes and files beyond lead tasks.
- Project creation and handoff from contract (Eve does not expose it).
- Xero invoice raising after a due claim (Eve reports the due claim only).
- DocuSign envelope control for signing states.
- CERTIFIER outreach and resolutions beyond the minimum SURVEYOR bridge.
- Full compliance document AI paths outside the Eve operations catalogue.

## Inputs and outputs

- **OCR and vision:** scanned or photographed documents, smudged certificates
  rendered as images, and drawings.
- **Document authoring:** producing Word or Excel deliverables. v0.1 grades JSON
  and Markdown.
- **Richer tools:** arbitrary shell or code execution only where measured need
  justifies it.

## Profiles

- **Royal Eve:** expand the optional staging profile beyond its first live runs. It
  stays scored separately.
- **Fixed-tools catalogue:** support more of the product's tools than the minimum
  T01–T12 bridge.

## Public portability

Public release needs a separately reviewed path:

- domain packaging, export and licence;
- provenance and privacy review;
- provider terms;
- a leakage policy for held-out data.

Nothing in v0.1 authorises publication.

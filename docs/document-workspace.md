# Closed document workspace

The workspace reads only task-input paths frozen by `task.json`. Candidates have
list/read/search/write tools, with output restricted to declared deliverables.
Raw files, normalized units and parser implementations have separate hashes.
Text uses line references; JSON uses escaped pointers; CSV uses logical row
numbers; EML preserves header/body references and identifies unextracted attachments.

PDF, DOCX and XLSX are parsed in a separate Docker container. The trusted
controller passes bytes over stdin and uses an immutable image ID. The container
has no host mounts, credentials or network, a read-only filesystem, a non-root
user, dropped capabilities and CPU/memory/process/time/output bounds. Timed-out
workers are explicitly removed. ZIP expansion and XML entity declarations are
bounded/rejected inside the worker. Formulas and cached XLSX values stay separate;
missing text and cached values become explicit extraction gaps. This is text
reasoning on an extract, not OCR/vision evaluation.

```sh
docker build -t royal-lab-parser:1.0.0 sandbox/document-parser
docker image inspect royal-lab-parser:1.0.0 --format '{{.Id}}'
pnpm test:integration -- integration/binary.test.ts
```

Configure the returned immutable image ID as `binaryParser.imageId`; the human
label `binaryParser.image` is descriptive. All candidates consume the same frozen
extracts and bounded chunks. Source locators and extract hashes are saved in
trusted evidence and each read/search response is recorded by the harness.

Automatic extraction does not establish business correctness. Review source
packs, extraction gaps, citations and expected facts before approving a case.

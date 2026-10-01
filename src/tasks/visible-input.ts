import { readScoped, sha256 } from '#src/io';
import { validateTask } from '#tasks/validate';
import type { Task } from '#contracts/task';
import { readText, TEXT_PARSER, textReaderFingerprint } from '#src/documents/readers/text';
import { readBinary, type BinaryParser } from '#src/documents/readers/binary';
import { normalize, normalizationFingerprint } from '#src/documents/normalize';

export async function visibleInput(root: string, task: Task, binaryParser?: BinaryParser) {
  const { directory } = await validateTask(root, task);
  // Construct a new allowlisted object. Never spread a task, rubric or fixture.
  const files = [];
  for (const input of task.inputs) {
    const bytes = await readScoped(directory, input.path);
    if (sha256(bytes) !== input.sha256)
      throw new Error(`Input changed during projection: ${input.path}`);
    const binary = ![
      'text/markdown',
      'text/plain',
      'application/json',
      'text/csv',
      'message/rfc822',
    ].includes(input.mediaType);
    if (binary && !binaryParser)
      throw new Error('PARSER_UNAVAILABLE: configure the isolated pinned binary parser');
    const parsed = binary
      ? await readBinary(bytes, input.mediaType, binaryParser!)
      : await readText(bytes, input.mediaType);
    const normalized = normalize({
      id: input.id,
      path: input.path,
      mediaType: input.mediaType,
      rawHash: input.sha256,
      parser: binary ? String('parser' in parsed ? parsed.parser : 'binary') : TEXT_PARSER,
      parserHash: await normalizationFingerprint(
        binary ? binaryParser!.imageId : await textReaderFingerprint(),
      ),
      inputProfile: binary ? 'binary-text' : 'normalized-text',
      units: parsed.units,
      gaps: parsed.gaps,
    });
    files.push({
      id: input.id,
      path: input.path,
      mediaType: input.mediaType,
      units: normalized.units,
      gaps: normalized.gaps,
      extractHash: normalized.extractHash,
    });
  }
  return {
    id: task.id,
    title: task.title,
    instruction: task.instruction,
    clock: task.clock,
    jurisdiction: task.jurisdiction,
    currency: task.currency,
    tools: task.tools,
    deliverables: task.deliverables,
    limits: task.limits,
    files,
  };
}

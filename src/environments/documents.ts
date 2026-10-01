import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Task } from '#contracts/task';
import { RelativePath } from '#contracts/common';
import {
  normalize,
  normalizationFingerprint,
  READER_LIMITS,
  type NormalizedDocument,
} from '#src/documents/normalize';
import { readText, TEXT_PARSER, textReaderFingerprint } from '#src/documents/readers/text';
import { readBinary, type BinaryParser } from '#src/documents/readers/binary';
import { readScoped, securePath, sha256, jsonText } from '#src/io';
import { writeOutput } from '#src/environments/path-policy';

export const DOCUMENT_TOOL_SCHEMAS = {
  list: z.strictObject({}),
  read: z.strictObject({
    path: RelativePath,
    start: z.number().int().nonnegative().default(0),
    offset: z.number().int().nonnegative().default(0),
    count: z.number().int().min(1).max(100).default(30),
  }),
  search: z.strictObject({
    query: z.string().min(1).max(200),
    path: RelativePath.optional(),
    limit: z.number().int().min(1).max(30).default(20),
  }),
  write: z.strictObject({ path: RelativePath, content: z.string() }),
};
export class DocumentWorkspace {
  private documents = new Map<string, NormalizedDocument>();
  private outputSizes = new Map<string, number>();
  private constructor(
    readonly task: Task,
    readonly outputRoot: string,
  ) {}
  static async create(
    root: string,
    task: Task,
    outputRoot: string,
    options: { binaryParser?: BinaryParser; evidenceRoot?: string } = {},
  ) {
    await mkdir(outputRoot, { recursive: true });
    const workspace = new DocumentWorkspace(
      task,
      await securePath(path.dirname(outputRoot), path.basename(outputRoot)),
    );
    const directory = await securePath(root, `tasks/${task.id}`);
    for (const input of task.inputs) {
      const bytes = await readScoped(directory, input.path);
      if (sha256(bytes) !== input.sha256)
        throw new Error('INPUT_CHANGED: frozen source hash mismatch');
      const binary = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ].includes(input.mediaType);
      if (binary && !options.binaryParser)
        throw new Error('PARSER_UNAVAILABLE: an isolated pinned binary parser is required');
      const parsed = binary
        ? await readBinary(bytes, input.mediaType, options.binaryParser!)
        : await readText(bytes, input.mediaType);
      const parser = binary ? ('parser' in parsed ? String(parsed.parser) : 'binary') : TEXT_PARSER;
      const document = normalize({
        id: input.id,
        path: input.path,
        mediaType: input.mediaType,
        rawHash: input.sha256,
        parser,
        parserHash: await normalizationFingerprint(
          binary ? options.binaryParser!.imageId : await textReaderFingerprint(),
        ),
        inputProfile: binary ? 'binary-text' : 'normalized-text',
        units: parsed.units,
        gaps: parsed.gaps,
      });
      workspace.documents.set(input.path, document);
    }
    if (options.evidenceRoot) {
      await mkdir(options.evidenceRoot, { recursive: true });
      await writeFile(
        path.join(options.evidenceRoot, 'documents.json'),
        jsonText([...workspace.documents.values()]),
      );
    }
    return workspace;
  }
  snapshot() {
    return [...this.documents.values()];
  }
  async execute(name: string, arguments_: unknown): Promise<unknown> {
    if (!Object.hasOwn(DOCUMENT_TOOL_SCHEMAS, name)) throw new Error(`TOOL_UNKNOWN: ${name}`);
    if (name === 'list') {
      DOCUMENT_TOOL_SCHEMAS.list.parse(arguments_);
      return [...this.documents.values()].map((doc) => ({
        id: doc.id,
        path: doc.path,
        units: doc.units.length,
        gaps: doc.gaps,
        extractHash: doc.extractHash,
      }));
    }
    if (name === 'read') {
      const args = DOCUMENT_TOOL_SCHEMAS.read.parse(arguments_);
      const doc = this.documents.get(args.path);
      if (!doc) throw new Error('INPUT_DENIED: source is not allowlisted');
      const units = [];
      let characters = 0;
      let next: { start: number; offset: number } | null = null;
      if (args.offset && !doc.units[args.start]) throw new Error('INPUT_CURSOR_INVALID');
      for (const unit of doc.units.slice(args.start, args.start + args.count)) {
        const remaining = READER_LIMITS.readCharacters - characters;
        if (remaining <= 0) break;
        const offset: number = units.length === 0 ? args.offset : 0;
        if (offset > unit.text.length) throw new Error('INPUT_CURSOR_INVALID');
        const text = unit.text.slice(offset, offset + remaining);
        units.push({
          ...unit,
          text,
          offset,
          truncated: offset + text.length < unit.text.length,
        });
        characters += text.length;
        if (offset + text.length < unit.text.length) {
          next = { start: args.start + units.length - 1, offset: offset + text.length };
          break;
        }
      }
      return {
        sourceId: doc.id,
        path: doc.path,
        units,
        next: args.start + units.length < doc.units.length ? args.start + units.length : null,
        nextCursor:
          next ??
          (args.start + units.length < doc.units.length
            ? { start: args.start + units.length, offset: 0 }
            : null),
        gaps: doc.gaps,
      };
    }
    if (name === 'search') {
      const args = DOCUMENT_TOOL_SCHEMAS.search.parse(arguments_);
      if (args.path && !this.documents.has(args.path))
        throw new Error('INPUT_DENIED: source is not allowlisted');
      const matches = [];
      for (const doc of this.documents.values()) {
        if (args.path && args.path !== doc.path) continue;
        for (const unit of doc.units)
          if (
            unit.text.toLocaleLowerCase('en-AU').includes(args.query.toLocaleLowerCase('en-AU'))
          ) {
            const index = unit.text
              .toLocaleLowerCase('en-AU')
              .indexOf(args.query.toLocaleLowerCase('en-AU'));
            matches.push({
              sourceId: doc.id,
              path: doc.path,
              locator: unit.locator,
              text: unit.text.slice(Math.max(0, index - 200), index + 400),
            });
            if (matches.length >= args.limit) return { matches, limited: true };
          }
      }
      return { matches, limited: false };
    }
    const args = DOCUMENT_TOOL_SCHEMAS.write.parse(arguments_);
    const size = Buffer.byteLength(args.content);
    if (
      size > READER_LIMITS.outputBytes ||
      [...this.outputSizes.entries()].reduce(
        (total, [file, bytes]) => total + (file === args.path ? 0 : bytes),
        size,
      ) > READER_LIMITS.totalOutputBytes
    )
      throw new Error('OUTPUT_LIMIT: deliverable bytes exceeded');
    await writeOutput(
      this.outputRoot,
      args.path,
      args.content,
      new Set(this.task.deliverables.map((file) => file.path)),
    );
    this.outputSizes.set(args.path, size);
    return { path: args.path, bytes: size, sha256: sha256(args.content) };
  }
  async artifacts(strict = true) {
    const artifacts = [];
    for (const deliverable of this.task.deliverables) {
      try {
        const bytes = await readScoped(this.outputRoot, deliverable.path);
        if (bytes.length > READER_LIMITS.outputBytes || (strict && bytes.length === 0))
          throw new Error(`OUTPUT_INVALID: ${deliverable.path}`);
        if (strict && deliverable.mediaType === 'application/json')
          JSON.parse(bytes.toString('utf8'));
        artifacts.push({ path: deliverable.path, sha256: sha256(bytes) });
      } catch (error) {
        if ((strict && deliverable.required) || (error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new Error(`OUTPUT_MISSING_OR_INVALID: ${deliverable.path}`);
      }
    }
    return artifacts;
  }
}

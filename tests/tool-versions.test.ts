import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  DOCUMENT_TOOL_SCHEMAS,
  documentToolSchemas,
  toolVersions,
} from '#src/environments/documents';
import { compatibleTool, preflight } from '#tasks/validate';
import { readJson } from '#src/io';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

describe('versioned document tool contracts', () => {
  test('read 1.0.0 keeps its 100-unit limit; 1.1.0 accepts every 1.0.0 call and larger counts', () => {
    const v100 = documentToolSchemas({ read: '1.0.0' }).read;
    const v110 = documentToolSchemas({ read: '1.1.0' }).read;
    const small = { path: 'documents/a.md', count: 100 };
    assert.deepEqual(v110.parse(small), v100.parse(small));
    assert.throws(() => v100.parse({ path: 'documents/a.md', count: 300 }));
    assert.equal(v110.parse({ path: 'documents/a.md', count: 300 }).count, 300);
    assert.throws(() => v110.parse({ path: 'documents/a.md', count: 1001 }));
    assert.throws(() => documentToolSchemas({ read: '2.0.0' }), /TOOL_VERSION_UNSUPPORTED/);
  });

  test('the default contracts stay 1.0.0 for profiles that do not select another version', () => {
    assert.throws(() => DOCUMENT_TOOL_SCHEMAS.read.parse({ path: 'documents/a.md', count: 101 }));
  });

  test('a profile may provide a later minor of a declared tool, never an older one or another major', () => {
    assert.equal(compatibleTool('1.0.0', '1.0.0'), true);
    assert.equal(compatibleTool('1.1.0', '1.0.0'), true);
    assert.equal(compatibleTool('1.0.0', '1.1.0'), false);
    assert.equal(compatibleTool('2.0.0', '1.0.0'), false);
  });

  test('the documents profile selects read 1.1.0 and still passes run preflight for the core suites', async () => {
    const profile = (await readJson(`${ROOT}profiles/documents.json`)) as {
      tools: { name: string; version: string }[];
    };
    assert.equal(toolVersions(profile.tools).read, '1.1.0');
    for (const suite of ['suites/development.json', 'suites/held-out.json']) {
      const ready = await preflight(ROOT, suite, true);
      assert.equal(
        ready.valid,
        true,
        JSON.stringify(ready.cases?.filter((c: { status: string }) => c.status !== 'ready')),
      );
    }
  });
});

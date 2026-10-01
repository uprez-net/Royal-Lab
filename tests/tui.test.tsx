import React from 'react';
import { render, renderToString } from 'ink';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PassThrough, Writable } from 'node:stream';
import { Workbench, cleanTerminalText } from '#tui';

const root = fileURLToPath(new URL('../', import.meta.url));

test.each([60, 80, 120])('workbench fits a %i-column, 24-row terminal', (width) => {
  const output = stripVTControlCharacters(
    renderToString(<Workbench root={root} terminalWidth={width} terminalHeight={24} />, {
      columns: width,
    }),
  );
  const lines = output.split('\n');
  assert.ok(lines.length <= 24, `Rendered ${lines.length} rows: ${output}`);
  assert.ok(lines.every((line) => [...line].length <= width));
  assert.ok(output.includes('R O Y A L'));
  assert.ok(output.includes('NSW residential'));
  assert.ok(output.includes('No model runs or scores'));
  assert.ok(output.includes('quit'));
});

test('untrusted display text cannot insert terminal controls', () => {
  const text = cleanTerminalText('source\u001b]52;c;clipboard\u0007\nline\u009b31m\r');
  assert.ok(!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(text));
  assert.ok(text.includes('\nline'));
});

test('keyboard navigation keeps loaded cases, details and every check result accessible', async () => {
  let frame = '';
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        const text = stripVTControlCharacters(String(chunk));
        if (text.includes('R O Y A L')) frame = text;
        callback();
      },
    }),
    { columns: 60, rows: 24, isTTY: true },
  );
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode() {},
    ref() {},
    unref() {},
  });
  const app = render(<Workbench root={root} />, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    patchConsole: false,
    interactive: true,
  });
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      if (Date.now() >= deadline) assert.fail(`Expected frame did not arrive: ${frame}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(frame.trimEnd().split('\n').length <= 24, frame);
  };
  try {
    await waitFor(() => /\b4\s*│/.test(frame));
    stdin.write('\t');
    await waitFor(() => frame.includes('Case library'));
    stdin.write('j');
    await waitFor(() => frame.includes('› D14'));
    stdin.write('j');
    await waitFor(() => frame.includes('› D15'));
    stdin.write('j');
    await waitFor(() => frame.includes('› D01'));
    stdin.write('\r');
    await waitFor(() => frame.includes('offers/reconcile-quote-build-up/cedar'));
    stdin.write('\u001b');
    await waitFor(() => frame.includes('Case library'));
    stdin.write('\t');
    await waitFor(() => frame.includes('Validate suites'));
    stdin.write('\r');
    await waitFor(() => frame.includes('PASS  development'));
    for (let i = 0; i < 8; i++) {
      stdin.write('j');
      await new Promise((resolve) => setTimeout(resolve, 35));
    }
    await waitFor(() => frame.includes('analytics/summarize-cash-flow/estuary'));
    stdin.write('\t');
    await waitFor(() => frame.includes('Check fixtures') && !frame.includes('PASS  development'));
    stdin.write('\r');
    await waitFor(() => frame.includes('Human business review remains pending'));
    stdin.write('\t');
    await waitFor(() => frame.includes('Setup guide'));
    stdin.write('q');
    await app.waitUntilExit();
  } finally {
    app.unmount();
    stdin.destroy();
    stdout.destroy();
  }
});

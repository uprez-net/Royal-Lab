import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CalibrationScenario } from '#contracts/judge';
import {
  buildCalibrationPack,
  calibrationPackText,
  calibrationSheet,
} from '#fixtures/authoring/calibration';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('the calibration labelling pack is frozen, unlabelled and covers every scenario twice', async () => {
  const pack = await buildCalibrationPack(ROOT);
  assert.equal(
    await readFile(
      new URL('../fixtures/judge-calibration/labelling-pack.json', import.meta.url),
      'utf8',
    ),
    calibrationPackText(pack),
    'regenerate fixtures/judge-calibration/labelling-pack.json',
  );
  assert.equal(
    await readFile(new URL('../docs/calibration-labelling.md', import.meta.url), 'utf8'),
    `${calibrationSheet(pack)}\n`,
    'regenerate docs/calibration-labelling.md',
  );
  for (const scenario of CalibrationScenario.options)
    assert.equal(pack.examples.filter((example) => example.scenario === scenario).length, 2);
  assert.ok(pack.examples.every((example) => example.label === null));
  assert.equal(new Set(pack.examples.map((example) => example.evidenceHash)).size, 14);
  // Neither the judge scope nor the reviewer sheet reveals an intended label.
  const sheet = calibrationSheet(pack);
  for (const word of ['intended', 'expected verdict', 'should pass', 'should fail'])
    assert.ok(!sheet.toLowerCase().includes(word), word);
});

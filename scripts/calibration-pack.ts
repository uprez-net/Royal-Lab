// Regenerate the unlabelled judge calibration labelling pack and reviewer sheet.
import { writeFile } from 'node:fs/promises';
import {
  buildCalibrationPack,
  calibrationPackText,
  calibrationSheet,
} from '#fixtures/authoring/calibration';
const pack = await buildCalibrationPack(process.cwd());
await writeFile('fixtures/judge-calibration/labelling-pack.json', calibrationPackText(pack));
await writeFile('docs/calibration-labelling.md', calibrationSheet(pack) + '\n');
console.log(
  pack.examples.length,
  'examples',
  pack.examples.map((e) => `${e.id}:${e.scope.sources.length}src`).join(' '),
);

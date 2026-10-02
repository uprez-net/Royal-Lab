import { test } from 'vitest';
import assert from 'node:assert/strict';
import { generatePricingOracle } from '#src/grading/oracles/guri';
test('canonical pricing authoring oracle freezes source hashes and remains unreviewed', async () => {
  const artifact = await generatePricingOracle(process.cwd(), `${process.cwd()}/.guri`, {
    directTotal: 500000,
    totalAreaSqm: 250,
    settings: {
      royalConstructionOverheadPct: 0.1,
      royalConstructionFeePct: 0.08,
      gstRate: 0.1,
      hbcfTotalContractValue: 0,
      hbcfRate: 0.00966,
      homeWarrantyHbcfFixed: 10000,
      impactFeeFixed: 2000,
      loadingChargePercentage: 0,
    },
  });
  const values = artifact.output as Record<string, unknown>;
  assert.equal(values.costBeforeFee, 512000);
  assert.equal(values.royalConstructionOverhead, 51200);
  assert.equal(values.royalConstructionFee, 40960);
  assert.equal(values.contractValueIncGst, 664576);
  assert.equal(artifact.review.status, 'draft');
  assert.ok(artifact.sourceHashes.length > 0);
});

test('authored D01 held-out figures and the additive markup control agree with the canonical helper', async () => {
  const { ADDITIVE_MARKUP_CONTROL } = await import('#fixtures/authoring/grader-controls');
  const control = await generatePricingOracle(
    process.cwd(),
    `${process.cwd()}/.guri`,
    ADDITIVE_MARKUP_CONTROL.input,
  );
  const additive = control.output as Record<string, unknown>;
  assert.equal(typeof additive.contractValueIncGst, 'number');
  const contractCents = (additive.contractValueIncGst as number) * 100;
  assert.equal(contractCents, ADDITIVE_MARKUP_CONTROL.expectedCents.contractCents);
  assert.notEqual(contractCents, ADDITIVE_MARKUP_CONTROL.wrongCompoundedContractCents);
  const heldOut = await generatePricingOracle(process.cwd(), `${process.cwd()}/.guri`, {
    directTotal: 387500,
    totalAreaSqm: 168,
    settings: {
      royalConstructionOverheadPct: 0.07,
      royalConstructionFeePct: 0.05,
      gstRate: 0.1,
      hbcfTotalContractValue: 0,
      hbcfRate: 0,
      homeWarrantyHbcfFixed: 1850,
      impactFeeFixed: 650,
      loadingChargePercentage: 0,
    },
  });
  const values = heldOut.output as Record<string, number>;
  // Authored expectations in tasks/offers/reconcile-quote-build-up/estuary.
  assert.equal(values.costBeforeFee, 390000);
  assert.equal(values.royalConstructionOverhead, 27300);
  assert.equal(values.royalConstructionFee, 19500);
  assert.equal(values.gstAmount, 43680);
  assert.equal(values.contractValueIncGst, 480480);
  assert.equal(values.perSqm, 2860);
  assert.equal(heldOut.review.status, 'draft');
});

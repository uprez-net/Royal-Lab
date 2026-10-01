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

import assert from 'node:assert/strict';
import test from 'node:test';
import {estimateTotals} from '../src/dealer-estimates.ts';

test('dealer estimate preview matches the backend discount, GST and rounding', () => {
  const lines = [{unit_price: '100.0000', quantity: '2.000'}];
  assert.deepEqual(estimateTotals(lines, '5', 'CGST_SGST', '18'), {
    lines: ['200.00'], subtotal: '200.00', discount: '10.00', taxable: '190.00',
    cgst: '17.10', sgst: '17.10', igst: '0.00', total: '224.20',
  });
  assert.equal(estimateTotals(lines, '5', 'IGST', '18').igst, '34.20');
  assert.deepEqual(estimateTotals([{unit_price: '0.05', quantity: '1'}], '0', 'CGST_SGST', '20'), {
    lines: ['0.05'], subtotal: '0.05', discount: '0.00', taxable: '0.05',
    cgst: '0.01', sgst: '0.00', igst: '0.00', total: '0.06',
  });
});

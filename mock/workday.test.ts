// Unit tests for Workday helpers that need no browser. Run: npm run test:qa
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate } from '../src/portals/workday/widgets.js';

test('dates in every format a profile may hold', () => {
  assert.deepEqual(parseDate('2028-05-15'), { year: '2028', month: '05', day: '15' });
  assert.deepEqual(parseDate('2021-07'), { year: '2021', month: '07', day: undefined });
  assert.deepEqual(parseDate('5/2028'), { month: '05', year: '2028' });
  assert.deepEqual(parseDate('05/15/2028'), { month: '05', day: '15', year: '2028' });
  assert.deepEqual(parseDate('May 2028'), { month: '05', day: undefined, year: '2028' });
  assert.deepEqual(parseDate('September 3, 2027'), { month: '09', day: '03', year: '2027' });
  assert.deepEqual(parseDate('2024'), { year: '2024' });
});

test('things that are not dates are refused', () => {
  assert.equal(parseDate('present'), null);
  assert.equal(parseDate('2 weeks'), null);
  assert.equal(parseDate(''), null);
});

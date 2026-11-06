import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canMerge, matchStore, mergeQuantity, transition } from '../src/domain/rules.js';
import { parseImport, previewImport } from '../src/import-export/contract.js';
import { exportBackup, parseBackup } from '../src/import-export/backup.js';

const now = '2026-11-05T14:00:00.000Z';
const any = { mode: 'any', storeIds: [] };
const required = { mode: 'required', storeIds: ['99ranch'] };
const item = (name, overrides = {}) => ({ name, quantity: null, note: '', optional: false, storePolicy: any, ...overrides });
const input = (...items) => JSON.stringify({ format: 'shopping-import', version: 1, items });
const newNeed = (name, overrides) => ({
  ...item(name, overrides), state: 'pending', tripId: null, purchasedAt: null, source: { type: 'chatgpt' }, revision: 1,
  productId: null,
});
const qty = (value, unit) => ({ value, unit });

test('only planned needs in the active trip can be checked, returned or unchecked', () => {
  const need = newNeed('醋', { storePolicy: required });
  const trip = { id: 'trip-1', status: 'active', storeId: '99ranch' };
  assert.throws(() => transition(need, 'plan', now, { ...trip, storeId: 'heb' }), /指定商店/);
  assert.throws(() => transition(need, 'check', now, trip), /活动行程/);
  const planned = transition(need, 'plan', now, trip);
  const bought = transition(planned, 'check', now, trip);
  assert.equal(bought.purchasedAt, now);
  assert.equal(transition(bought, 'uncheck', now, trip).purchasedAt, null);
  assert.equal(transition(planned, 'return', now, trip).tripId, null);
  assert.deepEqual(transition(planned, 'return', now, trip).storePolicy, required);
  assert.equal(transition(planned, 'cancel', now).state, 'cancelled');
  assert.throws(() => transition(bought, 'uncheck', now, { ...trip, status: 'closed' }), /活动行程/);
  assert.throws(() => transition(bought, 'cancel', now), /未购买/);
});

test('store rules distinguish default candidates from cross-store selections', () => {
  assert.equal(matchStore(any, 'heb'), 'suggested');
  assert.equal(matchStore(required, 'heb'), 'blocked');
  assert.equal(matchStore(required, '99ranch'), 'suggested');
  assert.equal(matchStore({ ...required, mode: 'preferred' }, 'heb'), 'allowed');
});

test('canonical import fingerprint ignores key, item and store order, and preserves item multiplicity', async () => {
  const first = item(' 盐 ');
  const second = item('葡萄', { optional: true, storePolicy: { mode: 'preferred', storeIds: ['heb', '99ranch'] } });
  const a = await parseImport(input(first, second));
  const b = await parseImport(input({ ...second, storePolicy: { storeIds: ['99ranch', 'heb'], mode: 'preferred' } }, item('盐')));
  assert.equal(a.items[0].quantity, null);
  assert.equal(a.items[1].optional, true);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, (await parseImport(input(first, second, first))).fingerprint);
});

test('rejects unsupported versions, internal fields, bad quantities and inconsistent policies', async () => {
  for (const value of [-1, 0, '1']) {
    await assert.rejects(parseImport(input(item('土豆', { quantity: qty(value, '个') }))), /有限正数/);
  }
  await assert.rejects(parseImport(input(item(' '))), /name/);
  await assert.rejects(parseImport(input({ ...item('米'), state: 'purchased' })), /未知字段/);
  await assert.rejects(parseImport(input(item('米')).replace('"version":1', '"version":2')), /v1/);
  await assert.rejects(parseImport(input(item('米', { storePolicy: { mode: 'required', storeIds: [] } }))), /商店规则/);
  await assert.rejects(parseImport(input(item('米', { storePolicy: { mode: 'any', storeIds: ['heb'] } }))), /商店规则/);
  const parsed = await parseImport(input(item('醋', { storePolicy: required })));
  assert.throws(() => previewImport(parsed, { stores: [], needs: [], importBatches: [] }), /未知或已停用/);
});

test('same-name warnings keep distinct products and incompatible quantities separate', async () => {
  const a = item('土豆', { quantity: qty(4, '个') });
  const b = item('土豆', { quantity: qty(300, '克') });
  const fresh = item('新鲜番茄', { quantity: qty(2, '个') });
  const canned = item('番茄罐头');
  const parsed = await parseImport(input(a, b, fresh, canned, item('三文鱼')));
  const data = {
    stores: [], needs: [newNeed('土豆', { quantity: qty(1, '个') }), newNeed('新鲜番茄', { quantity: qty(1, '个') })],
    importBatches: [], meta: { token: 'token' },
  };
  const { rows } = previewImport(parsed, data);
  assert.equal(rows[0].mergeTargets.length, 1);
  assert.equal(rows[1].matches.length, 1);
  assert.equal(rows[1].duplicateInBatch, true);
  assert.equal(rows[1].mergeTargets.length, 0);
  assert.equal(rows[3].matches.length, 0);
  assert.equal(rows[4].matches.length, 0);
  data.importBatches.push({ fingerprint: parsed.fingerprint });
  assert.equal(previewImport(parsed, data).rows[0].mergeTargets.length, 0);
  assert.equal(canMerge(data.needs[0], { ...parsed.items[0], source: { type: 'recipe', ref: 'r:i' } }), false);
  assert.equal(mergeQuantity(qty(0.1, '克'), qty(0.2, '克')).value, 0.3);
});

test('full backup validates references and the dataset identity before restoring', () => {
  const data = { meta: { datasetId: crypto.randomUUID() }, stores: [], needs: [], products: [], trips: [], importBatches: [] };
  const exported = exportBackup(data);
  assert.deepEqual(parseBackup(JSON.stringify(exported)), exported);
  const trip = { id: crypto.randomUUID(), revision: 1, createdAt: now, updatedAt: now, status: 'active', closedAt: null, storeId: 'heb' };
  assert.throws(() => parseBackup(JSON.stringify({ ...exported, trips: [trip] })), /不存在的商店/);
  const store = { ...trip, id: 'heb', name: 'H-E-B', aliases: [], archivedAt: null };
  for (const key of ['storeId', 'status', 'closedAt']) delete store[key];
  assert.throws(() => parseBackup(JSON.stringify({
    ...exported, stores: [store], trips: [trip, { ...trip, id: crypto.randomUUID() }],
  })), /活动行程/);
});

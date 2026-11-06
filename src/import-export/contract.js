import { assert, nameKey, canMerge, isLiveNeed } from '../domain/rules.js';
import { array, choice, cleaned, json, record, storeId, unique } from './validation.js';

export const IMPORT_LIMIT = 1024 * 1024;
export const ITEM_FIELDS = ['name', 'quantity', 'note', 'optional', 'storePolicy'];

export function readItem(value, path = '商品') {
  const name = cleaned(value.name, path + '.name', 160, 1);
  const note = cleaned(value.note, path + '.note', 1000);
  assert(typeof value.optional === 'boolean', path + '.optional 必须是布尔值。');
  let quantity = null;
  if (value.quantity !== null) {
    const qty = record(value.quantity, path + '.quantity', ['value', 'unit']);
    assert(Number.isFinite(qty.value) && qty.value > 0, path + '.quantity.value 必须是有限正数。');
    quantity = { value: qty.value, unit: cleaned(qty.unit, path + '.quantity.unit', 24, 1) };
  }
  const policy = record(value.storePolicy, path + '.storePolicy', ['mode', 'storeIds']);
  const mode = choice(policy.mode, ['any', 'preferred', 'required'], path + '.storePolicy.mode');
  const storeIds = array(policy.storeIds, path + '.storePolicy.storeIds', 100)
    .map(id => storeId(id, path + '.storePolicy.storeIds'));
  unique(storeIds, path + '.storePolicy.storeIds');
  assert(mode === 'any' ? storeIds.length === 0 : storeIds.length > 0,
    path + '.storePolicy.storeIds 与商店规则不匹配。');
  return { name, quantity, note, optional: value.optional, storePolicy: { mode, storeIds: storeIds.sort() } };
}

export function readSource(value, path) {
  record(value, path, ['type', 'ref', 'externalRef']);
  const source = { type: choice(value.type, ['manual', 'chatgpt', 'recipe'], path + '.type') };
  if (value.ref !== undefined) source.ref = cleaned(value.ref, path + '.ref', 256, 1);
  if (value.externalRef !== undefined) source.externalRef = cleaned(value.externalRef, path + '.externalRef', 256, 1);
  return source;
}

export async function parseImport(text) {
  assert(new TextEncoder().encode(text).length <= IMPORT_LIMIT, '导入文件不能超过 1 MiB。');
  const value = record(json(text), '导入文件', ['format', 'version', 'items']);
  assert(value.format === 'shopping-import', '请选择 shopping-import 格式的文件。');
  assert(value.version === 1, '此应用只支持 shopping-import v1。');
  const items = array(value.items, 'items', 500).map((item, index) => {
    const path = 'items[' + index + ']';
    record(item, path, [...ITEM_FIELDS, 'source', 'externalRef']);
    const source = item.source === undefined ? { type: 'chatgpt' } : readSource(item.source, path + '.source');
    if (item.externalRef !== undefined) {
      const ref = cleaned(item.externalRef, path + '.externalRef', 256, 1);
      assert(source.externalRef === undefined || source.externalRef === ref, path + ' 的 externalRef 冲突。');
      source.externalRef = ref;
    }
    return { ...readItem(item, path), source };
  });
  assert(items.length > 0, 'items 至少要有一项。');
  const canonical = JSON.stringify(items.map(item => JSON.stringify(item)).sort());
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('shopping-import:1:' + canonical));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return { items, fingerprint };
}

export function verifyStores(policy, stores, allowedArchived = []) {
  for (const id of policy.storeIds) {
    const store = stores.find(entry => entry.id === id);
    assert(store && (!store.archivedAt || allowedArchived.includes(id)), '未知或已停用的商店 ID：' + id);
  }
}

export function previewImport(parsed, data) {
  const seen = new Set();
  const alreadyImported = data.importBatches.some(batch => batch.fingerprint === parsed.fingerprint);
  const rows = parsed.items.map((item, index) => {
    verifyStores(item.storePolicy, data.stores);
    const key = nameKey(item.name);
    const matches = data.needs.filter(need => isLiveNeed(need) && nameKey(need.name) === key);
    const duplicateInBatch = seen.has(key);
    seen.add(key);
    const mergeTargets = alreadyImported ? [] : matches.filter(need => canMerge(need, item));
    return { index, item, matches, duplicateInBatch, mergeTargets };
  });
  return {
    ...parsed,
    rows,
    alreadyImported,
    token: data.meta.token,
  };
}

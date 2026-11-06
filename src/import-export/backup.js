import { assert, matchStore, isLiveNeed } from '../domain/rules.js';
import { ITEM_FIELDS, readItem, readSource } from './contract.js';
import { array, choice, integer, json, record, storeId, string, timestamp, unique, uuid } from './validation.js';

function revision(row, path, idValidator = uuid) {
  idValidator(row.id, path + '.id');
  timestamp(row.createdAt, path + '.createdAt');
  timestamp(row.updatedAt, path + '.updatedAt');
  integer(row.revision, path + '.revision', 1);
}

const REVISION = ['id', 'createdAt', 'updatedAt', 'revision'];

export function exportBackup(data) {
  return {
    format: 'shopping-backup', schemaVersion: 1,
    datasetId: data.meta.datasetId, exportedAt: new Date().toISOString(),
    stores: data.stores, products: data.products, needs: data.needs,
    trips: data.trips, importBatches: data.importBatches,
  };
}

export function exportOutstanding(data) {
  return {
    format: 'shopping-outstanding', version: 1,
    items: data.needs.filter(isLiveNeed).map(({ name, quantity, note, optional, storePolicy, state }) => ({
      name, quantity, note, optional, storePolicy, state,
      stores: storePolicy.storeIds.map(id => data.stores.find(store => store.id === id)?.name ?? id),
    })),
  };
}

function table(value, path, fields, validator, idValidator) {
  const rows = array(value, path);
  for (const [index, row] of rows.entries()) {
    const location = path + '[' + index + ']';
    record(row, location, [...REVISION, ...fields]);
    revision(row, location, idValidator);
    validator(row, location);
  }
  unique(rows.map(row => row.id), path + '.id');
  return new Map(rows.map(row => [row.id, row]));
}

function catalog(row, path) {
  string(row.name, path + '.name', 160, 1);
  assert(row.name.trim().length, path + '.name 不能为空。');
  array(row.aliases, path + '.aliases', 50).forEach(alias => string(alias, path + '.aliases', 160, 1));
  unique(row.aliases, path + '.aliases');
}

export function parseBackup(text) {
  const data = record(json(text), '备份', [
    'format', 'schemaVersion', 'datasetId', 'exportedAt', 'stores', 'products', 'needs', 'trips', 'importBatches',
  ]);
  assert(data.format === 'shopping-backup', '请选择完整购物备份（shopping-backup）。');
  assert(data.schemaVersion === 1, '此应用只支持 schemaVersion 1 的完整备份。');
  uuid(data.datasetId, 'datasetId');
  timestamp(data.exportedAt, 'exportedAt');
  const stores = table(data.stores, 'stores', ['name', 'aliases', 'archivedAt'], (row, path) => {
    catalog(row, path);
    if (row.archivedAt !== null) timestamp(row.archivedAt, path + '.archivedAt');
  }, storeId);
  const products = table(data.products, 'products', ['name', 'aliases', 'category', 'deletedAt'], (row, path) => {
    catalog(row, path);
    if (row.category !== undefined) string(row.category, path + '.category', 160, 1);
    if (row.deletedAt !== undefined) timestamp(row.deletedAt, path + '.deletedAt');
  });
  const active = new Set();
  const trips = table(data.trips, 'trips', ['storeId', 'status', 'closedAt'], (row, path) => {
    const store = stores.get(row.storeId);
    assert(store, path + ' 引用不存在的商店。');
    choice(row.status, ['active', 'closed'], path + '.status');
    if (row.status === 'closed') {
      timestamp(row.closedAt, path + '.closedAt');
    } else {
      assert(row.closedAt === null && !active.has(row.storeId) && !store.archivedAt,
        path + ' 的活动行程与商店状态冲突。');
      active.add(row.storeId);
    }
  });
  table(data.needs, 'needs', [...ITEM_FIELDS, 'productId', 'source', 'state', 'tripId', 'purchasedAt', 'deletedAt'],
    (row, path) => {
      const normalized = readItem(row, path);
      readSource(row.source, path + '.source');
      choice(row.state, ['pending', 'planned', 'purchased', 'cancelled'], path + '.state');
      assert(row.productId === null || products.has(row.productId), path + ' 引用不存在的商品目录记录。');
      assert(normalized.storePolicy.storeIds.every(id => stores.has(id)), path + ' 引用不存在的商店。');
      if (row.deletedAt !== undefined) timestamp(row.deletedAt, path + '.deletedAt');
      assert(!row.deletedAt || row.state === 'cancelled', path + ' 的删除记录必须已取消。');
      if (isLiveNeed(row) && row.storePolicy.mode === 'required') {
        assert(row.storePolicy.storeIds.some(id => !stores.get(id).archivedAt),
          path + ' 至少需要一家可用的指定商店。');
      }
      if (row.state === 'planned' || row.state === 'purchased') {
        const trip = trips.get(row.tripId);
        assert(trip, path + ' 引用不存在的行程。');
        assert(matchStore(row.storePolicy, trip.storeId) !== 'blocked', path + ' 的行程违反指定商店规则。');
        if (row.state === 'planned') assert(trip.status === 'active', path + ' 的行程必须仍在进行。');
      } else {
        assert(row.tripId === null, path + ' 不应关联行程。');
      }
      if (row.state === 'purchased') timestamp(row.purchasedAt, path + '.purchasedAt');
      else assert(row.purchasedAt === null, path + ' 不应记录购买时间。');
    });
  table(data.importBatches, 'importBatches', ['fingerprint', 'itemCount', 'addedCount', 'mergedCount', 'skippedCount'],
    (row, path) => {
      assert(typeof row.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(row.fingerprint), path + ' 指纹无效。');
      integer(row.itemCount, path + '.itemCount', 1);
      for (const key of ['addedCount', 'mergedCount', 'skippedCount']) integer(row[key], path + '.' + key);
      assert(row.itemCount === row.addedCount + row.mergedCount + row.skippedCount &&
        row.addedCount + row.mergedCount > 0, path + ' 的导入数量不一致。');
    });
  return data;
}

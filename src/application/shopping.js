import { assert, canMerge, isLiveNeed, matchStore, mergeQuantity, revise, transition } from '../domain/rules.js';
import { parseImport, previewImport, readItem, verifyStores } from '../import-export/contract.js';
import { exportBackup, exportOutstanding, parseBackup } from '../import-export/backup.js';
import { array, cleaned } from '../import-export/validation.js';
import { DATA_TABLES, newRecord, transact } from '../storage/indexed-db.js';

function find(rows, id, message) {
  const row = rows.find(item => item.id === id);
  assert(row, message);
  return row;
}

function findTrip(data, id) {
  return find(data.trips, id, '找不到该行程。');
}

function findNeed(data, id) {
  return find(data.needs, id, '找不到该商品。');
}

function checkToken(data, token) {
  assert(data.meta.token === token, '清单已更新，请重新预览并确认。');
}

function addNeed(write, item, now) {
  const need = { ...newRecord(undefined, now), ...item, productId: null,
    state: 'pending', tripId: null, purchasedAt: null };
  write.put('needs', need);
  return need;
}

export function shoppingService(db) {
  function change(fn) {
    return transact(db, (data, write) => fn(data, write, new Date().toISOString()));
  }

  function saveStore(input, id, revision) {
    const name = cleaned(input.name, '商店名称', 160, 1);
    const aliases = [...new Set(array(input.aliases, '商店别名', 50).map(alias => cleaned(alias, '商店别名', 160, 1)))];
    return change((data, write, now) => {
      const store = id ? find(data.stores, id, '找不到该商店。') : null;
      assert(!store || store.revision === revision, '商店已更新，请重新打开编辑。');
      const next = store ? revise(store, { name, aliases }, now) :
        { ...newRecord(undefined, now), name, aliases, archivedAt: null };
      write.put('stores', next);
      return next;
    });
  }

  return {
    snapshot: () => transact(db),
    saveStore,
    archiveStore(id, archived, revision) {
      return change((data, write, now) => {
        const store = find(data.stores, id, '找不到该商店。');
        assert(store.revision === revision, '商店已更新，请重试。');
        if (archived) {
          assert(!data.trips.some(trip => trip.status === 'active' && trip.storeId === id),
            '请先结束这家商店的活动行程。');
          const available = new Set(data.stores.filter(entry => entry.id !== id && !entry.archivedAt).map(entry => entry.id));
          assert(!data.needs.some(need => isLiveNeed(need) && need.storePolicy.mode === 'required' &&
            !need.storePolicy.storeIds.some(storeId => available.has(storeId))),
          '仍有商品只能在这家商店购买，请先调整指定商店。');
        }
        write.put('stores', revise(store, { archivedAt: archived ? now : null }, now));
      });
    },
    saveNeed(input, id, revision) {
      const fields = readItem(input);
      return change((data, write, now) => {
        if (!id) {
          verifyStores(fields.storePolicy, data.stores);
          return addNeed(write, { ...fields, source: { type: 'manual' } }, now);
        }
        const need = findNeed(data, id);
        assert(need.revision === revision && isLiveNeed(need), '商品已更新，请重新打开编辑。');
        verifyStores(fields.storePolicy, data.stores, need.storePolicy.storeIds);
        if (fields.storePolicy.mode === 'required') {
          assert(data.stores.some(store => !store.archivedAt && fields.storePolicy.storeIds.includes(store.id)),
            '至少选择一家可用的指定商店。');
        }
        if (need.state === 'planned') {
          assert(matchStore(fields.storePolicy, findTrip(data, need.tripId).storeId) !== 'blocked',
            '请先将商品留待下次，再修改为其他指定商店。');
        }
        write.put('needs', revise(need, fields, now));
      });
    },
    openTrip(storeId) {
      return change((data, write, now) => {
        const store = find(data.stores, storeId, '找不到该商店。');
        assert(!store.archivedAt, '该商店已停用。');
        const existing = data.trips.find(trip => trip.storeId === storeId && trip.status === 'active');
        if (existing) return existing;
        const trip = { ...newRecord(undefined, now), storeId, status: 'active', closedAt: null };
        write.put('trips', trip);
        return trip;
      });
    },
    plan(tripId, ids, token) {
      return change((data, write, now) => {
        checkToken(data, token);
        assert(ids.length > 0 && new Set(ids).size === ids.length, '请选择要加入行程的商品。');
        const trip = findTrip(data, tripId);
        for (const id of ids) write.put('needs', transition(findNeed(data, id), 'plan', now, trip));
      });
    },
    updateNeed(id, action, revision, tripId) {
      return change((data, write, now) => {
        const need = findNeed(data, id);
        assert(need.revision === revision, '商品已更新，请重试。');
        assert(['check', 'uncheck', 'return', 'cancel'].includes(action), '未知购物操作。');
        const trip = tripId ? findTrip(data, tripId) : null;
        write.put('needs', transition(need, action, now, trip));
      });
    },
    closeTrip(id, token) {
      return change((data, write, now) => {
        checkToken(data, token);
        const trip = findTrip(data, id);
        assert(trip.status === 'active', '行程已结束。');
        for (const need of data.needs) {
          if (need.tripId === id && need.state === 'planned') {
            write.put('needs', transition(need, 'return', now, trip));
          }
        }
        write.put('trips', revise(trip, { status: 'closed', closedAt: now }, now));
      });
    },
    async previewImport(text) {
      const parsed = await parseImport(text);
      return previewImport(parsed, await transact(db));
    },
    async importItems(text, token, decisions, repeat = false) {
      const parsed = await parseImport(text);
      return change((data, write, now) => {
        const preview = previewImport(parsed, data);
        assert(!preview.alreadyImported || repeat, '此批次已导入。若要再次购买，请明确确认。');
        checkToken(data, token);
        assert(Array.isArray(decisions) && decisions.length === preview.rows.length, '请确认每一项导入选择。');
        const counts = { addedCount: 0, mergedCount: 0, skippedCount: 0 };
        const merged = new Set();
        for (const row of preview.rows) {
          const decision = decisions[row.index];
          if (decision === 'skip') {
            counts.skippedCount += 1;
          } else if (decision === 'add') {
            addNeed(write, row.item, now);
            counts.addedCount += 1;
          } else {
            const target = row.mergeTargets.find(need => decision === 'merge:' + need.id);
            assert(target && canMerge(target, row.item) && !merged.has(target.id),
              '请选择有效的合并对象。同一批次只能合并到同一条待购项一次。');
            merged.add(target.id);
            write.put('needs', revise(target, { quantity: mergeQuantity(target.quantity, row.item.quantity) }, now));
            counts.mergedCount += 1;
          }
        }
        assert(counts.addedCount + counts.mergedCount > 0, '请至少选择一项新增或合并。');
        write.put('importBatches', { ...newRecord(undefined, now), fingerprint: parsed.fingerprint,
          itemCount: preview.rows.length, ...counts });
        return counts;
      });
    },
    async backup() {
      return exportBackup(await transact(db));
    },
    async outstanding() {
      return exportOutstanding(await transact(db));
    },
    async previewRestore(text) {
      return { backup: parseBackup(text), token: (await transact(db)).meta.token };
    },
    async restore(text, token) {
      const backup = parseBackup(text);
      return change((data, write) => {
        checkToken(data, token);
        for (const table of DATA_TABLES) {
          write.clear(table);
          for (const row of backup[table]) write.put(table, row);
        }
        data.meta.datasetId = backup.datasetId;
      });
    },
  };
}

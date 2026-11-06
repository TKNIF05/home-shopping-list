export const BUILTIN_STORES = [
  { id: 'heb', name: 'H-E-B', aliases: ['HEB'] },
  { id: 'wholefoods', name: 'Whole Foods', aliases: ['全食超市'] },
  { id: '99ranch', name: '99 Ranch Market', aliases: ['大华', '大华超市', '99 Ranch'] },
];

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function matchStore(policy, storeId) {
  if (policy.mode === 'any' || policy.storeIds.includes(storeId)) return 'suggested';
  return policy.mode === 'preferred' ? 'allowed' : 'blocked';
}

export function isLiveNeed(need) {
  return !need.deletedAt && ['pending', 'planned'].includes(need.state);
}

export function revise(record, changes, now) {
  return { ...record, ...changes, updatedAt: now, revision: record.revision + 1 };
}

export function transition(need, action, now, trip) {
  assert(!need.deletedAt, '该商品已删除。');
  switch (action) {
    case 'plan':
      assert(need.state === 'pending' && trip?.status === 'active', '只能将待购商品加入活动行程。');
      assert(matchStore(need.storePolicy, trip.storeId) !== 'blocked', '请先修改商品的指定商店。');
      return revise(need, { state: 'planned', tripId: trip.id }, now);
    case 'check':
    case 'uncheck':
    case 'return':
      assert(trip?.status === 'active' && need.tripId === trip.id, '该商品没有关联活动行程。');
      if (action === 'uncheck') {
        assert(need.state === 'purchased', '该商品尚未购买。');
        return revise(need, { state: 'planned', purchasedAt: null }, now);
      }
      assert(need.state === 'planned', '该商品当前不在未购行程项中。');
      if (action === 'check') return revise(need, { state: 'purchased', purchasedAt: now }, now);
      return revise(need, { state: 'pending', tripId: null }, now);
    case 'cancel':
      assert(isLiveNeed(need), '只能取消未购买的商品。');
      return revise(need, { state: 'cancelled', tripId: null }, now);
    default:
      throw new Error('未知购物操作。');
  }
}

export function nameKey(name) {
  return name.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
}

export function samePolicy(a, b) {
  return a.mode === b.mode && a.storeIds.length === b.storeIds.length &&
    a.storeIds.every(id => b.storeIds.includes(id));
}

export function canMerge(need, item) {
  return need.state === 'pending' && !need.deletedAt && !need.productId &&
    nameKey(need.name) === nameKey(item.name) &&
    need.note === item.note && need.optional === item.optional &&
    samePolicy(need.storePolicy, item.storePolicy) &&
    need.source.type === item.source.type && need.source.ref === item.source.ref &&
    need.source.externalRef === item.source.externalRef &&
    (need.quantity === null && item.quantity === null ||
      need.quantity !== null && item.quantity !== null &&
      need.quantity.unit === item.quantity.unit &&
      Number.isFinite(need.quantity.value + item.quantity.value));
}

function decimalParts(number) {
  const [mantissa, exponent = '0'] = String(number).split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  return [BigInt(whole + fraction), Number(exponent) - fraction.length];
}

export function mergeQuantity(a, b) {
  if (a === null) return null;
  const [left, leftScale] = decimalParts(a.value);
  const [right, rightScale] = decimalParts(b.value);
  const scale = Math.min(leftScale, rightScale);
  const sum = left * 10n ** BigInt(leftScale - scale) + right * 10n ** BigInt(rightScale - scale);
  return { value: Number(sum + 'e' + scale), unit: a.unit };
}

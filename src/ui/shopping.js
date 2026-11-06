import { matchStore } from '../domain/rules.js';
import { button, checkbox, field, h, list, option, panel } from './dom.js';
import { needEditor, storeEditor } from './forms.js';

export function storeName(data, id) {
  return data.stores.find(store => store.id === id)?.name ?? id;
}

export function itemTitle(item) {
  return item.name + (item.quantity ? ' · ' + item.quantity.value + ' ' + item.quantity.unit : '');
}

export function itemDetails(item, data) {
  const { mode, storeIds } = item.storePolicy;
  const rule = mode === 'any' ? '任意商店' :
    (mode === 'preferred' ? '优先 ' : '仅限 ') + storeIds.map(id => storeName(data, id)).join('、');
  return h('div', { class: 'meta' }, [rule, item.optional ? '视情况购买' : '', item.note].filter(Boolean).join(' · '));
}

function needActions(ctx, need) {
  const { state, service, run } = ctx;
  return h('div', { class: 'actions' },
    button('编辑 ' + need.name, () => { state.editNeed = need.id; ctx.render(); }),
    need.state === 'planned' && button('留待下次', () =>
      run(() => service.updateNeed(need.id, 'return', need.revision, need.tripId), '已放回待购池。')),
    button('取消购买 ' + need.name, () => {
      if (confirm('取消购买「' + need.name + '」？')) {
        run(() => service.updateNeed(need.id, 'cancel', need.revision), '已取消购买。');
      }
    }, 'danger'));
}

function editNeed(ctx, need) {
  return ctx.state.editNeed === need.id && needEditor(ctx, need);
}

function storeSettings(ctx) {
  const { data, state, service, run, render } = ctx;
  return h('details', { class: 'panel', open: state.storeSettings,
    ontoggle: event => { state.storeSettings = event.currentTarget.open; } },
    h('summary', {}, '管理商店'),
    button('新增商店', () => { state.editStore = 'new'; render(); }),
    state.editStore === 'new' && storeEditor(ctx),
    list(data.stores, store => [
      h('strong', {}, store.name),
      h('div', { class: 'meta' }, [store.id, ...store.aliases, store.archivedAt ? '已停用' : ''].filter(Boolean).join(' · ')),
      h('div', { class: 'actions' },
        button('编辑 ' + store.name, () => { state.editStore = store.id; render(); }),
        button(store.archivedAt ? '启用' : '停用', () =>
          run(() => service.archiveStore(store.id, !store.archivedAt, store.revision),
            store.archivedAt ? '已启用商店。' : '已停用商店。'))),
      state.editStore === store.id && storeEditor(ctx, store),
    ], '还没有商店。'));
}

export function backlog(ctx) {
  const { data, state, render } = ctx;
  const stores = data.stores.filter(store => !store.archivedAt);
  const filter = h('select', { onchange: event => { state.backlogFilter = event.target.value; render(); } },
    option('', '所有待购商品'), option('any', '任意商店规则', state.backlogFilter === 'any'),
    stores.map(store => option(store.id, store.name + ' 可购买', state.backlogFilter === store.id)));
  const pending = data.needs.filter(need => need.state === 'pending' && !need.deletedAt)
    .filter(need => !state.backlogFilter || (state.backlogFilter === 'any' ? need.storePolicy.mode === 'any' :
      matchStore(need.storePolicy, state.backlogFilter) !== 'blocked'));
  return [
    panel('待购池', h('p', { class: 'meta' }, '待购商品会在确认加入行程后出现在购物清单。'),
      button('添加待购商品', () => { state.addNeed = true; render(); }, 'primary'),
      state.addNeed && needEditor(ctx),
      field('按商店筛选', filter),
      list(pending, need => [h('strong', {}, itemTitle(need)), itemDetails(need, data), needActions(ctx, need),
        editNeed(ctx, need)], '此筛选下没有待购商品。')),
    storeSettings(ctx),
  ];
}

function tripSuggestions(ctx, trip) {
  const { data, state, service, run, render } = ctx;
  const selected = [];
  const pending = data.needs.filter(need => need.state === 'pending' && !need.deletedAt)
    .map(need => ({ need, match: matchStore(need.storePolicy, trip.storeId) }))
    .filter(entry => entry.match === 'suggested' || (state.showOther && entry.match === 'allowed'));
  return panel('可加入本次行程',
    checkbox('也显示优先在其他商店购买的商品', state.showOther, value => { state.showOther = value; render(); }).label,
    list(pending, ({ need, match }) => {
      const check = checkbox(itemTitle(need));
      selected.push({ input: check.input, id: need.id });
      return [check.label, itemDetails(need, data), match === 'allowed' && h('span', { class: 'badge' }, '跨店选入')];
    }, '暂无符合商店规则的待购商品。'),
    pending.length > 0 && button('将选中商品加入行程', () => run(() =>
      service.plan(trip.id, selected.filter(row => row.input.checked).map(row => row.id), data.meta.token),
    '已将选中商品加入行程。'), 'primary'));
}

function currentTrip(ctx, trip) {
  const { data, state, service, run, render } = ctx;
  const shopping = data.needs.filter(need => need.tripId === trip.id);
  const planned = shopping.filter(need => need.state === 'planned');
  const purchased = shopping.filter(need => need.state === 'purchased');
  const filter = h('select', { onchange: event => { state.tripFilter = event.target.value; render(); } },
    option('', '全部行程商品'),
    option('planned', '未购买', state.tripFilter === 'planned'),
    option('purchased', '已购买', state.tripFilter === 'purchased'));
  return [
    panel(storeName(data, trip.storeId) + ' · 购物中',
      h('p', { class: 'meta' }, '已购 ' + purchased.length + ' 件 · 未购 ' + planned.length + ' 件'),
      field('行程商品筛选', filter),
      list([...planned, ...purchased].filter(need => !state.tripFilter || state.tripFilter === need.state), need => [
        checkbox('已购 ' + itemTitle(need), need.state === 'purchased', checked =>
          run(() => service.updateNeed(need.id, checked ? 'check' : 'uncheck', need.revision, trip.id),
            checked ? '已保存购买状态。' : '已撤销购买。', true)).label,
        itemDetails(need, data),
        need.state === 'planned' && [needActions(ctx, need), editNeed(ctx, need)],
      ], '此筛选下没有行程商品。'),
      button('结束行程', () => {
        if (confirm('结束行程？' + planned.length + ' 件未购商品将回到待购池。')) {
          run(() => service.closeTrip(trip.id, data.meta.token), '行程已结束，未购商品已放回待购池。');
        }
      })),
    tripSuggestions(ctx, trip),
  ];
}

export function shopping(ctx) {
  const { data, state, service, run, render } = ctx;
  const active = data.trips.filter(trip => trip.status === 'active');
  const trip = active.find(entry => entry.id === state.tripId) ?? active[0];
  const stores = data.stores.filter(store => !store.archivedAt);
  const storeChoice = h('select', { onchange: event => { state.storeChoice = event.target.value; } },
    stores.map(store => option(store.id, store.name, store.id === state.storeChoice)));
  const activeChoice = h('select', { onchange: event => {
    ctx.selectTrip(event.target.value);
    state.tripFilter = '';
    render();
  } }, active.map(entry => option(entry.id, storeName(data, entry.storeId), entry.id === trip?.id)));
  const history = data.trips.filter(entry => entry.status === 'closed')
    .sort((a, b) => b.closedAt.localeCompare(a.closedAt));
  const cancelled = data.needs.filter(need => need.state === 'cancelled');
  return [
    panel('购物行程',
      active.length > 1 && field('切换活动行程', activeChoice),
      stores.length > 0 && h('div', { class: 'row' }, field('选择商店', storeChoice),
        button('打开行程', () => run(async () => {
          const entry = await service.openTrip(storeChoice.value);
          ctx.selectTrip(entry.id);
          state.tripFilter = '';
        }, '已打开行程。'), 'primary')),
      !trip && h('p', { class: 'meta' }, '当前没有活动行程。')),
    trip && currentTrip(ctx, trip),
    h('details', { class: 'panel' }, h('summary', {}, '购物历史'),
      list(history, entry => [
        h('strong', {}, storeName(data, entry.storeId)), h('div', { class: 'meta' }, new Date(entry.closedAt).toLocaleString()),
        list(data.needs.filter(need => need.tripId === entry.id && need.state === 'purchased'),
          need => [itemTitle(need), itemDetails(need, data)], '本次没有已购买商品。'),
      ], '尚无已结束行程。'),
      h('h3', {}, '已取消商品'),
      list(cancelled, need => [itemTitle(need), itemDetails(need, data)], '尚无已取消商品。')),
  ];
}

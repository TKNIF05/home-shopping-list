import { button, checkbox, field, form, h, option, submit } from './dom.js';

export function needEditor(ctx, need) {
  const name = h('input', { required: true, maxlength: 160, value: need?.name });
  const value = h('input', { type: 'number', inputmode: 'decimal', step: 'any', min: 0, value: need?.quantity?.value });
  const unit = h('input', { maxlength: 24, value: need?.quantity?.unit });
  const note = h('textarea', { maxlength: 1000, rows: 2 }, need?.note ?? '');
  const optional = checkbox('视情况购买', need?.optional);
  const policy = h('select', {}, [
    option('any', '任意商店', need?.storePolicy.mode === 'any'),
    option('preferred', '优先商店', need?.storePolicy.mode === 'preferred'),
    option('required', '仅限指定商店', need?.storePolicy.mode === 'required'),
  ]);
  const stores = ctx.data.stores.filter(store => !store.archivedAt || need?.storePolicy.storeIds.includes(store.id))
    .map(store => ({ id: store.id, ...checkbox(store.name + (store.archivedAt ? '（已停用）' : ''),
      need?.storePolicy.storeIds.includes(store.id)) }));
  const choices = h('fieldset', { hidden: policy.value === 'any' }, h('legend', {}, '选择一家或多家商店'),
    stores.map(store => store.label));
  policy.addEventListener('change', () => { choices.hidden = policy.value === 'any'; });
  return form(() => ctx.run(async () => {
    if (!value.value && unit.value.trim()) throw new Error('请同时输入数量和单位，或将两者留空。');
    await ctx.service.saveNeed({
      name: name.value, quantity: value.value ? { value: value.valueAsNumber, unit: unit.value } : null,
      note: note.value, optional: optional.input.checked,
      storePolicy: {
        mode: policy.value,
        storeIds: policy.value === 'any' ? [] : stores.filter(store => store.input.checked).map(store => store.id),
      },
    }, need?.id, need?.revision);
    ctx.state.editNeed = null;
    ctx.state.addNeed = false;
  }, need ? '已保存商品。' : '已添加到待购池。'),
  field('商品名称', name), h('div', { class: 'two' }, field('数量（可留空）', value), field('单位', unit)),
  field('备注', note), optional.label, field('商店规则', policy), choices,
  h('div', { class: 'actions' }, submit(need ? '保存商品' : '添加商品'),
    button('取消编辑', () => {
      ctx.state.editNeed = null;
      ctx.state.addNeed = false;
      ctx.render();
    })));
}

export function storeEditor(ctx, store) {
  const name = h('input', { required: true, maxlength: 160, value: store?.name });
  const aliases = h('input', { value: store?.aliases.join('、') });
  return form(() => ctx.run(async () => {
    await ctx.service.saveStore({ name: name.value, aliases: aliases.value.split('、').map(s => s.trim()).filter(Boolean) },
      store?.id, store?.revision);
    ctx.state.editStore = null;
  }, '已保存商店。'), field('商店名称', name), field('商店别名（用顿号分隔）', aliases),
  h('div', { class: 'actions' }, submit('保存商店'), button('取消编辑', () => {
    ctx.state.editStore = null;
    ctx.render();
  })));
}

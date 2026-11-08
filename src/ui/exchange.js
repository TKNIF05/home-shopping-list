import { IMPORT_LIMIT } from '../import-export/contract.js';
import { clearRecipeInbox } from '../adapters/recipe-inbox.js';
import { button, checkbox, download, field, form, h, list, option, panel, submit } from './dom.js';
import { itemDetails, itemTitle } from './shopping.js';

function dateTag() {
  return new Date().toISOString().slice(0, 10);
}

function importReview(ctx) {
  const { state, data, service, run } = ctx;
  const preview = state.importPreview;
  const repeat = checkbox('确认将这批商品作为新需求再次导入', state.repeat, checked => { state.repeat = checked; });
  return h('div', { class: 'stack' },
    h('h3', {}, '导入预览 · ' + preview.rows.length + ' 项'),
    preview.alreadyImported && h('p', { class: 'meta' }, '这批内容已经成功导入过。'),
    preview.alreadyImported && repeat.label,
    form(() => run(async () => {
      const counts = await service.importItems(state.importText, preview.token, state.decisions, state.repeat);
      if (state.recipeInbox) clearRecipeInbox();
      state.recipeInbox = false;
      state.importPreview = null;
      state.importText = '';
      return '导入完成。新增 ' + counts.addedCount + ' 项，合并 ' + counts.mergedCount +
        ' 项，跳过 ' + counts.skippedCount + ' 项。';
    }),
    list(preview.rows, row => {
      const decision = state.decisions[row.index];
      const choices = h('select', { required: true, onchange: event => {
        state.decisions[row.index] = event.target.value;
      } },
      option('', '请选择处理方式', !decision),
      option('add', '保留为新待购商品', decision === 'add'),
      option('skip', '跳过此项', decision === 'skip'),
      row.mergeTargets.map(need => option('merge:' + need.id, '合并到 ' + itemTitle(need) + ' · ' + need.id.slice(0, 8),
        decision === 'merge:' + need.id)));
      return [
        h('strong', {}, itemTitle(row.item)), itemDetails(row.item, data),
        row.matches.length > 0 && h('p', { class: 'meta' }, '清单内疑似重复：' +
          row.matches.map(need => itemTitle(need) +
            ({ planned: '（行程中）', purchased: '（已购买）', cancelled: '（已取消）' }[need.state] ?? '')).join('、')),
        row.duplicateInBatch && h('p', { class: 'meta' }, '本批次前面有同名商品。'),
        field('处理 ' + row.item.name, choices),
      ];
    }, ''),
    submit('确认导入')));
}

function importPanel(ctx) {
  const { state, service, run } = ctx;
  const review = h('div', {}, state.importPreview && importReview(ctx));
  const input = h('textarea', { rows: 7, placeholder: '{ "format": "shopping-import", "version": 1, "items": […] }' },
    state.importText);
  input.addEventListener('input', () => {
    state.importText = input.value;
    state.importPreview = null;
    review.replaceChildren();
  });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    run(async () => {
      if (file.size > IMPORT_LIMIT) throw new Error('导入文件不能超过 1 MiB。');
      state.importText = await file.text();
      state.importPreview = null;
    }, '已读取 JSON 文件，请预览。');
  });
  return panel('导入待购商品', h('p', { class: 'meta' }, '粘贴购物导入 JSON，或选择 .json 文件。'),
    field('购物导入 JSON', input), field('选择购物 JSON 文件', fileInput),
    button('校验并预览', () => run(async () => {
      const preview = await service.previewImport(state.importText);
      state.importPreview = preview;
      state.repeat = false;
      state.decisions = preview.rows.map(row => row.matches.length || row.duplicateInBatch ? '' : 'add');
    }), 'primary'), review);
}

function outstandingText(data) {
  return data.items.map(item => [
    item.state === 'planned' ? '行程中未购' : '待购', itemTitle(item),
    item.storePolicy.mode === 'any' ? '任意商店' :
      (item.storePolicy.mode === 'preferred' ? '优先 ' : '仅限 ') + item.stores.join('、'),
    item.optional ? '视情况购买' : '', item.note,
  ].filter(Boolean).join(' · ')).join('\n');
}

function restorePanel(ctx) {
  const { state, service, run } = ctx;
  const fileInput = h('input', { type: 'file', accept: '.json,application/json' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    run(async () => {
      state.restorePreview = null;
      const text = await file.text();
      state.restorePreview = { text, name: file.name, ...await service.previewRestore(text) };
    }, '', true);
  });
  const preview = state.restorePreview;
  const replace = checkbox('我确认覆盖当前浏览器内的购物数据');
  return panel('恢复完整备份', h('p', { class: 'meta' }, '恢复会覆盖整个购物数据集。可先下载当前备份。'),
    field('选择完整备份文件', fileInput),
    preview && h('div', { class: 'stack' },
      h('p', {}, preview.name + ' · ' + preview.backup.stores.length + ' 家商店 · ' +
        preview.backup.needs.length + ' 条商品记录 · ' + preview.backup.trips.length + ' 次行程'),
      replace.label,
      button('恢复并覆盖', () => {
        if (!replace.input.checked) {
          ctx.report('请先勾选覆盖确认。');
          return;
        }
        if (!confirm('确定恢复这份完整备份并覆盖现有购物数据？')) return;
        run(async () => {
          await service.restore(preview.text, preview.token);
          state.restorePreview = null;
          state.importPreview = null;
          ctx.selectTrip(null);
        }, '完整备份已恢复。');
      }, 'danger')));
}

export function exchange(ctx) {
  const { state, service, run, render } = ctx;
  const textArea = h('textarea', { readonly: true, rows: 4 }, state.outstandingText ?? '');
  return [
    importPanel(ctx),
    panel('导出与备份', h('p', { class: 'meta' }, '购物数据保存在当前浏览器。清理网站数据前请下载完整备份。'),
      h('div', { class: 'actions' },
        button('下载完整备份', () => run(async () => {
          download('shopping-backup-' + dateTag() + '.json', await service.backup());
        }, '已生成完整备份。')),
        button('下载上次恢复前的购物备份', () => run(async () => {
          download('shopping-before-restore-' + dateTag() + '.json', await service.restoreSnapshot());
        }, '已生成恢复前的购物备份。')),
        button('下载待购 JSON', () => run(async () => {
          download('shopping-outstanding-' + dateTag() + '.json', await service.outstanding());
        }, '已生成待购清单。')),
        button('生成可复制文本', () => run(async () => {
          state.outstandingText = outstandingText(await service.outstanding()) || '当前没有未购商品。';
        }))),
      state.outstandingText !== null && [
        field('待购清单文本', textArea),
        h('div', { class: 'actions' },
          button('选中文本', () => { textArea.focus(); textArea.select(); }),
          button('收起文本', () => { state.outstandingText = null; render(); })),
      ]),
    restorePanel(ctx),
  ];
}

import { openDatabase, DATABASE_NAME } from '../src/storage/indexed-db.js';
import { shoppingService } from '../src/application/shopping.js';

const result = document.querySelector('#result');
const frame = document.querySelector('iframe');
const any = { mode: 'any', storeIds: [] };
const required = { mode: 'required', storeIds: ['99ranch'] };
const preferred = { mode: 'preferred', storeIds: ['99ranch'] };
const item = (name, fields = {}) => ({ name, quantity: null, note: '', optional: false, storePolicy: any, ...fields });
const contract = (...items) => JSON.stringify({ format: 'shopping-import', version: 1, items });
const input = contract(item('醋', { storePolicy: required }), item('葡萄', { optional: true }),
  item('牛奶', { storePolicy: preferred }));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejects(operation, expected) {
  try {
    await operation();
  } catch (error) {
    assert(expected.test(error.message), '错误提示不符：' + error.message);
    return;
  }
  throw new Error('预期操作失败。');
}

function dbDelete(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('测试数据库仍被打开。'));
  });
}

async function storageCases() {
  const dbName = 'shopping-browser-integration-' + crypto.randomUUID();
  const db = await openDatabase(dbName);
  const service = shoppingService(db);
  try {
    const preview = await service.previewImport(input);
    await rejects(() => service.importItems(input, preview.token, ['add', 'invalid', 'add']), /合并对象/);
    assert((await service.snapshot()).needs.length === 0, '失败批次写入了商品');
    assert((await service.snapshot()).importBatches.length === 0, '失败批次写入了指纹');
    const submits = await Promise.allSettled(Array.from({ length: 2 }, () =>
      service.importItems(input, preview.token, ['add', 'add', 'add'])));
    assert(submits.filter(entry => entry.status === 'fulfilled').length === 1, '并行提交重复导入');
    const duplicate = await service.previewImport(input);
    assert(duplicate.alreadyImported, '重复导入未被发现');
    await rejects(() => service.importItems(input, duplicate.token, ['add', 'add', 'add']), /批次已导入/);

    const [first, second] = await Promise.all([service.openTrip('heb'), service.openTrip('heb')]);
    assert(first.id === second.id, '并行打开创建了重复活动行程');
    const trip = await service.openTrip('99ranch');
    const snapshot = await service.snapshot();
    const vinegar = snapshot.needs.find(need => need.name === '醋');
    const grapes = snapshot.needs.find(need => need.name === '葡萄');
    await rejects(() => service.plan(first.id, [grapes.id, vinegar.id], snapshot.meta.token), /指定商店/);
    assert((await service.snapshot()).needs.every(need => need.state === 'pending'), '失败分配写入了商品');
    await service.plan(trip.id, [vinegar.id, grapes.id], snapshot.meta.token);
    const planned = (await service.snapshot()).needs.find(need => need.id === vinegar.id);
    await service.updateNeed(planned.id, 'check', planned.revision, trip.id);
    await rejects(() => service.closeTrip(trip.id, snapshot.meta.token), /重新预览/);
    await service.closeTrip(trip.id, (await service.snapshot()).meta.token);
    const closed = await service.backup();
    assert(closed.needs.find(need => need.id === grapes.id).state === 'pending', '未买商品没有返回待购池');
    assert(closed.needs.find(need => need.id === vinegar.id).state === 'purchased', '购买状态没有归档');
    const again = await service.previewImport(input);
    await service.importItems(input, again.token, ['add', 'skip', 'skip'], true);
    const afterRepeat = await service.snapshot();
    assert(afterRepeat.needs.filter(need => need.name === '醋').length === 2, '明确复购没有创建新需求');
    assert(afterRepeat.needs.find(need => need.id === vinegar.id).state === 'purchased', '复购修改了历史记录');

    const content = JSON.stringify(closed);
    const review = await service.previewRestore(content);
    const damaged = structuredClone(closed);
    damaged.needs[0].tripId = crypto.randomUUID();
    await rejects(() => service.restore(JSON.stringify(damaged), review.token), /行程/);
    assert((await service.snapshot()).needs.length === 4, '无效恢复更改了现有数据');
    const oldView = await service.snapshot();
    await service.restore(content, oldView.meta.token);
    assert((await service.restoreSnapshot()).needs.length === 4, '恢复前快照缺少当前商品');
    await rejects(() => service.updateNeed(grapes.id, 'cancel',
      oldView.needs.find(need => need.id === grapes.id).revision, undefined, oldView.meta.token), /重新预览/);
    const recipeText = contract({...item('菜单土豆'), source: {
      type: 'recipe', ref: 'recipe:ingredient', externalRef: 'meal:line',
    }});
    const recipeReview = await service.previewImport(recipeText);
    await service.importItems(recipeText, recipeReview.token, ['add']);
    const recipeNeed = (await service.snapshot()).needs.find(need => need.name === '菜单土豆');
    await service.updateNeed(recipeNeed.id, 'cancel', recipeNeed.revision);
    const renamedRecipe = recipeText.replace('菜单土豆', '改名土豆');
    const renamedReview = await service.previewImport(renamedRecipe);
    assert(renamedReview.rows[0].matches.some(need => need.id === recipeNeed.id),
      '已取消的菜单来源在改名后被当作全新商品');
    const restoredName = dbName + '-restore';
    const restoredDb = await openDatabase(restoredName);
    try {
      const target = shoppingService(restoredDb);
      const targetReview = await target.previewRestore(content);
      await target.restore(content, targetReview.token);
      const actual = await target.backup();
      actual.exportedAt = closed.exportedAt;
      assert(JSON.stringify(actual) === content, '恢复后的 ID、数量、时间戳或记录与原始备份不同');
      assert((await target.previewImport(input)).alreadyImported, '恢复后忘记了历史导入批次');
    } finally {
      restoredDb.close();
      await dbDelete(restoredName);
    }
  } finally {
    db.close();
    await dbDelete(dbName);
  }
}

async function waitFor(condition, message) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    const match = condition();
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

function doc() {
  return frame.contentDocument;
}

function button(name) {
  return [...doc().querySelectorAll('button')].find(entry => entry.textContent === name);
}

function click(name) {
  const control = button(name);
  assert(control && !control.disabled, '未找到可用按钮 ' + name);
  control.click();
}

function field(label, tag) {
  const parent = [...doc().querySelectorAll('label')].find(entry => entry.textContent.trim() === label ||
    entry.firstElementChild?.textContent === label);
  assert(parent?.querySelector(tag), '找不到字段 ' + label);
  return parent.querySelector(tag);
}

function set(control, value) {
  control.value = value;
  control.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
  control.dispatchEvent(new frame.contentWindow.Event('change', { bubbles: true }));
}

function status(text) {
  return waitFor(() => doc().querySelector('#status')?.textContent.includes(text), '未出现状态：' + text);
}

function loadApp() {
  return new Promise(resolve => {
    frame.addEventListener('load', resolve, { once: true });
    frame.src = '../?browser-test=' + Date.now();
  });
}

async function uiCases() {
  const db = await openDatabase();
  try {
    const before = await shoppingService(db).snapshot();
    assert(!before.needs.length && !before.trips.length && !before.importBatches.length &&
      !before.products.length && before.stores.length === 3 && before.stores.every(store => store.revision === 1),
      '此地址已有购物数据，请在空白浏览器配置或独立地址运行。');
  } finally {
    db.close();
  }
  await loadApp();
  await waitFor(() => button('待购池'), '应用未从仓库子路径启动');
  frame.contentWindow.confirm = () => true;
  click('待购池');
  click('添加待购商品');
  set(field('商品名称', 'input'), '盐');
  click('添加商品');
  await status('已添加到待购池');
  assert(doc().querySelector('.item strong').textContent === '盐', '未指定数量时显示了默认数量');

  click('导入与备份');
  set(field('购物导入 JSON', 'textarea'), input);
  click('校验并预览');
  await waitFor(() => button('确认导入'), '未显示导入预览');
  click('确认导入');
  await status('导入完成');
  set(field('购物导入 JSON', 'textarea'), input);
  click('校验并预览');
  await waitFor(() => doc().body.textContent.includes('这批内容已经成功导入过'), '未显示重复批次提示');
  set(field('处理 醋', 'select'), 'add');
  set(field('处理 葡萄', 'select'), 'add');
  set(field('处理 牛奶', 'select'), 'add');
  click('确认导入');
  await waitFor(() => doc().querySelector('#error').textContent.includes('此批次已导入'), '重复批次未阻止');
  click('购物中');
  set(field('选择商店', 'select'), 'heb');
  click('打开行程');
  await status('已打开行程');
  assert(!doc().body.textContent.includes('醋'), '醋出现在错误商店的候选项');
  assert(!doc().body.textContent.includes('牛奶'), '其他优先商店的商品默认可见');
  field('也显示优先在其他商店购买的商品', 'input').click();
  assert(doc().body.textContent.includes('跨店选入'), '未显示优先商品的跨店选项');
  set(field('选择商店', 'select'), '99ranch');
  click('打开行程');
  await status('已打开行程');
  field('醋', 'input').click();
  field('葡萄', 'input').click();
  click('将选中商品加入行程');
  await status('已将选中商品加入行程');
  field('已购 醋', 'input').click();
  await status('已保存购买状态');
  await loadApp();
  await waitFor(() => doc().body.textContent.includes('已购 1 件'), '刷新没有恢复活动行程或已购状态');
  assert(field('已购 醋', 'input').checked, '刷新后复选框没有勾选');
  field('已购 醋', 'input').click();
  await status('已撤销购买');
  field('已购 醋', 'input').click();
  await status('已保存购买状态');
  frame.contentWindow.confirm = () => true;
  click('结束行程');
  await status('行程已结束');
  click('待购池');
  assert(doc().body.textContent.includes('葡萄') && !doc().body.textContent.includes('醋'), '结束行程后的待购池不正确');
  assert(doc().documentElement.scrollWidth <= doc().documentElement.clientWidth + 1, '窄屏存在横向溢出');

  click('导入与备份');
  const app = frame.contentWindow;
  let downloaded;
  const originalCreateURL = app.URL.createObjectURL;
  const originalClick = app.HTMLAnchorElement.prototype.click;
  app.URL.createObjectURL = blob => {
    downloaded = blob;
    return originalCreateURL.call(app.URL, blob);
  };
  app.HTMLAnchorElement.prototype.click = function () {};
  try {
    click('下载完整备份');
    await status('已生成完整备份');
  } finally {
    app.URL.createObjectURL = originalCreateURL;
    app.HTMLAnchorElement.prototype.click = originalClick;
  }
  const backup = await downloaded.text();
  assert(JSON.parse(backup).needs.length === 4, '备份漏掉商品');
  chooseFile('选择购物 JSON 文件', 'shopping-import.json', contract(item('面包')));
  await status('已读取 JSON 文件');
  click('校验并预览');
  await waitFor(() => button('确认导入'), '选择文件后没有显示预览');
  click('确认导入');
  await status('导入完成');

  chooseFile('选择完整备份文件', 'shopping-backup.json', backup);
  await waitFor(() => button('恢复并覆盖'), '选择备份后没有显示恢复预览');
  click('恢复并覆盖');
  assert(doc().querySelector('#error').textContent.includes('请先勾选覆盖确认'), '恢复缺少第一次确认');
  field('我确认覆盖当前浏览器内的购物数据', 'input').click();
  app.confirm = () => false;
  click('恢复并覆盖');
  assert(button('恢复并覆盖'), '取消浏览器确认后不应提交恢复');
  app.confirm = () => true;
  click('恢复并覆盖');
  await status('完整备份已恢复');
  click('待购池');
  assert(!doc().body.textContent.includes('面包') && doc().body.textContent.includes('葡萄'), '未恢复选中的备份');
}

function chooseFile(label, name, text) {
  const app = frame.contentWindow;
  const input = field(label, 'input');
  const files = new app.DataTransfer();
  files.items.add(new app.File([text], name, { type: 'application/json' }));
  input.files = files.files;
  input.dispatchEvent(new app.Event('change', { bubbles: true }));
}

try {
  await storageCases();
  result.textContent = '通过 IndexedDB 回滚、并行导入、商店分配、行程归档与完整恢复。';
  await uiCases();
  result.textContent += '\n通过子路径 UI、手动录入、文件导入、重复导入、跨店筛选、刷新、窄屏布局和备份覆盖确认。';
  result.dataset.state = 'pass';
} catch (error) {
  result.textContent += '\n' + error.stack;
  result.dataset.state = 'fail';
}

import { openDatabase } from '../storage/indexed-db.js';
import { shoppingService } from '../application/shopping.js';
import { button } from './dom.js';
import { backlog, shopping } from './shopping.js';
import { exchange } from './exchange.js';

const navigation = document.querySelector('#navigation');
const content = document.querySelector('#content');
const status = document.querySelector('#status');
const errorBox = document.querySelector('#error');
const TRIP_KEY = 'home-shopping-list:selected-trip';

const state = {
  tab: 'shopping', tripId: null, tripFilter: '', backlogFilter: '', showOther: false,
  addNeed: false, editNeed: null, editStore: null, storeSettings: false, storeChoice: '',
  importText: '', importPreview: null, restorePreview: null, outstandingText: null,
};

try {
  state.tripId = localStorage.getItem(TRIP_KEY);
} catch {
  // Selecting a trip still works when browser settings block localStorage.
}

function selectTrip(id) {
  state.tripId = id;
  try {
    if (id) localStorage.setItem(TRIP_KEY, id);
    else localStorage.removeItem(TRIP_KEY);
  } catch {
    // This preference is separate from IndexedDB shopping data.
  }
}

let service;
let data;
let busy = false;

function report(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function render() {
  const pages = [
    ['shopping', '购物中', shopping], ['backlog', '待购池', backlog], ['exchange', '导入与备份', exchange],
  ];
  navigation.replaceChildren(...pages.map(([id, label]) => {
    const item = button(label, () => {
      if (state.tab === id) return;
      state.tab = id;
      status.textContent = '';
      report('');
      render();
    });
    if (state.tab === id) item.setAttribute('aria-current', 'page');
    return item;
  }));
  const page = pages.find(([id]) => id === state.tab)[2];
  content.replaceChildren(...page({ data, state, service, render, run, report, selectTrip }).flat().filter(Boolean));
}

async function run(operation, message = '', refreshOnError = false) {
  if (busy) return;
  busy = true;
  const controls = [...document.querySelectorAll('button, input, select, textarea')].filter(element => !element.disabled);
  controls.forEach(element => { element.disabled = true; });
  status.textContent = '';
  report('');
  try {
    const result = await operation();
    data = await service.snapshot();
    render();
    status.textContent = typeof result === 'string' ? result : message;
  } catch (error) {
    if (refreshOnError) {
      try {
        data = await service.snapshot();
        render();
      } catch {
        // Keep the original operation error visible.
      }
    }
    report(error.message || '操作失败，请重新打开网页后重试。');
  } finally {
    controls.forEach(element => { element.disabled = false; });
    busy = false;
  }
}

async function start() {
  try {
    service = shoppingService(await openDatabase());
    data = await service.snapshot();
    status.textContent = '';
    render();
  } catch (error) {
    status.textContent = '';
    report('无法打开购物清单的本地存储。' + (error.message ?? ''));
  }
}

start();

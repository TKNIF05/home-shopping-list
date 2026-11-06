export function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (value !== null && value !== undefined && value !== false) {
      element.setAttribute(key, value === true ? '' : String(value));
    }
  }
  element.append(...children.flat(Infinity).filter(value => value !== null && value !== undefined && value !== false));
  return element;
}

export function button(label, action, className) {
  return h('button', { type: 'button', class: className, onclick: action }, label);
}

export function option(value, label, selected = false) {
  return h('option', { value, selected }, label);
}

export function field(label, element) {
  return h('label', {}, h('span', {}, label), element);
}

export function checkbox(label, checked = false, change) {
  const input = h('input', { type: 'checkbox', checked });
  if (change) input.addEventListener('change', () => change(input.checked));
  return { input, label: h('label', { class: 'inline' }, input, label) };
}

export function panel(title, ...children) {
  return h('section', {}, h('h2', {}, title), children);
}

export function list(entries, row, empty) {
  return entries.length ? h('ul', {}, entries.map(entry => h('li', { class: 'item' }, row(entry)))) :
    h('p', { class: 'meta' }, empty);
}

export function form(submit, ...children) {
  return h('form', { onsubmit: event => { event.preventDefault(); submit(); } }, children);
}

export function submit(label) {
  return h('button', { type: 'submit', class: 'primary' }, label);
}

export function download(filename, value, type = 'application/json') {
  const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type });
  const url = URL.createObjectURL(blob);
  const anchor = h('a', { href: url, download: filename });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

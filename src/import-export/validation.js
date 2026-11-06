import { assert } from '../domain/rules.js';

export function record(value, path, fields) {
  assert(value && typeof value === 'object' && !Array.isArray(value), path + ' 必须是对象。');
  for (const key of Object.keys(value)) {
    assert(fields.includes(key), path + ' 包含未知字段 ' + key + '。');
  }
  return value;
}

export function string(value, path, max, min = 0) {
  const length = typeof value === 'string' ? Array.from(value).length : -1;
  assert(length >= min && length <= max,
    path + ' 必须是 ' + min + ' 至 ' + max + ' 字符的文本。');
  return value;
}

export function cleaned(value, path, max, min = 0) {
  string(value, path, max, min);
  return string(value.trim().normalize('NFC'), path, max, min);
}

export function array(value, path, max = Infinity) {
  assert(Array.isArray(value) && value.length <= max, path + ' 必须是合法数组。');
  return value;
}

export function choice(value, allowed, path) {
  assert(allowed.includes(value), path + ' 的值不受支持。');
  return value;
}

export function unique(values, path) {
  assert(new Set(values).size === values.length, path + ' 包含重复值。');
}

export function uuid(value, path) {
  assert(typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value),
  path + ' 必须是小写 UUID。');
  return value;
}

export function storeId(value, path) {
  if (['heb', 'wholefoods', '99ranch'].includes(value)) return value;
  return uuid(value, path);
}

export function timestamp(value, path) {
  assert(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
  path + ' 必须是有效 UTC ISO 时间。');
}

export function integer(value, path, min = 0) {
  assert(Number.isSafeInteger(value) && value >= min, path + ' 必须是合法整数。');
}

export function json(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('JSON 格式错误。请检查引号、逗号和括号。');
  }
}

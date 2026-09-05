// اختبارات الدوال الخالصة — تعمل بـ `npm test` بلا شبكة ولا محاكي.
// كل حالة هنا تقابل خطأً كان موجودًا فعلًا في الإنتاج.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLinkName, safeTargetUrl } from '../docs/link-utils.js';

const BASE = '/QR-Convert/';

test('الجذر يعطي main لا اسم المستودع', () => {
  // هذه هي العلة بعينها: pop() كانت ترجع "QR-Convert" (البند 3)
  assert.equal(resolveLinkName('/QR-Convert/', BASE), 'main');
  assert.equal(resolveLinkName('/QR-Convert', BASE), 'main');
  assert.equal(resolveLinkName('/QR-Convert/index.html', BASE), 'main');
});

test('الرابط الفرعي يعطي اسمه', () => {
  assert.equal(resolveLinkName('/QR-Convert/link1', BASE), 'link1');
  assert.equal(resolveLinkName('/QR-Convert/promo-2024', BASE), 'promo-2024');
  assert.equal(resolveLinkName('/QR-Convert/offer/', BASE), 'offer');
});

test('صفحة 404 نفسها تعطي main لا 404.html', () => {
  assert.equal(resolveLinkName('/QR-Convert/404.html', BASE), 'main');
});

test('يعمل على نطاق مخصص جذره /', () => {
  assert.equal(resolveLinkName('/', '/'), 'main');
  assert.equal(resolveLinkName('/link1', '/'), 'link1');
});

test('حساسية حالة الأحرف محفوظة', () => {
  assert.equal(resolveLinkName('/QR-Convert/Link1', BASE), 'Link1');
  assert.notEqual(resolveLinkName('/QR-Convert/Link1', BASE), 'link1');
});

test('مسار مرمّز يُفك ترميزه، ومسار تالف لا يُسقط الصفحة', () => {
  assert.equal(resolveLinkName('/QR-Convert/my%2Dlink', BASE), 'my-link');
  assert.equal(resolveLinkName('/QR-Convert/%E0%A4%A', BASE), '%E0%A4%A');
});

test('الوجهات الصالحة تمر', () => {
  assert.equal(safeTargetUrl('https://example.com/a', 'https://site.test'), 'https://example.com/a');
  assert.equal(safeTargetUrl('http://example.com/', 'https://site.test'), 'http://example.com/');
});

test('المخططات الخطرة تُرفض', () => {
  // إعادة توجيه مفتوح / XSS مخزّن عبر وجهة الرابط (البند 5)
  assert.equal(safeTargetUrl('javascript:alert(1)', 'https://site.test'), null);
  assert.equal(safeTargetUrl('data:text/html,<script>alert(1)</script>', 'https://site.test'), null);
  assert.equal(safeTargetUrl('vbscript:msgbox(1)', 'https://site.test'), null);
  assert.equal(safeTargetUrl('file:///etc/passwd', 'https://site.test'), null);
});

test('القيم الفارغة أو غير النصية تُرفض', () => {
  for (const value of ['', '   ', null, undefined, 42, {}]) {
    assert.equal(safeTargetUrl(value, 'https://site.test'), null);
  }
});

test('مسار يشبه الجذر بلا أن يكونه لا يُقتطع خطأً', () => {
  assert.equal(resolveLinkName('/QR-Convertible/x', BASE), 'QR-Convertible/x');
});

// اختبارات الدوال الخالصة — تعمل بـ `npm test` بلا شبكة ولا محاكي.
// كل حالة هنا تقابل خطأً كان موجودًا فعلًا في الإنتاج.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveLinkName, safeTargetUrl, isValidLinkName } from '../docs/link-utils.js';

const BASE = '/QR-Convert/';

test('الجذر يعطي main لا اسم المستودع', () => {
  // هذه هي العلة بعينها: pop() كانت ترجع "QR-Convert"
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
  // إعادة توجيه مفتوح / XSS مخزّن عبر وجهة الرابط
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

test('اسم الرابط: نفس شرط اللوحة والقواعد', () => {
  for (const ok of ['main', 'link1', 'promo-2024', 'my_link', 'a'.repeat(64)]) {
    assert.equal(isValidLinkName(ok), true, ok);
  }
  // 'a/b' هو ما يعطيه مسار متعدد الأجزاء — يجب أن يُرفض قبل الوصول لـ Firestore
  for (const bad of ['', 'a/b', 'QR-Convertible/x', 'مرحبا', 'a b', 'a'.repeat(65), null, 7]) {
    assert.equal(isValidLinkName(bad), false, String(bad));
  }
});

// ------------------------- صفحتا التحويل -------------------------

const page = (name) => readFileSync(new URL(`../docs/${name}`, import.meta.url), 'utf8');
const csp = (html) => html
  .match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1]
  .replace(/\s+/g, ' ')
  .trim();

test('سياسة CSP متطابقة في index.html و 404.html', () => {
  // السياسة مكررة في الصفحتين لأن الموقع ثابت بلا خطوة بناء. لو تغيّر نطاق
  // في واحدة ونُسيت الثانية، انكسر التحويل في نصف الروابط بصمت.
  assert.equal(csp(page('404.html')), csp(page('index.html')));
});

test('404.html تحمّل ملفاتها بمسارات مطلقة', () => {
  // 404.html تُخدَم لأي مسار، منها /QR-Convert/main/ و /QR-Convert/a/b.
  // مسار نسبي مثل ./redirect-page.js يُحسب حينها من /QR-Convert/main/
  // فيرجع 404.html نفسها بنوع text/html، فلا يعمل السكربت وتعلق الصفحة
  // على "جاري التحويل" للأبد.
  const html = page('404.html');
  const refs = [...html.matchAll(/(?:href|src)="([^"#]+)"/g)].map((m) => m[1])
    .filter((ref) => !/^https?:/.test(ref));
  assert.ok(refs.length > 0);
  for (const ref of refs) assert.match(ref, /^\/QR-Convert\//, ref);
});

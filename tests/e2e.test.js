// اختبارات المتصفح: صفحتا التحويل ولوحة التحكم على محاكيَي Firestore و Auth.
//
// شغّلها بـ: npm run test:e2e
//
// هذه الاختبارات هي التي كشفت — أثناء تنفيذ خطة الإصلاح — ثلاثة أعطال لم
// تظهر في اختبارات القواعد وحدها: ضياع كل النقرات لأن التحويل يهدم الصفحة
// قبل وصول الكتابة، وفشل فحص صلاحية اللوحة بسبب معرّف محجوز، وسمة pattern
// غير صالحة في المتصفحات الحديثة.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
  startSite, startTarget, seedLink, readLink, createUser, openPage, waitHidden
} from './e2e-helpers.js';

const SITE = 'http://localhost:4173';
const TARGET = 'http://localhost:4199';
const ADMIN_EMAIL = 'abo.saleh.g@gmail.com';
const PASSWORD = 'Passw0rd!';

let browser;
let site;
let target;

before(async () => {
  site = await startSite();
  target = await startTarget();
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });

  await seedLink('main', { url: `${TARGET}/landing`, description: 'الرئيسي', clicks: 7 });
  await seedLink('promo', { url: `${TARGET}/promo-page`, description: 'عرض' });
  await seedLink('paused', { url: `${TARGET}/x`, description: 'معطّل', active: false });
  await seedLink('evil', { url: 'javascript:window.__pwned=1', description: 'خطر' });

  await createUser(ADMIN_EMAIL, PASSWORD, true);
  await createUser('stranger@gmail.com', PASSWORD, true);
});

after(async () => {
  await browser?.close();
  site?.close();
  target?.close();
});

// ------------------------------ التحويل ------------------------------

test('الرابط الجذري يحوّل إلى وجهته', async () => {
  const { page, context, errors } = await openPage(browser, SITE + '/');
  await page.waitForURL('**/landing', { timeout: 20000 });
  assert.deepEqual(errors, []);
  await context.close();
});

test('الرابط الفرعي يحوّل عبر 404.html', async () => {
  // على GitHub Pages لا يوجد ملف اسمه promo، فالمسار يُخدَم من 404.html
  const { page, context } = await openPage(browser, SITE + '/promo');
  await page.waitForURL('**/promo-page', { timeout: 20000 });
  await context.close();
});

test('عدّاد النقرات يزيد رغم أن الزائر غير مسجّل', async () => {
  const before = Number((await readLink('main')).clicks.integerValue);
  const { page, context } = await openPage(browser, SITE + '/');
  await page.waitForURL('**/landing', { timeout: 20000 });
  await context.close();

  await new Promise((r) => setTimeout(r, 1500));
  const after = await readLink('main');
  assert.equal(Number(after.clicks.integerValue), before + 1);
  assert.ok(after.lastClicked.timestampValue, 'lastClicked مضبوط من الخادم لا من جهاز الزائر');
});

test('الرابط المعطّل يشرح السبب ولا يحوّل', async () => {
  const { page, context } = await openPage(browser, SITE + '/paused');
  await page.waitForSelector('#failure:not([hidden])', { timeout: 20000 });
  assert.match(await page.textContent('#failure-message'), /معطَّل/);
  await context.close();
});

test('وجهة بمخطط javascript تُرفض ولا تُنفَّذ', async () => {
  const { page, context } = await openPage(browser, SITE + '/evil');
  await page.waitForSelector('#failure:not([hidden])', { timeout: 20000 });
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.match(await page.textContent('#failure-message'), /غير صالحة/);
  await context.close();
});

test('الرابط غير الموجود يعرض صفحة 404 باسم الرابط', async () => {
  const { page, context } = await openPage(browser, SITE + '/does-not-exist');
  await page.waitForSelector('#failure:not([hidden])', { timeout: 20000 });
  assert.match(await page.textContent('#failure-message'), /does-not-exist/);
  await context.close();
});

// ---------------------------- لوحة التحكم ----------------------------

async function login(page, email) {
  await page.click('#toggleEmailFormBtn');
  await page.fill('#emailInput', email);
  await page.fill('#passwordInput', PASSWORD);
  await page.click('#emailLoginBtn');
}

test('مستخدم من خارج قائمة المسؤولين لا يرى اللوحة', async () => {
  const { page, context } = await openPage(browser, SITE + '/admin.html');
  await page.waitForSelector('#loginContainer:not([hidden])');
  await login(page, 'stranger@gmail.com');
  await page.waitForSelector('#deniedContainer:not([hidden])', { timeout: 20000 });
  assert.ok(await page.isHidden('#dashboard'));
  await context.close();
});

test('دورة حياة رابط كاملة من اللوحة', async () => {
  const { page, context, errors } = await openPage(browser, SITE + '/admin.html', {
    viewport: { width: 1280, height: 1000 }
  });
  await page.waitForSelector('#loginContainer:not([hidden])');
  await login(page, ADMIN_EMAIL);
  await page.waitForSelector('#dashboard:not([hidden])', { timeout: 20000 });

  // إضافة
  await page.fill('#newLinkName', 'offer');
  await page.fill('#newLinkUrl', 'https://example.com/one');
  await page.fill('#newLinkDesc', 'عرض الافتتاح');
  await page.click('#addLinkBtn');
  await page.waitForSelector('.link-item:has-text("offer")', { timeout: 20000 });

  // العرض مباشرة بعد الإضافة كان ينهار على createdAt غير المكتمل
  assert.deepEqual(errors, [], 'أخطاء طرفية بعد الإضافة: ' + errors.join(' | '));
  assert.match(await page.textContent('.link-item:has-text("offer") .link-stats'), /تم الإنشاء/);

  // وجهة خطرة مرفوضة من الواجهة قبل الوصول للقواعد
  await page.evaluate(() => {
    document.getElementById('newLinkName').value = 'bad';
    document.getElementById('newLinkUrl').value = 'javascript:alert(1)';
  });
  await page.click('#addLinkBtn');
  await page.waitForSelector('#errorAlert:not([hidden])');
  assert.match(await page.textContent('#errorAlert'), /http/);

  // تعديل ثم أرشيف
  await page.click('.link-item:has-text("offer") button[data-action="edit"]');
  await page.waitForSelector('#editModal:not([hidden])');
  await page.fill('#editLinkUrl', 'https://example.com/two');
  await page.click('#editLinkBtn');
  await waitHidden(page, 'editModal');

  await page.click('.link-item:has-text("offer") button[data-action="history"]');
  await page.waitForSelector('.history-item', { timeout: 20000 });
  assert.match(await page.textContent('.history-item'), /example\.com\/one/);

  // Escape يغلق النافذة ويعيد التركيز إلى الزر الذي فتحها
  await page.keyboard.press('Escape');
  await waitHidden(page, 'historyModal');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.action), 'history');

  // وصف فيه HTML يُعرض نصًا ولا يُنفَّذ
  await page.click('.link-item:has-text("offer") button[data-action="edit"]');
  await page.waitForSelector('#editModal:not([hidden])');
  await page.fill('#editLinkDesc', '<img src=x onerror="window.__xss=1">');
  await page.click('#editLinkBtn');
  await waitHidden(page, 'editModal');
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.locator('.link-desc img').count(), 0);
  assert.match(await page.textContent('.link-item:has-text("offer") .link-desc'), /onerror/);

  // حذف عبر نافذة التأكيد المخصصة
  await page.click('.link-item:has-text("offer") button[data-action="delete"]');
  await page.waitForSelector('#confirmModal:not([hidden])');
  await page.click('#confirmYes');
  await page.waitForSelector('.link-item:has-text("offer")', { state: 'detached', timeout: 20000 });

  await context.close();
});

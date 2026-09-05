// أدوات مشتركة لاختبارات المتصفح: خادم ثابت يقلّد GitHub Pages، وتشغيل
// المتصفح، وبذر بيانات في المحاكي.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DOCS = path.join(HERE, '..', 'docs');

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

export const PROJECT_ID = process.env.GCLOUD_PROJECT || 'qr-redirect-2e522';
export const FIRESTORE_REST =
  `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
export const AUTH_REST = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

/**
 * خادم ثابت يخدم كل مسار غير موجود من 404.html — تمامًا كما يفعل
 * GitHub Pages، وهو سلوك جوهري للاختبار لأن كل الروابط الفرعية تمر منه.
 */
export function startSite(port = 4173) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(DOCS, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(DOCS, '404.html');
      res.statusCode = 404;
    }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'text/plain');
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

/** خادم يمثّل وجهة التحويل، حتى لا يخرج الاختبار إلى الإنترنت. */
export function startTarget(port = 4199) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end('<h1 id="dest">الوجهة</h1>');
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

/** يكتب مستند رابط متجاوزًا القواعد (صلاحية owner في المحاكي). */
export async function seedLink(name, { url, description = '', active = true, clicks = 0 }) {
  const response = await fetch(`${FIRESTORE_REST}/links?documentId=${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({
      fields: {
        url: { stringValue: url },
        description: { stringValue: description },
        active: { booleanValue: active },
        clicks: { integerValue: String(clicks) },
        lastClicked: { nullValue: null }
      }
    })
  });
  if (!response.ok) throw new Error('seedLink failed: ' + (await response.text()));
}

export async function readLink(name) {
  const response = await fetch(`${FIRESTORE_REST}/links/${name}`, {
    headers: { Authorization: 'Bearer owner' }
  });
  return response.ok ? (await response.json()).fields : null;
}

export async function createUser(email, password, emailVerified) {
  const signUp = await fetch(`${AUTH_REST}/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const user = await signUp.json();
  if (emailVerified) {
    await fetch(`${AUTH_REST}/accounts:update?key=fake-api-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ localId: user.localId, emailVerified: true })
    });
  }
  return user;
}

/**
 * يفتح صفحة ويجمع أخطاء الطرفية.
 *
 * PW_FIREBASE_VENDOR: مجلد فيه نسخة محلية من حزم Firebase، يُستعمل حين لا
 * يكون للمتصفح منفذ إلى gstatic.com (بيئات معزولة). بدونه تُحمَّل الحزم من
 * الشبكة كما في الإنتاج.
 */
export async function openPage(browser, url, options = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];

  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(text)) errors.push(text);
  });

  const vendor = process.env.PW_FIREBASE_VENDOR;
  if (vendor) {
    await page.route('https://www.gstatic.com/firebasejs/**', (route) => {
      const name = route.request().url().split('/').pop();
      route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: fs.readFileSync(path.join(vendor, name), 'utf8')
      });
    });
  }

  await page.goto(url, { waitUntil: 'load' });
  return { page, context, errors };
}

/**
 * انتظار إخفاء عنصر بالاستطلاع.
 * لا نستخدم waitForFunction لأن CSP في الصفحات يمنع eval — وهذا في ذاته
 * دليل على أن السياسة مطبَّقة فعلًا.
 */
export async function waitHidden(page, id, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate((x) => document.getElementById(x).hidden, id)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`انتهت المهلة بانتظار إخفاء #${id}`);
}

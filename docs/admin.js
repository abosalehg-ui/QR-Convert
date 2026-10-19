// لوحة تحكم QR Redirect — العرض والتفاعل.
//
// عمليات Firestore في links-repo.js، والنوافذ المنبثقة في modals.js.
//
// مبادئ هذا الملف:
// 1) لا innerHTML مع بيانات قادمة من Firestore — كل نص يُوضع بـ textContent،
//    وكل عنصر يُبنى بـ createElement. الكود السابق كان يحقن الوصف والوجهة
//    وإيميل المعدِّل داخل قوالب HTML، وهو مسار XSS مخزّن يفتح على أي مسؤول
//    آخر بصلاحياته الكاملة.
// 2) لا onclick داخل HTML — مستمع واحد على الحاوية يقرأ data-action.
// 3) كل عملية شبكة تعطّل زرها وتُظهر نصًا يدل على أنها جارية.

import {
  signInWithPopup, signInWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { LOCALE } from './firebase-config.js';
import { safeTargetUrl, isValidLinkName } from './link-utils.js';
import * as repo from './links-repo.js';
import { openModal, closeModal, confirmDialog } from './modals.js';

const { auth } = repo;
const $ = (id) => document.getElementById(id);

let currentUser = null;

// آخر قائمة محمّلة — البحث يرشّحها بلا قراءة جديدة من Firestore.
let allLinks = [];

// ---------------------------------------------------------------------------
// رسائل الخطأ
// ---------------------------------------------------------------------------

// رموز Firebase تقنية وإنجليزية ولا تصلح لعرضها كما هي على المستخدم،
// والكود السابق كان يعرض نصًا مثل "Firebase: Error (auth/wrong-password)"
// ملصوقًا بعد جملة عربية.
const AUTH_MESSAGES = {
  'auth/invalid-email': 'صيغة البريد الإلكتروني غير صحيحة.',
  'auth/user-not-found': 'لا يوجد حساب بهذا البريد الإلكتروني.',
  'auth/wrong-password': 'كلمة المرور غير صحيحة.',
  'auth/invalid-credential': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'auth/too-many-requests': 'محاولات كثيرة متتالية. انتظر قليلًا ثم أعد المحاولة.',
  'auth/network-request-failed': 'تعذّر الاتصال بالشبكة. تحقق من اتصالك بالإنترنت.',
  'auth/popup-closed-by-user': 'أُغلقت نافذة الدخول قبل إكمالها.',
  'auth/popup-blocked': 'المتصفح منع نافذة الدخول. اسمح بالنوافذ المنبثقة لهذا الموقع.',
  'auth/unauthorized-domain': 'هذا النطاق غير مسموح به في إعدادات Firebase Authentication.'
};

const FIRESTORE_MESSAGES = {
  'permission-denied': 'ليست لديك صلاحية لهذه العملية.',
  unavailable: 'تعذّر الاتصال بقاعدة البيانات. تحقق من اتصالك بالإنترنت.',
  'deadline-exceeded': 'استغرقت العملية وقتًا طويلًا. أعد المحاولة.',
  'not-found': 'الرابط لم يعد موجودًا. حدّث الصفحة.'
};

function humanError(error) {
  const code = error && error.code;
  return AUTH_MESSAGES[code] || FIRESTORE_MESSAGES[code] || 'حدث خطأ غير متوقع. أعد المحاولة.';
}

// ---------------------------------------------------------------------------
// التنبيهات — role="alert" في HTML يجعل قارئ الشاشة يعلنها فور ظهورها
// ---------------------------------------------------------------------------

let successTimer;

function fillAlert(node, iconName, message) {
  node.replaceChildren(icon(iconName), el('span', null, message));
  node.hidden = false;
}

function showSuccess(message) {
  const node = $('successAlert');
  fillAlert(node, 'check-circle', message);
  clearTimeout(successTimer);
  successTimer = setTimeout(() => { node.hidden = true; }, 4000);
}

/**
 * رسالة الخطأ تبقى حتى يغلقها المستخدم.
 *
 * كانت تختفي بعد ثماني ثوانٍ، فتفوت مستخدم قارئ الشاشة البطيء أو من
 * التفت عن الشاشة لحظة — والخطأ تحديدًا هو ما لا يصح أن يفوته.
 */
function showError(message) {
  const node = $('errorAlert');
  fillAlert(node, 'alert', message);
  const close = el('button', 'btn-icon alert-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'إغلاق رسالة الخطأ');
  close.append(icon('x'));
  close.addEventListener('click', () => { node.hidden = true; });
  node.append(close);
}

/**
 * يعطّل زرًا أثناء تنفيذ عملية ويشير إلى انشغاله، ثم يعيده كما كان.
 *
 * يستبدل العقدة النصية وحدها لا محتوى الزر كله، وإلا اختفت الأيقونة.
 * الأزرار التي لا نص فيها تكتفي بنبض الأيقونة عبر الصنف is-busy.
 */
async function withBusy(button, busyLabel, task) {
  if (!button) return task();

  const textNode = [...button.childNodes].find(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
  );
  const original = textNode ? textNode.textContent : null;

  button.disabled = true;
  button.classList.add('is-busy');
  if (textNode && busyLabel) textNode.textContent = ` ${busyLabel} `;

  try {
    return await task();
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
    if (textNode) textNode.textContent = original;
  }
}

// ---------------------------------------------------------------------------
// تنسيق التواريخ
// ---------------------------------------------------------------------------

/**
 * serverTimestamp() ترجع null محليًا حتى يؤكدها الخادم، فأول عرض بعد إضافة
 * رابط جديد كان يرمي "Cannot read properties of null" ويسقط القائمة كلها.
 */
function formatTimestamp(value, fallback = '—') {
  if (!value || typeof value.toDate !== 'function') return fallback;
  try {
    return value.toDate().toLocaleString(LOCALE);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// المصادقة
// ---------------------------------------------------------------------------

function showOnly(id) {
  for (const section of ['bootState', 'loginContainer', 'deniedContainer', 'dashboard']) {
    $(section).hidden = section !== id;
  }
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    showOnly('loginContainer');
    return;
  }

  // اللوحة كانت تُعرض لأي مستخدم Google مسجّل لمجرد أنه مسجّل. الكتابة كانت
  // ترفضها القواعد، لكن الضيف يرى البنية والإحصائيات ورسائل الأخطاء بلا
  // داعٍ.
  let isAdmin;
  try {
    isAdmin = await repo.hasAdminAccess();
  } catch (error) {
    // تعذّر السؤال أصلًا (شبكة، مهلة) — لا نعرف الجواب، فلا نقول "ممنوع".
    // نخرج ونعرض السبب، فيعيد المستخدم الدخول متى عادت الشبكة.
    console.error(error);
    showLoginError('تعذّر التحقق من الصلاحية: ' + humanError(error));
    await signOut(auth).catch(() => {});
    return;
  }

  if (!isAdmin) {
    $('deniedEmail').textContent = user.email || '';
    showOnly('deniedContainer');
    return;
  }

  showOnly('dashboard');
  $('userEmail').textContent = user.email || '';
  await loadDashboard();
});

$('googleLoginBtn').addEventListener('click', (event) =>
  withBusy(event.currentTarget, 'جارٍ فتح نافذة Google…', async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      showLoginError(humanError(error));
    }
  })
);

$('toggleEmailFormBtn').addEventListener('click', (event) => {
  const form = $('emailForm');
  const expanded = !form.hidden;
  form.hidden = expanded;
  event.currentTarget.setAttribute('aria-expanded', String(!expanded));
  if (!expanded) $('emailInput').focus();
});

$('emailForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('emailLoginBtn');
  await withBusy(button, 'جارٍ الدخول…', async () => {
    try {
      await signInWithEmailAndPassword(auth, $('emailInput').value, $('passwordInput').value);
    } catch (error) {
      showLoginError(humanError(error));
    }
  });
});

$('logoutBtn').addEventListener('click', async () => {
  try {
    await signOut(auth);
  } catch (error) {
    showError(humanError(error));
  }
});

$('deniedLogoutBtn').addEventListener('click', () => signOut(auth));

function showLoginError(message) {
  fillAlert($('loginError'), 'alert', message);
}

// ---------------------------------------------------------------------------
// تحميل اللوحة
// ---------------------------------------------------------------------------

async function loadDashboard() {
  try {
    // قراءة واحدة للمجموعة تخدم الإحصائيات والقائمة معًا.
    allLinks = await repo.fetchLinks();
    renderStats(allLinks);
    renderLinks();
  } catch (error) {
    console.error(error);
    showError('فشل تحميل البيانات: ' + humanError(error));
  }
}

function renderStats(links) {
  let totalClicks = 0;
  let activeCount = 0;

  for (const { data } of links) {
    totalClicks += data.clicks || 0;
    if (data.active) activeCount += 1;
  }

  $('totalClicks').textContent = totalClicks.toLocaleString(LOCALE);
  $('totalLinks').textContent = links.length.toLocaleString(LOCALE);
  $('activeLinks').textContent = activeCount.toLocaleString(LOCALE);
}

/** يبني عنصرًا نصيًا آمنًا — النص يمر دائمًا عبر textContent. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * أيقونة من مستودع الرموز في أعلى الصفحة.
 * أُخذت مكان الإيموجي: حجم ولون متسقان عبر الأنظمة، وتتبع لون النص
 * في الوضعين الفاتح والداكن.
 */
function icon(name, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/** زر أيقونة بلا نص مرئي — التسمية لقارئ الشاشة عبر aria-label. */
function actionButton(iconName, ariaLabel, action, linkId, extraClass) {
  const button = el('button', `btn-icon ${extraClass || ''}`.trim());
  button.type = 'button';
  button.title = ariaLabel;
  button.setAttribute('aria-label', ariaLabel);
  button.dataset.action = action;
  button.dataset.linkId = linkId;
  button.append(icon(iconName));
  return button;
}

function emptyState(iconName, message) {
  const empty = el('div', 'empty-state');
  empty.append(icon(iconName), el('p', null, message));
  return empty;
}

/** يطابق البحث الاسم أو الوجهة أو الوصف، بلا حساسية لحالة الأحرف. */
function matchesSearch({ id, data }, term) {
  if (!term) return true;
  return [id, data.url, data.description]
    .some((value) => typeof value === 'string' && value.toLowerCase().includes(term));
}

function renderLinks() {
  const list = $('linksList');
  list.replaceChildren();

  if (!allLinks.length) {
    list.append(emptyState('inbox', 'لا توجد روابط بعد. أضف أول رابط من النموذج أعلاه.'));
    return;
  }

  const term = $('linkSearch').value.trim().toLowerCase();
  const visible = allLinks.filter((link) => matchesSearch(link, term));

  if (!visible.length) {
    list.append(emptyState('search', `لا توجد روابط تطابق "${term}".`));
    return;
  }

  const base = new URL('./', window.location.href).href;
  for (const link of visible) list.append(linkItem(link, base));
}

function linkItem({ id: linkId, data }, base) {
  const fullUrl = base + linkId;
  const item = el('div', 'link-item');

  // ---- الترويسة: الاسم، الحالة، ثم أزرار الإجراءات ----
  const header = el('div', 'link-header');
  header.append(el('span', 'link-name', linkId));
  header.append(el(
    'span',
    `badge ${data.active ? 'badge-ok' : 'badge-off'}`,
    data.active ? 'نشط' : 'معطَّل'
  ));

  const actions = el('div', 'link-actions');
  actions.append(actionButton('edit', `تعديل الرابط ${linkId}`, 'edit', linkId));
  actions.append(actionButton('history', `عرض أرشيف تعديلات ${linkId}`, 'history', linkId));
  actions.append(actionButton(
    data.active ? 'pause' : 'play',
    `${data.active ? 'تعطيل' : 'تفعيل'} الرابط ${linkId}`,
    'toggle',
    linkId
  ));
  actions.append(actionButton('trash', `حذف الرابط ${linkId}`, 'delete', linkId));
  header.append(actions);
  item.append(header);

  // ---- العنوان القصير مع زر نسخه ----
  const urlRow = el('div', 'link-url');
  const copyBtn = el('button', 'btn-icon');
  copyBtn.type = 'button';
  copyBtn.title = `نسخ رابط ${linkId}`;
  copyBtn.setAttribute('aria-label', `نسخ رابط ${linkId}`);
  copyBtn.dataset.action = 'copy';
  copyBtn.dataset.value = fullUrl;
  copyBtn.append(icon('copy'));
  urlRow.append(copyBtn, el('span', null, fullUrl));
  item.append(urlRow);

  // ---- الوجهة والوصف ----
  const target = el('div', 'link-target');
  target.append(icon('link'), el('span', null, data.url || '—'));
  item.append(target);

  if (data.description) item.append(el('div', 'link-desc', data.description));

  // ---- الإحصائيات ----
  const stats = el('div', 'link-stats');
  const clicks = el('span');
  clicks.append(icon('cursor'), el('span', null,
    `${(data.clicks || 0).toLocaleString(LOCALE)} نقرة`));
  const last = el('span');
  last.append(icon('clock'), el('span', null,
    `آخر نقرة: ${formatTimestamp(data.lastClicked, 'لا شيء بعد')}`));
  const created = el('span');
  created.append(icon('calendar'), el('span', null,
    `تم الإنشاء: ${formatTimestamp(data.createdAt)}`));
  stats.append(clicks, last, created);
  item.append(stats);

  return item;
}

$('linkSearch').addEventListener('input', renderLinks);

// مستمع واحد للقائمة كلها بدل onclick مضمّن في كل زر.
$('linksList').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const { action, linkId, value } = button.dataset;
  if (action === 'copy') return copyToClipboard(value, button);
  if (action === 'edit') return openEditModal(linkId, button);
  if (action === 'history') return openHistoryModal(linkId, button);
  if (action === 'toggle') return toggleLinkStatus(linkId, button);
  if (action === 'delete') return deleteLink(linkId, button);
});

// ---------------------------------------------------------------------------
// العمليات على الروابط
// ---------------------------------------------------------------------------

$('addLinkForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const name = $('newLinkName').value.trim();
  const url = $('newLinkUrl').value.trim();
  const description = $('newLinkDesc').value.trim();

  if (!isValidLinkName(name)) {
    showError('اسم الرابط يقبل الحروف الإنجليزية والأرقام والشرطتين فقط، بحد أقصى 64 حرفًا.');
    return;
  }

  if (!safeTargetUrl(url)) {
    showError('الرابط الهدف يجب أن يبدأ بـ http:// أو https://');
    return;
  }

  await withBusy($('addLinkBtn'), 'جارٍ الحفظ…', async () => {
    try {
      if (await repo.linkExists(name)) {
        showError('اسم الرابط موجود مسبقًا، اختر اسمًا آخر.');
        return;
      }

      // حذف الرابط لا يحذف أرشيفه، فالاسم المُعاد استخدامه يرث سجل الرابط
      // القديم. لا نمنع ذلك (قد يكون مقصودًا) لكن لا نخفيه.
      if (await repo.hasHistory(name)) {
        const proceed = await confirmDialog(
          'اسم مستخدم سابقًا',
          `الاسم "${name}" كان لرابط حُذف، وأرشيف تعديلاته ما زال محفوظًا. الرابط الجديد سيظهر معه نفس الأرشيف. متابعة؟`,
          'متابعة'
        );
        if (!proceed) return;
      }

      await repo.createLink(name, { url, description }, currentUser.email);

      showSuccess('تم إضافة الرابط بنجاح!');
      $('addLinkForm').reset();
      $('linkPreview').textContent = 'link1';
      await loadDashboard();
    } catch (error) {
      console.error(error);
      showError('فشل إضافة الرابط: ' + humanError(error));
    }
  });
});

$('newLinkName').addEventListener('input', (event) => {
  $('linkPreview').textContent = event.target.value || 'link1';
});

function openEditModal(linkId, trigger) {
  const link = allLinks.find((item) => item.id === linkId);
  if (!link) {
    showError(FIRESTORE_MESSAGES['not-found']);
    return;
  }
  $('editLinkId').value = linkId;
  $('editLinkName').textContent = linkId;
  $('editLinkUrl').value = link.data.url || '';
  $('editLinkDesc').value = link.data.description || '';
  openModal('editModal', trigger);
}

$('editLinkForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  const linkId = $('editLinkId').value;
  const url = $('editLinkUrl').value.trim();
  const description = $('editLinkDesc').value.trim();

  if (!safeTargetUrl(url)) {
    showError('الرابط الهدف يجب أن يبدأ بـ http:// أو https://');
    return;
  }

  await withBusy($('editLinkBtn'), 'جارٍ الحفظ…', async () => {
    try {
      await repo.updateLink(linkId, { url, description }, currentUser.email);
      showSuccess('تم تحديث الرابط بنجاح!');
      closeModal('editModal');
      await loadDashboard();
    } catch (error) {
      console.error(error);
      showError('فشل تحديث الرابط: ' + humanError(error));
    }
  });
});

async function toggleLinkStatus(linkId, button) {
  await withBusy(button, '…', async () => {
    try {
      const nowActive = await repo.toggleActive(linkId);
      showSuccess(nowActive ? 'تم تفعيل الرابط' : 'تم تعطيل الرابط');
      await loadDashboard();
    } catch (error) {
      showError('فشل تغيير حالة الرابط: ' + humanError(error));
    }
  });
}

async function deleteLink(linkId, button) {
  const confirmed = await confirmDialog(
    'حذف الرابط',
    `سيُحذف الرابط "${linkId}" نهائيًا، وأي رمز QR مطبوع يشير إليه سيتوقف عن العمل. أرشيف تعديلاته يبقى محفوظًا للمراجعة. لا يمكن التراجع.`
  );
  if (!confirmed) return;

  await withBusy(button, 'جارٍ الحذف…', async () => {
    try {
      await repo.deleteLink(linkId);
      showSuccess('تم حذف الرابط بنجاح!');
      await loadDashboard();
    } catch (error) {
      showError('فشل حذف الرابط: ' + humanError(error));
    }
  });
}

async function openHistoryModal(linkId, trigger) {
  const list = $('historyList');
  list.replaceChildren(el('div', 'empty-state', 'جارٍ التحميل…'));
  openModal('historyModal', trigger);

  try {
    const entries = await repo.fetchHistory(linkId);
    list.replaceChildren();

    if (!entries.length) {
      list.append(emptyState('history', 'لا توجد تعديلات سابقة على هذا الرابط.'));
      return;
    }

    for (const data of entries) {
      const item = el('div', 'history-item');
      item.append(el('div', 'history-date',
        `${formatTimestamp(data.changedAt)} — بواسطة ${data.changedBy || '—'}`));
      item.append(el('div', 'history-url', data.url || '—'));
      if (data.description) item.append(el('div', 'link-desc', data.description));
      list.append(item);
    }
  } catch (error) {
    list.replaceChildren(el('div', 'empty-state', 'فشل تحميل الأرشيف: ' + humanError(error)));
  }
}

async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    showSuccess('تم نسخ الرابط!');
  } catch {
    showError('تعذّر النسخ. انسخ الرابط يدويًا.');
  }
  button.focus();
}

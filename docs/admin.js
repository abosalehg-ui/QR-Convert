// لوحة تحكم QR Redirect.
//
// مبادئ هذا الملف:
// 1) لا innerHTML مع بيانات قادمة من Firestore — كل نص يُوضع بـ textContent،
//    وكل عنصر يُبنى بـ createElement. الكود السابق كان يحقن الوصف والوجهة
//    وإيميل المعدِّل داخل قوالب HTML، وهو مسار XSS مخزّن يفتح على أي مسؤول
//    آخر بصلاحياته الكاملة (البند 6).
// 2) لا onclick داخل HTML — مستمع واحد على الحاوية يقرأ data-action.
// 3) كل عملية شبكة تعطّل زرها وتُظهر نصًا يدل على أنها جارية (البند 11).

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getAuth, signInWithPopup, signInWithEmailAndPassword, GoogleAuthProvider,
  onAuthStateChanged, signOut, connectAuthEmulator
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore, collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc,
  setDoc, writeBatch, query, orderBy, serverTimestamp, connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { firebaseConfig, LOCALE, useEmulator, EMULATOR } from './firebase-config.js';
import { safeTargetUrl } from './link-utils.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

if (useEmulator) {
  connectFirestoreEmulator(db, EMULATOR.firestoreHost, EMULATOR.firestorePort);
  connectAuthEmulator(auth, EMULATOR.authUrl, { disableWarnings: true });
}

const $ = (id) => document.getElementById(id);

// مستند لا يُنشأ أبدًا — يُستعمل لسؤال القواعد عن الصلاحية فقط.
const ACCESS_PROBE_ID = 'access-probe';

let currentUser = null;
let lastFocusedElement = null;

// ---------------------------------------------------------------------------
// رسائل الخطأ
// ---------------------------------------------------------------------------

// رموز Firebase تقنية وإنجليزية ولا تصلح لعرضها كما هي على المستخدم،
// والكود السابق كان يعرض نصًا مثل "Firebase: Error (auth/wrong-password)"
// ملصوقًا بعد جملة عربية (البند 11).
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
  'deadline-exceeded': 'استغرقت العملية وقتًا طويلًا. أعد المحاولة.'
};

function humanError(error) {
  const code = error && error.code;
  return AUTH_MESSAGES[code] || FIRESTORE_MESSAGES[code] || 'حدث خطأ غير متوقع. أعد المحاولة.';
}

// ---------------------------------------------------------------------------
// التنبيهات — role="alert" في HTML يجعل قارئ الشاشة يعلنها فور ظهورها
// ---------------------------------------------------------------------------

let successTimer;
let errorTimer;

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

function showError(message) {
  const node = $('errorAlert');
  fillAlert(node, 'alert', message);
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { node.hidden = true; }, 8000);
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
 * رابط جديد كان يرمي "Cannot read properties of null" ويسقط القائمة كلها
 * (البند 8).
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

/**
 * يتحقق أن المستخدم الحالي مسؤول فعلًا — بسؤال القواعد نفسها.
 *
 * مجموعة meta الفرعية مقروءة للمسؤولين فقط، والقواعد تُقيّم الصلاحية قبل
 * وجود المستند: المسؤول يحصل على لقطة فارغة، وغيره على permission-denied.
 * الفائدة: لا حاجة لتكرار قائمة الإيميلات في كود الواجهة.
 *
 * هذا حاجز واجهة لا حاجز أمني — الحماية الحقيقية تبقى في firestore.rules.
 *
 * المعرّف اسم عادي عمدًا: Firestore يرفض أي معرّف يبدأ وينتهي بشرطتين
 * سفليتين (محجوز)، فيفشل الفحص بخطأ invalid-argument لا permission-denied
 * ويُحرم المسؤول نفسه من الدخول.
 */
async function hasAdminAccess() {
  try {
    await getDoc(doc(db, 'links', ACCESS_PROBE_ID, 'meta', 'probe'));
    return true;
  } catch {
    return false;
  }
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  $('bootState').hidden = true;

  if (!user) {
    $('loginContainer').hidden = false;
    $('dashboard').hidden = true;
    $('deniedContainer').hidden = true;
    return;
  }

  $('loginContainer').hidden = true;

  // اللوحة كانت تُعرض لأي مستخدم Google مسجّل لمجرد أنه مسجّل. الكتابة كانت
  // ترفضها القواعد، لكن الضيف يرى البنية والإحصائيات ورسائل الأخطاء بلا
  // داعٍ (البند 7).
  if (!(await hasAdminAccess())) {
    $('dashboard').hidden = true;
    $('deniedEmail').textContent = user.email || '';
    $('deniedContainer').hidden = false;
    return;
  }

  $('deniedContainer').hidden = true;
  $('dashboard').hidden = false;
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
    // الكود السابق كان ينفّذ getDocs مرتين في كل تحميل (البند 13).
    const snapshot = await getDocs(collection(db, 'links'));
    renderStats(snapshot);
    renderLinks(snapshot);
  } catch (error) {
    console.error(error);
    showError('فشل تحميل البيانات: ' + humanError(error));
  }
}

function renderStats(snapshot) {
  let totalClicks = 0;
  let activeCount = 0;

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    totalClicks += data.clicks || 0;
    if (data.active) activeCount += 1;
  });

  $('totalClicks').textContent = totalClicks.toLocaleString(LOCALE);
  $('totalLinks').textContent = snapshot.size.toLocaleString(LOCALE);
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

function renderLinks(snapshot) {
  const list = $('linksList');
  list.replaceChildren();

  if (snapshot.empty) {
    const empty = el('div', 'empty-state');
    empty.append(icon('inbox'), el('p', null, 'لا توجد روابط بعد. أضف أول رابط من النموذج أعلاه.'));
    list.append(empty);
    return;
  }

  const base = new URL('./', window.location.href).href;

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const linkId = docSnap.id;
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

    list.append(item);
  });
}

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

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    showError('اسم الرابط يقبل الحروف الإنجليزية والأرقام والشرطتين فقط.');
    return;
  }

  if (!safeTargetUrl(url)) {
    showError('الرابط الهدف يجب أن يبدأ بـ http:// أو https://');
    return;
  }

  await withBusy($('addLinkBtn'), 'جارٍ الحفظ…', async () => {
    try {
      const linkRef = doc(db, 'links', name);
      if ((await getDoc(linkRef)).exists()) {
        showError('اسم الرابط موجود مسبقًا، اختر اسمًا آخر.');
        return;
      }

      // المستند العام يحمل ما يحتاجه التحويل فقط. إيميل من أنشأ الرابط
      // ينتقل إلى meta/admin المقروءة للمسؤولين وحدهم، لأن مجموعة links
      // مقروءة للجميع بالضرورة (البند 7).
      const batch = writeBatch(db);
      batch.set(linkRef, {
        url,
        description,
        active: true,
        clicks: 0,
        createdAt: serverTimestamp(),
        lastClicked: null
      });
      batch.set(doc(db, 'links', name, 'meta', 'admin'), {
        createdBy: currentUser.email,
        createdAt: serverTimestamp()
      });
      await batch.commit();

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

async function openEditModal(linkId, trigger) {
  try {
    const snapshot = await getDoc(doc(db, 'links', linkId));
    if (!snapshot.exists()) {
      showError('الرابط لم يعد موجودًا. حدّث الصفحة.');
      return;
    }
    const data = snapshot.data();
    $('editLinkId').value = linkId;
    $('editLinkName').textContent = linkId;
    $('editLinkUrl').value = data.url || '';
    $('editLinkDesc').value = data.description || '';
    openModal('editModal', trigger);
  } catch (error) {
    showError('فشل تحميل بيانات الرابط: ' + humanError(error));
  }
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
      const linkRef = doc(db, 'links', linkId);
      const oldData = (await getDoc(linkRef)).data();

      await addDoc(collection(db, 'links', linkId, 'history'), {
        url: oldData.url,
        description: oldData.description || '',
        changedAt: serverTimestamp(),
        changedBy: currentUser.email
      });

      await updateDoc(linkRef, { url, description, updatedAt: serverTimestamp() });

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
      const snapshot = await getDoc(doc(db, 'links', linkId));
      await updateDoc(doc(db, 'links', linkId), { active: !snapshot.data().active });
      showSuccess(snapshot.data().active ? 'تم تعطيل الرابط' : 'تم تفعيل الرابط');
      await loadDashboard();
    } catch (error) {
      showError('فشل تغيير حالة الرابط: ' + humanError(error));
    }
  });
}

async function deleteLink(linkId, button) {
  const confirmed = await confirmDialog(
    'حذف الرابط',
    `سيُحذف الرابط "${linkId}" نهائيًا مع أرشيف تعديلاته. أي رمز QR مطبوع يشير إليه سيتوقف عن العمل. لا يمكن التراجع.`
  );
  if (!confirmed) return;

  await withBusy(button, 'جارٍ الحذف…', async () => {
    try {
      await deleteDoc(doc(db, 'links', linkId));
      // مستند meta ليس جزءًا من المستند الأب في Firestore، فحذفه منفصل.
      await deleteDoc(doc(db, 'links', linkId, 'meta', 'admin')).catch(() => {});
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
    const snapshot = await getDocs(
      query(collection(db, 'links', linkId, 'history'), orderBy('changedAt', 'desc'))
    );

    list.replaceChildren();

    if (snapshot.empty) {
      const empty = el('div', 'empty-state');
      empty.append(icon('history'), el('p', null, 'لا توجد تعديلات سابقة على هذا الرابط.'));
      list.append(empty);
      return;
    }

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const item = el('div', 'history-item');
      item.append(el('div', 'history-date',
        `${formatTimestamp(data.changedAt)} — بواسطة ${data.changedBy || '—'}`));
      item.append(el('div', 'history-url', data.url || '—'));
      if (data.description) item.append(el('div', 'link-desc', data.description));
      list.append(item);
    });
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

// ---------------------------------------------------------------------------
// النوافذ المنبثقة — دعم كامل للوحة المفاتيح (البند 10)
// ---------------------------------------------------------------------------

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// نداء يُنفَّذ عند إغلاق نافذة بأي طريقة (زر الإغلاق، Escape، النقر خارجها).
// بدونه كانت نافذة التأكيد تترك وعدها معلّقًا إذا أُغلقت بغير زرّيها.
const onCloseHandlers = new Map();

function openModal(id, trigger, onClose) {
  lastFocusedElement = trigger || document.activeElement;
  if (onClose) onCloseHandlers.set(id, onClose);
  const modal = $(id);
  modal.hidden = false;
  const first = modal.querySelector(FOCUSABLE);
  if (first) first.focus();
}

function closeModal(id) {
  $(id).hidden = true;
  // إعادة التركيز لموضعه: بدونها يقفز التركيز لأول الصفحة بعد كل إغلاق.
  if (lastFocusedElement && document.contains(lastFocusedElement)) lastFocusedElement.focus();
  lastFocusedElement = null;

  const handler = onCloseHandlers.get(id);
  if (handler) {
    onCloseHandlers.delete(id);
    handler();
  }
}

function openModalId() {
  const modal = document.querySelector('.modal:not([hidden])');
  return modal ? modal.id : null;
}

document.querySelectorAll('[data-close-modal]').forEach((button) => {
  button.addEventListener('click', () => closeModal(button.dataset.closeModal));
});

document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal(modal.id);
  });
});

document.addEventListener('keydown', (event) => {
  const id = openModalId();
  if (!id) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeModal(id);
    return;
  }

  // حبس التركيز داخل النافذة: بدونه ينتقل Tab إلى عناصر خلف الطبقة
  // المعتمة فيعلق مستخدم لوحة المفاتيح.
  if (event.key === 'Tab') {
    const items = [...$(id).querySelectorAll(FOCUSABLE)].filter((n) => !n.disabled);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

/**
 * نافذة تأكيد بهوية اللوحة بدل confirm() الأصلية التي لا يمكن تنسيقها
 * ولا ترجمة أزرارها.
 */
function confirmDialog(title, message) {
  return new Promise((resolve) => {
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      $('confirmYes').removeEventListener('click', onYes);
      $('confirmNo').removeEventListener('click', onNo);
      resolve(result);
    };

    const onYes = () => { finish(true); closeModal('confirmModal'); };
    const onNo = () => { finish(false); closeModal('confirmModal'); };

    $('confirmYes').addEventListener('click', onYes);
    $('confirmNo').addEventListener('click', onNo);

    // أي إغلاق آخر (Escape، زر ×، نقرة خارج النافذة) يعني "لا".
    openModal('confirmModal', document.activeElement, () => finish(false));
  });
}

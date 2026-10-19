// طبقة البيانات في لوحة التحكم: كل قراءة وكتابة على Firestore تمر من هنا.
//
// فُصلت عن admin.js حتى يبقى ذاك الملف عرضًا وتفاعلًا فقط، وحتى تكون كل
// كتابة متعددة المستندات في مكان واحد يسهل التأكد من أنها ذرّية.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, collection, getDocs, doc, getDoc, updateDoc, writeBatch, query, orderBy, limit,
  serverTimestamp, connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig, useEmulator, EMULATOR } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db = getFirestore(app);

if (useEmulator) {
  connectFirestoreEmulator(db, EMULATOR.firestoreHost, EMULATOR.firestorePort);
  connectAuthEmulator(auth, EMULATOR.authUrl, { disableWarnings: true });
}

// مستند لا يُنشأ أبدًا — يُستعمل لسؤال القواعد عن الصلاحية فقط.
const ACCESS_PROBE_ID = 'access-probe';

const linkRef = (id) => doc(db, 'links', id);

/** خطأ برمز تفهمه humanError() في admin.js. */
function notFound() {
  const error = new Error('link not found');
  error.code = 'not-found';
  return error;
}

/**
 * يتحقق أن المستخدم الحالي مسؤول فعلًا — بسؤال القواعد نفسها.
 *
 * مجموعة meta الفرعية مقروءة للمسؤولين فقط، والقواعد تُقيّم الصلاحية قبل
 * وجود المستند: المسؤول يحصل على لقطة فارغة، وغيره على permission-denied.
 * الفائدة: لا حاجة لتكرار قائمة الإيميلات في كود الواجهة.
 *
 * يرجع false عند permission-denied وحده، ويرمي أي خطأ آخر: انقطاع الشبكة
 * ليس رفض صلاحية، ومعاملته كذلك كانت تُري المسؤول الحقيقي شاشة "ممنوع".
 *
 * هذا حاجز واجهة لا حاجز أمني — الحماية الحقيقية تبقى في firestore.rules.
 *
 * المعرّف اسم عادي عمدًا: Firestore يرفض أي معرّف يبدأ وينتهي بشرطتين
 * سفليتين (محجوز)، فيفشل الفحص بخطأ invalid-argument لا permission-denied
 * ويُحرم المسؤول نفسه من الدخول.
 */
export async function hasAdminAccess() {
  try {
    await getDoc(doc(db, 'links', ACCESS_PROBE_ID, 'meta', 'probe'));
    return true;
  } catch (error) {
    if (error.code === 'permission-denied') return false;
    throw error;
  }
}

/**
 * كل الروابط، الأحدث إنشاءً أولًا.
 *
 * الترتيب في المتصفح لا بـ orderBy('createdAt'): الاستعلام المرتّب يُسقط
 * بصمت كل مستند بلا ذلك الحقل، فيختفي من اللوحة.
 */
export async function fetchLinks() {
  const snapshot = await getDocs(collection(db, 'links'));
  const millis = (value) => (value && typeof value.toMillis === 'function' ? value.toMillis() : -Infinity);
  return snapshot.docs
    .map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }))
    .sort((a, b) => millis(b.data.createdAt) - millis(a.data.createdAt) || a.id.localeCompare(b.id));
}

export async function linkExists(id) {
  return (await getDoc(linkRef(id))).exists();
}

/** هل بقي لهذا الاسم أرشيف من رابط سابق حُذف؟ */
export async function hasHistory(id) {
  const snapshot = await getDocs(query(collection(db, 'links', id, 'history'), limit(1)));
  return !snapshot.empty;
}

/**
 * ينشئ رابطًا. المستند العام يحمل ما يحتاجه التحويل فقط؛ إيميل من أنشأه
 * ينتقل إلى meta/admin المقروءة للمسؤولين وحدهم، لأن مستندات links
 * مقروءة للجميع بالضرورة.
 */
export async function createLink(id, { url, description }, email) {
  const batch = writeBatch(db);
  batch.set(linkRef(id), {
    url,
    description,
    active: true,
    clicks: 0,
    createdAt: serverTimestamp(),
    lastClicked: null
  });
  batch.set(doc(db, 'links', id, 'meta', 'admin'), {
    createdBy: email,
    createdAt: serverTimestamp()
  });
  await batch.commit();
}

/**
 * يغيّر الوجهة والوصف ويؤرشف القيم القديمة — في دفعة واحدة.
 *
 * كانتا عمليتين منفصلتين: لو فشل التحديث بعد كتابة الأرشيف بقي في السجل
 * تعديل لم يحدث.
 */
export async function updateLink(id, { url, description }, email) {
  const snapshot = await getDoc(linkRef(id));
  if (!snapshot.exists()) throw notFound();
  const old = snapshot.data();

  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'links', id, 'history')), {
    url: old.url,
    description: old.description || '',
    changedAt: serverTimestamp(),
    changedBy: email
  });
  batch.update(linkRef(id), { url, description, updatedAt: serverTimestamp() });
  await batch.commit();
}

/** يقلب حالة الرابط ويرجع الحالة الجديدة. */
export async function toggleActive(id) {
  const snapshot = await getDoc(linkRef(id));
  if (!snapshot.exists()) throw notFound();
  const nowActive = !snapshot.data().active;
  await updateDoc(linkRef(id), { active: nowActive });
  return nowActive;
}

/**
 * يحذف الرابط ومستند meta الخاص به.
 *
 * الأرشيف يبقى عمدًا: القواعد تمنع حذفه، و Firestore لا يحذف المجموعات
 * الفرعية مع المستند الأب.
 */
export async function deleteLink(id) {
  const batch = writeBatch(db);
  batch.delete(linkRef(id));
  batch.delete(doc(db, 'links', id, 'meta', 'admin'));
  await batch.commit();
}

export async function fetchHistory(id) {
  const snapshot = await getDocs(
    query(collection(db, 'links', id, 'history'), orderBy('changedAt', 'desc'))
  );
  return snapshot.docs.map((docSnap) => docSnap.data());
}

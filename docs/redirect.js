// منطق التحويل المشترك بين index.html (الرابط الجذري) و 404.html (كل رابط فرعي).
//
// لماذا في 404.html؟ GitHub Pages موقع ثابت: لا يوجد ملف اسمه `main`، فأي
// طلب لـ /QR-Convert/main يُخدَم من 404.html. لذلك منطق التحويل يجب أن يعيش
// هنا، وواجهة "الصفحة غير موجودة" هي حالة الفشل بعد البحث لا الحالة
// الافتراضية (البند 2).

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getFirestore, doc, getDoc, updateDoc, increment, serverTimestamp,
  connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { firebaseConfig, useEmulator, EMULATOR } from './firebase-config.js';
import { resolveLinkName, safeTargetUrl } from './link-utils.js';

const db = getFirestore(initializeApp(firebaseConfig));
if (useEmulator) connectFirestoreEmulator(db, EMULATOR.firestoreHost, EMULATOR.firestorePort);

// المجلد الذي يعيش فيه هذا الملف هو جذر الموقع (يعمل على نطاق مخصص أيضًا).
const BASE_DIR = new URL('./', import.meta.url).pathname;

// أقصى ما ننتظره لتسجيل النقرة قبل تحويل الزائر على أي حال.
const CLICK_WRITE_BUDGET_MS = 800;

/**
 * ينفّذ التحويل. onFail تُستدعى برسالة عربية عند تعذّره.
 */
export async function runRedirect({ onStatus = () => {}, onFail = () => {} } = {}) {
  const linkName = resolveLinkName(window.location.pathname, BASE_DIR);
  onStatus(`جاري تحميل الرابط: ${linkName}`);

  let snapshot;
  try {
    snapshot = await getDoc(doc(db, 'links', linkName));
  } catch (error) {
    console.error('تعذّر الاتصال بقاعدة البيانات:', error);
    onFail('تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.', linkName);
    return;
  }

  if (!snapshot.exists()) {
    onFail(`لا يوجد رابط مسجّل باسم "${linkName}".`, linkName);
    return;
  }

  const data = snapshot.data();
  if (!data.active) {
    onFail(`الرابط "${linkName}" معطَّل حاليًا.`, linkName);
    return;
  }

  const target = safeTargetUrl(data.url);
  if (!target) {
    console.error('وجهة غير صالحة:', data.url);
    onFail('وجهة هذا الرابط غير صالحة. يرجى التواصل مع المسؤول.', linkName);
    return;
  }

  // عدّاد النقرات: يُسجَّل إن أمكن، ولا يعطّل التحويل أبدًا.
  //
  // الكود القديم كان ينتظره بـ await قبل التحويل، وقواعد Firestore كانت
  // ترفض كتابة الزائر غير المسجّل، فيقفز التنفيذ إلى catch ولا يُنفَّذ سطر
  // التحويل إطلاقًا — أي أن كل زائر يرى صفحة خطأ (البند 1).
  //
  // والعكس أيضًا لا يصح: إطلاق الكتابة بلا انتظار ثم التحويل فورًا يهدم
  // الصفحة قبل أن تغادر الكتابة المتصفح، فتضيع كل النقرات (أثبته اختبار
  // المتصفح في tests/). الحل سباق بمهلة قصيرة: ننتظر الكتابة بحد أقصى
  // CLICK_WRITE_BUDGET_MS، وأي فشل أو بطء لا يؤخر الزائر أكثر من ذلك.
  //
  // serverTimestamp بدل new Date() لأن ساعة جهاز الزائر ليست مصدرًا موثوقًا.
  const clickWrite = updateDoc(doc(db, 'links', linkName), {
    clicks: increment(1),
    lastClicked: serverTimestamp()
  }).catch((error) => console.warn('تعذّر تسجيل النقرة:', error));

  await Promise.race([
    clickWrite,
    new Promise((resolve) => setTimeout(resolve, CLICK_WRITE_BUDGET_MS))
  ]);

  // replace بدل href: لا نترك صفحة التحويل في سجل التصفح، فزر الرجوع
  // يعيد الزائر لما قبلها بدل أن يعيد تشغيل التحويل.
  window.location.replace(target);
}

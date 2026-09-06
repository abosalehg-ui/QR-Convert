// اختبارات قواعد أمان Firestore على المحاكي.
//
// شغّلها بـ: npm run test:rules  (تحتاج Java و firebase-tools)
//
// لماذا هذه الاختبارات تحديدًا؟ لأن غيابها هو ما سمح بوصول عطل التحويل
// إلى الإنتاج: القواعد كانت ترفض زيادة عدّاد النقرات من الزائر، وصفحة
// التحويل كانت تنتظر تلك الكتابة، فيرى كل زائر صفحة خطأ (البند 9).

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, getDocs, increment, serverTimestamp
} from 'firebase/firestore';

const ADMIN_EMAIL = 'abo.saleh.g@gmail.com';
const OUTSIDER_EMAIL = 'someone.else@gmail.com';

let testEnv;

function admin() {
  return testEnv.authenticatedContext('admin-uid', {
    email: ADMIN_EMAIL,
    email_verified: true
  }).firestore();
}

function unverifiedAdmin() {
  return testEnv.authenticatedContext('spoof-uid', {
    email: ADMIN_EMAIL,
    email_verified: false
  }).firestore();
}

function outsider() {
  return testEnv.authenticatedContext('other-uid', {
    email: OUTSIDER_EMAIL,
    email_verified: true
  }).firestore();
}

function visitor() {
  return testEnv.unauthenticatedContext().firestore();
}

const VALID_LINK = {
  url: 'https://example.com',
  description: 'رابط تجريبي',
  active: true,
  clicks: 0,
  lastClicked: null
};

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'qr-redirect-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080
    }
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'links', 'main'), { ...VALID_LINK, createdAt: new Date() });
    await setDoc(doc(db, 'links', 'main', 'meta', 'admin'), { createdBy: ADMIN_EMAIL });
    await addDoc(collection(db, 'links', 'main', 'history'), {
      url: 'https://old.example.com',
      changedBy: ADMIN_EMAIL,
      changedAt: new Date()
    });
  });
});

// ------------------------- القراءة العامة -------------------------

test('الزائر يقرأ الرابط — التحويل يعتمد عليه', async () => {
  await assertSucceeds(getDoc(doc(visitor(), 'links', 'main')));
});

// ------------------------- عدّاد النقرات -------------------------

test('الزائر يزيد العدّاد بواحد', async () => {
  await assertSucceeds(updateDoc(doc(visitor(), 'links', 'main'), {
    clicks: increment(1),
    lastClicked: serverTimestamp()
  }));
});

test('الزائر لا يستطيع تغيير الوجهة تحت غطاء العدّاد', async () => {
  await assertFails(updateDoc(doc(visitor(), 'links', 'main'), {
    clicks: increment(1),
    lastClicked: serverTimestamp(),
    url: 'https://evil.example.com'
  }));
});

test('الزائر لا يستطيع تضخيم العدّاد دفعة واحدة', async () => {
  await assertFails(updateDoc(doc(visitor(), 'links', 'main'), {
    clicks: increment(1000),
    lastClicked: serverTimestamp()
  }));
});

test('الزائر لا يستطيع تعطيل رابط ولا حذفه', async () => {
  await assertFails(updateDoc(doc(visitor(), 'links', 'main'), { active: false }));
  await assertFails(deleteDoc(doc(visitor(), 'links', 'main')));
});

// ------------------------- صلاحيات المسؤول -------------------------

test('المسؤول ينشئ ويعدّل ويحذف', async () => {
  const db = admin();
  await assertSucceeds(setDoc(doc(db, 'links', 'promo'), { ...VALID_LINK, createdAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db, 'links', 'main'), { url: 'https://new.example.com' }));
  await assertSucceeds(deleteDoc(doc(db, 'links', 'main')));
});

test('المسؤول لا يستطيع حفظ وجهة بمخطط خطير', async () => {
  // الحاجز الثاني بعد فحص المتصفح: واجهة Firestore المباشرة تتجاوز النموذج
  await assertFails(setDoc(doc(admin(), 'links', 'bad'), {
    ...VALID_LINK,
    url: 'javascript:alert(1)',
    createdAt: serverTimestamp()
  }));
});

test('المسؤول لا يستطيع حفظ وصف ضخم', async () => {
  await assertFails(setDoc(doc(admin(), 'links', 'huge'), {
    ...VALID_LINK,
    description: 'ا'.repeat(600),
    createdAt: serverTimestamp()
  }));
});

test('حساب بنفس الإيميل لكن غير مُفعَّل لا يُعتبر مسؤولًا', async () => {
  // بدون شرط email_verified يكفي إنشاء حساب بكلمة مرور على إيميل المسؤول
  // للحصول على صلاحياته
  await assertFails(setDoc(doc(unverifiedAdmin(), 'links', 'x'), {
    ...VALID_LINK,
    createdAt: serverTimestamp()
  }));
});

test('مستخدم مسجّل من خارج القائمة لا يملك شيئًا سوى القراءة العامة', async () => {
  const db = outsider();
  await assertSucceeds(getDoc(doc(db, 'links', 'main')));
  await assertFails(setDoc(doc(db, 'links', 'x'), { ...VALID_LINK, createdAt: serverTimestamp() }));
  await assertFails(getDoc(doc(db, 'links', 'main', 'meta', 'admin')));
});

// ------------------------- إخفاء البيانات الإدارية -------------------------

test('إيميل من أنشأ الرابط ليس مقروءًا للعموم', async () => {
  await assertFails(getDoc(doc(visitor(), 'links', 'main', 'meta', 'admin')));
  await assertSucceeds(getDoc(doc(admin(), 'links', 'main', 'meta', 'admin')));
});

// ------------------------- فحص الصلاحية من الواجهة -------------------------

test('فحص صلاحية اللوحة ينجح للمسؤول ويفشل لغيره', async () => {
  // اللوحة تسأل القواعد عن صلاحيتها بقراءة مستند meta غير موجود.
  // المعرّف يجب أن يكون اسمًا عاديًا: Firestore يرفض ما يبدأ وينتهي
  // بشرطتين سفليتين، فيفشل الفحص للمسؤول نفسه.
  const ref = (db) => doc(db, 'links', 'access-probe', 'meta', 'probe');
  await assertSucceeds(getDoc(ref(admin())));
  await assertFails(getDoc(ref(outsider())));
  await assertFails(getDoc(ref(visitor())));
});

// ------------------------- الأرشيف -------------------------

test('الأرشيف مقروء للمسؤول فقط', async () => {
  await assertFails(getDocs(collection(visitor(), 'links', 'main', 'history')));
  await assertSucceeds(getDocs(collection(admin(), 'links', 'main', 'history')));
});

test('الأرشيف لا يُعدَّل ولا يُحذف حتى من المسؤول', async () => {
  const db = admin();
  const snapshot = await getDocs(collection(db, 'links', 'main', 'history'));
  const entry = snapshot.docs[0].ref;
  await assertFails(updateDoc(entry, { url: 'https://rewritten.example.com' }));
  await assertFails(deleteDoc(entry));
});

// ------------------------- ما عدا ذلك مرفوض -------------------------

test('أي مجموعة أخرى مرفوضة للجميع', async () => {
  await assertFails(getDoc(doc(visitor(), 'secrets', 'x')));
  await assertFails(setDoc(doc(admin(), 'secrets', 'x'), { a: 1 }));
});

// إعدادات Firebase — مصدر واحد للحقيقة (تستوردها index.html و 404.html و admin.html).
//
// ملاحظة أمنية: هذه القيم عامة بطبيعتها ومصمَّمة للعمل في المتصفح، وليست سرًا.
// الحماية الفعلية كلها في firestore.rules — راجع SECURITY.md.
//
// إصدار Firebase SDK مثبّت على 10.7.1 في كل ملف يستورده عمدًا:
// التثبيت يمنع تغيّر السلوك فجأة. راجع الإصدار كل ربع سنة وحدّثه في كل
// الملفات دفعة واحدة بعد اختبار التحويل والدخول.

export const firebaseConfig = {
  apiKey: 'AIzaSyCAM51J2XJt5lp6gN_mPPxR1ekav1spSkQ',
  authDomain: 'qr-redirect-2e522.firebaseapp.com',
  projectId: 'qr-redirect-2e522',
  storageBucket: 'qr-redirect-2e522.firebasestorage.app',
  messagingSenderId: '142086636138',
  appId: '1:142086636138:web:f7079987c0d1dee7f0c013',
  measurementId: 'G-D9TR6C1TS4'
};

// اللغة المستخدمة في تنسيق التواريخ والأرقام.
// اللاحقة u-nu-latn تفرض الأرقام العربية (123) بدل الهندية (١٢٣)
// حتى تتسق مع بقية الأرقام في الواجهة (البند 14).
export const LOCALE = 'ar-EG-u-nu-latn';

/**
 * التطوير المحلي يعمل على محاكي Firebase لا على قاعدة الإنتاج.
 *
 * بدون هذا المفتاح كان اختبار أي تغيير في التحويل يعني الكتابة على بيانات
 * حقيقية، ولذلك لم يكن يُختبر أصلًا (البند 9).
 */
export const useEmulator =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname);

export const EMULATOR = {
  firestoreHost: '127.0.0.1',
  firestorePort: 8080,
  authUrl: 'http://127.0.0.1:9099'
};

// دوال خالصة (بلا Firebase وبلا DOM) تخص تفسير المسارات والتحقق من الوجهات.
// فُصلت عن redirect.js تحديدًا لتكون قابلة للاختبار في Node بلا شبكة ولا
// متصفح — وهي بالضبط الدوال التي انكسرت في الإنتاج.

/**
 * يستخرج اسم الرابط من المسار الحالي.
 *
 * المسار الجذري يُشتق من موقع الملف نفسه، فيعمل الكود على
 * github.io/QR-Convert/ وعلى نطاق مخصص بلا تعديل.
 *
 * البديل القديم `path.split('/').filter(p => p).pop()` كان يرجع "QR-Convert"
 * عند الجذر لأن آخر جزء في `/QR-Convert/` هو اسم المستودع نفسه، فلم تكن
 * القيمة الافتراضية 'main' تُستخدم أبدًا.
 */
export function resolveLinkName(pathname, baseDir = '/') {
  const decoded = safeDecode(pathname);
  // baseDir بلا الشرطة الأخيرة حتى يُطابَق '/QR-Convert' و'/QR-Convert/' معًا
  // (المتصفح يحوّل الأول إلى الثاني، لكن الدالة لا تفترض ذلك).
  const prefix = baseDir.replace(/\/+$/, '');
  const matchesPrefix = prefix
    && decoded.startsWith(prefix)
    && (decoded.length === prefix.length || decoded[prefix.length] === '/');

  const rest = (matchesPrefix ? decoded.slice(prefix.length) : decoded)
    .replace(/^\/+|\/+$/g, '');

  if (!rest || rest === 'index.html' || rest === '404.html') return 'main';
  return rest;
}

/**
 * هل الاسم صالح كاسم رابط؟ نفس الشرط في اللوحة عند الإنشاء وفي
 * firestore.rules (isValidLinkId).
 *
 * صفحة التحويل تفحصه قبل أي طلب شبكة: مسار مثل /a/b يعطي الاسم 'a/b'،
 * و doc(db, 'links', 'a/b') يرمي خطأ مسار غير صالح، فكان الزائر يرى
 * "تعذّر الاتصال بالخادم" بدل "لا يوجد رابط بهذا الاسم".
 */
export function isValidLinkName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // مسار فيه % غير صالح — استخدمه كما هو بدل الانهيار
  }
}

/**
 * يتحقق أن الوجهة رابط ويب صالح، ويرجع صيغته المطلقة أو null.
 *
 * بدون هذا الفحص تكون قيمة مثل `javascript:...` مخزّنة في Firestore كافية
 * لتنفيذ سكربت في نطاق الموقع — إعادة توجيه مفتوح.
 * الفحص مكرر عمدًا في firestore.rules: المتصفح ليس حدًا أمنيًا.
 */
export function safeTargetUrl(raw, base = globalThis.location?.origin) {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  let parsed;
  try {
    parsed = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }

  return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
}

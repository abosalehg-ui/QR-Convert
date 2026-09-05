// دوال خالصة (بلا Firebase وبلا DOM) تخص تفسير المسارات والتحقق من الوجهات.
// فُصلت عن redirect.js تحديدًا لتكون قابلة للاختبار في Node بلا شبكة ولا
// متصفح — وهي بالضبط الدوال التي انكسرت في الإنتاج (البندان 3 و5).

/**
 * يستخرج اسم الرابط من المسار الحالي.
 *
 * المسار الجذري يُشتق من موقع الملف نفسه، فيعمل الكود على
 * github.io/QR-Convert/ وعلى نطاق مخصص بلا تعديل.
 *
 * البديل القديم `path.split('/').filter(p => p).pop()` كان يرجع "QR-Convert"
 * عند الجذر لأن آخر جزء في `/QR-Convert/` هو اسم المستودع نفسه، فلم تكن
 * القيمة الافتراضية 'main' تُستخدم أبدًا (البند 3).
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
 * لتنفيذ سكربت في نطاق الموقع — إعادة توجيه مفتوح (البند 5).
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

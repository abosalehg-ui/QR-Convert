# ⚡ دليل البدء السريع

تشغيل نظام QR Redirect في 15 دقيقة!

---

## 🎯 الخطوات الأساسية (3 فقط!)

### 1️⃣ إعداد Firebase (5 دقائق)

```
1. اذهب إلى: https://console.firebase.google.com
2. أنشئ مشروع جديد
3. فعّل Firestore + Authentication (Google & Email)
4. انسخ Firebase Config
```

### 2️⃣ رفع الملفات على GitHub (5 دقائق)

```
1. أنشئ Repository جديد: QR-Convert
2. أنشئ مجلد /docs
3. ارفع محتويات مجلد docs كاملًا (HTML و JS و CSS)
4. الصق Firebase Config في docs/firebase-config.js — ملف واحد فقط
```

### 3️⃣ تفعيل GitHub Pages (2 دقيقة)

```
1. Settings → Pages
2. Source: main/docs
3. Save
4. انتظر 3 دقائق
```

✅ **انتهى! نظامك جاهز!**

---

## 🔥 أول استخدام (3 دقائق)

### الخطوة 1: إنشاء حساب مسؤول

```
Firebase Console → Authentication → Add User
Email: your-email@gmail.com
Password: [كلمة مرور قوية]
```

### الخطوة 2: ضبط Security Rules

```
Firebase Console → Firestore → Rules

استبدل بـ:
request.auth.token.email in ['your-email@gmail.com']
```

اضغط **Publish**

### الخطوة 3: تسجيل الدخول

```
1. افتح: https://abosalehg-ui.github.io/QR-Convert/admin.html
2. سجل دخول بإيميلك
3. أضف أول رابط!
```

---

## 📝 إنشاء أول رابط

```
اسم الرابط: main
الرابط الهدف: https://example.com
الوصف: الرابط الرئيسي
```

اضغط **"إضافة الرابط"**

✅ **رابطك الآن:**
```
https://abosalehg-ui.github.io/QR-Convert/main
```

---

## 🎨 إنشاء QR Code

```
1. اذهب إلى: https://www.qr-code-generator.com
2. الصق: https://abosalehg-ui.github.io/QR-Convert/main
3. اختر تصميم
4. حمّل الصورة
5. اطبع واستخدم!
```

---

## ✅ اختبار سريع

### اختبار 1: التحويل
```
افتح: https://abosalehg-ui.github.io/QR-Convert/main
يجب أن يحولك لـ example.com
```

### اختبار 2: لوحة التحكم
```
افتح: https://abosalehg-ui.github.io/QR-Convert/admin.html
يجب أن ترى الإحصائيات والروابط
```

### اختبار 3: التعديل
```
1. عدّل الرابط الهدف
2. افتح الرابط مرة أخرى
3. يجب أن يحولك للرابط الجديد
```

---

## 🎯 الميزات الأساسية

### ✅ إضافة رابط
```
لوحة التحكم → إضافة رابط جديد → املأ البيانات
```

### ✅ تعديل رابط
```
قائمة الروابط → ✏️ تعديل → غيّر الهدف
```

### ✅ عرض الأرشيف
```
قائمة الروابط → 📚 الأرشيف → شاهد التعديلات
```

### ✅ تعطيل رابط
```
قائمة الروابط → ⏸️ تعطيل → الرابط يتوقف مؤقتاً
```

### ✅ حذف رابط
```
قائمة الروابط → 🗑️ حذف → (لا يمكن التراجع!)
```

---

## 🔧 الإعدادات المهمة

### Firebase Config
```javascript
// في docs/firebase-config.js — مصدر واحد تستورده كل الصفحات
export const firebaseConfig = {
    apiKey: "YOUR_API_KEY",           // ← هنا
    authDomain: "YOUR_AUTH_DOMAIN",   // ← وهنا
    projectId: "YOUR_PROJECT_ID",     // ← وهنا
    // ...
};
```

> هذه القيم عامة بطبيعتها وليست سرًا — الحماية كلها في Security Rules.
> راجع SECURITY.md.

### Security Rules
```javascript
// في Firestore Rules
request.auth.token.email in [
  'your-email@gmail.com'  // ← ضع إيميلك
]
```

بعد أي تعديل على القواعد، شغّل اختباراتها قبل النشر:
```bash
npm run test:rules
```

### GitHub Pages
```
Settings → Pages → Source:
- Branch: main
- Folder: /docs
```

---

## 📋 Checklist النجاح

قبل الاستخدام، تأكد من:

**Firebase:**
- [x] المشروع منشأ
- [x] Firestore مفعّل
- [x] Authentication مفعّل (Google + Email)
- [x] Firebase Config منسوخ
- [x] Security Rules محدّثة
- [x] حساب مسؤول منشأ

**GitHub:**
- [x] Repository منشأ
- [x] مجلد /docs موجود
- [x] محتويات docs/ مرفوعة كاملة
- [x] Firebase Config مُلصق في docs/firebase-config.js
- [x] بريد المسؤول مُفعَّل (Email verified) في Authentication
- [x] GitHub Pages مفعّل

**الاختبار:**
- [x] التحويل يعمل
- [x] تسجيل الدخول يعمل
- [x] إضافة رابط يعمل
- [x] الإحصائيات تظهر

---

## ⚠️ أخطاء شائعة

### ❌ "Permission denied"
```
✅ الحل: تأكد من وضع إيميلك في Security Rules
```

### ❌ "الرابط غير موجود"
```
✅ الحل: أنشئ الرابط من لوحة التحكم أولاً
```

### ❌ "لا يمكن تسجيل الدخول"
```
✅ الحل: أنشئ الحساب في Firebase Authentication
```

### ❌ "GitHub Pages لا يعمل"
```
✅ الحل: انتظر 5 دقائق، تأكد من /docs folder
```

---

## 📱 استخدام عملي

### مثال 1: عرض ترويجي
```
اسم الرابط: winter-sale
الهدف: https://store.com/winter-promotion
الوصف: عرض الشتاء 2024
```

### مثال 2: قائمة مطعم
```
اسم الرابط: menu
الهدف: https://restaurant.com/menu-arabic.pdf
الوصف: القائمة العربية
```

### مثال 3: رابط تسجيل
```
اسم الرابط: register
الهدف: https://forms.google.com/xyz
الوصف: نموذج التسجيل
```

---

## 🚀 الخطوات التالية

بعد التشغيل الأساسي:

### 1. تخصيص التصميم
```
→ غيّر الألوان في CSS
→ أضف شعارك
→ خصص الرسائل
```

### 2. تحسين الأمان
```
→ فعّل 2FA في Google
→ أضف Email Verification
→ راقب الإحصائيات
```

### 3. ميزات متقدمة
```
→ تتبع الموقع الجغرافي
→ إحصائيات تفصيلية
→ نسخ احتياطية تلقائية
```

راجع **SECURITY.md** للتفاصيل!

---

## 📚 موارد إضافية

| ملف | الوصف |
|-----|-------|
| **README.md** | دليل تنصيب مفصل |
| **FAQ.md** | أسئلة شائعة |
| **SECURITY.md** | نصائح الأمان والتحسينات |
| **firestore.rules** | قواعد الأمان |
| **404.html** | صفحة الخطأ |

---

## 🎉 مبروك!

نظامك الآن جاهز وقابل للاستخدام!

**الروابط المهمة:**

```
الموقع الرئيسي:
https://abosalehg-ui.github.io/QR-Convert/

لوحة التحكم:
https://abosalehg-ui.github.io/QR-Convert/admin.html

Firebase Console:
https://console.firebase.google.com

GitHub Repository:
https://github.com/abosalehg-ui/QR-Convert
```

---

**🌟 استمتع بالاستخدام!**

للدعم: راجع FAQ.md أو افتح Issue في GitHub
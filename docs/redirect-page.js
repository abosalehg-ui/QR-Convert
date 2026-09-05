// يربط منطق التحويل بواجهة الصفحة. مشترك بين index.html و 404.html:
// الفرق بينهما هو محتوى حالة الفشل في HTML، لا المنطق.

import { runRedirect } from './redirect.js';

const loading = document.getElementById('loading');
const failure = document.getElementById('failure');
const status = document.getElementById('status');
const failureMessage = document.getElementById('failure-message');

runRedirect({
  onStatus(text) {
    if (status) status.textContent = text;
  },
  onFail(message) {
    // textContent لا innerHTML: الرسالة قد تحوي اسم رابط جاء من عنوان
    // الصفحة، وهو مدخل يتحكم به الزائر (البند 6).
    if (failureMessage) failureMessage.textContent = message;
    if (loading) loading.hidden = true;
    if (failure) failure.hidden = false;
    document.title = 'الرابط غير متاح';
  }
});

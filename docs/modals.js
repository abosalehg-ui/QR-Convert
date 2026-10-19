// النوافذ المنبثقة في لوحة التحكم: فتح وإغلاق، ودعم كامل للوحة المفاتيح
// (Escape، حبس Tab داخل النافذة، إعادة التركيز لمن فتحها)، ونافذة تأكيد
// بديلة عن confirm() الأصلية.
//
// فُصلت عن admin.js لأنها لا تعرف شيئًا عن الروابط ولا عن Firebase.

const $ = (id) => document.getElementById(id);

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

let lastFocusedElement = null;

// نداء يُنفَّذ عند إغلاق نافذة بأي طريقة (زر الإغلاق، Escape، النقر خارجها).
// بدونه كانت نافذة التأكيد تترك وعدها معلّقًا إذا أُغلقت بغير زرّيها.
const onCloseHandlers = new Map();

export function openModal(id, trigger, onClose) {
  lastFocusedElement = trigger || document.activeElement;
  if (onClose) onCloseHandlers.set(id, onClose);
  const modal = $(id);
  modal.hidden = false;
  const first = modal.querySelector(FOCUSABLE);
  if (first) first.focus();
}

export function closeModal(id) {
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
 * ولا ترجمة أزرارها. ترجع وعدًا بـ true أو false.
 */
export function confirmDialog(title, message, yesLabel = 'نعم، احذف') {
  return new Promise((resolve) => {
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    $('confirmYes').textContent = yesLabel;

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

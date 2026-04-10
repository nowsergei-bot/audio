/**
 * Автоматическое извлечение типичных ПДн/контактов из русскоязычного текста для псевдонимизации.
 * Эвристики: ложные срабатывания возможны; длинные совпадения приоритетнее при последующей замене.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/** RU mobile / городские варианты, + международные +... */
const PHONE_RES = [
  /\+7[\s\-]?(?:\(\s*\d{3}\s*\)|\d{3})[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g,
  /8[\s\-]?(?:\(\s*\d{3}\s*\)|\d{3})[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g,
  /\+?\d{1,3}[\s\-]?\(?\d{2,4}\)?[\s\-]?\d{2,4}[\s\-]?\d{2,4}[\s\-]?\d{2,4}/g,
];

/** Класс / параллель (без \b у кириллицы/ёлочек) */
const CLASS_RE =
  /\d{1,2}\s*[«"']\s*[А-ЯЁA-Zа-яё]\s*[»"'](?:\s*класс)?|класс\s*(?:№?\s*)?(?:\d{1,2}\s*[«"']?\s*[А-ЯЁA-Zа-яё]\s*[»"']?|\d{1,2}\s*[-–]?\s*[а-яё])(?=\s|$|[,;:.!?])|\d{1,2}\s*[-–]\s*[А-ЯЁ]\s*класс/giu;

/** Улица / проспект … до разумной длины */
const ADDRESS_RE =
  /\b(?:ул\.|улица|просп\.|проспект|пер\.|переулок|б-р|бульвар|наб\.|набережная|ш\.|шоссе)\s+[А-ЯЁа-яёA-Za-z0-9«»\-\s.]{2,100}(?:,\s*(?:д\.?|дом|корп\.?|к\.|стр\.?)\s*[А-ЯЁа-яёA-Za-z0-9\-/]+)?/giu;

/** ФИО после метки или в скобках после «ученик» */
const LABEL_FIO_RES = [
  /(?:^|[\n;]|\.)\s*(?:учитель|педагог|завуч|директор|методист|классный\s+руководитель|кл\.?\s*рук\.?|ученик|ученица|родитель|законный\s+представитель|ребёнок|ребенок|фио)\s*[:\-–]\s*([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2})(?=\s|$|[,;:.!?])/giu,
  /(?:^|[\s,.;])(?:учитель|педагог)\s+\(?([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2})\)?(?=\s|$|[,;:.!?])/giu,
];

/** ФИО с отчеством — граница без \b (в JS она ненадёжна после кириллицы). */
const FIO_WITH_PATRONYMIC =
  /[А-ЯЁ][а-яё]{1,}\s+[А-ЯЁ][а-яё]{1,}\s+[А-ЯЁ][а-яё]*(вич|вна|ич|гызы|кызы|оглы)(?=\s|$|[,;:.!?])/giu;

function normalizeWs(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function pushUnique(map, type, raw) {
  const value = normalizeWs(raw);
  if (value.length < 3) return;
  if (type === 'phone' && !/\d{7,}/.test(value.replace(/\D/g, ''))) return;
  if (type === 'class' && value.length > 40) return;
  if (!map.has(value)) map.set(value, type);
}

/**
 * @param {string} text
 * @returns {Array<{ type: string, value: string }>}
 */
function extractAutoPiiEntities(text) {
  const plain = String(text ?? '');
  const map = new Map();

  let m;
  const emailRe = new RegExp(EMAIL_RE.source, EMAIL_RE.flags);
  while ((m = emailRe.exec(plain)) !== null) {
    pushUnique(map, 'other', m[0]);
  }

  for (const reSrc of PHONE_RES) {
    const re = new RegExp(reSrc.source, reSrc.flags);
    while ((m = re.exec(plain)) !== null) {
      const digits = m[0].replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 15) continue;
      if (digits.length === 10 && digits[0] !== '9' && !m[0].includes('+')) continue;
      pushUnique(map, 'phone', m[0]);
    }
  }

  const classRe = new RegExp(CLASS_RE.source, CLASS_RE.flags);
  while ((m = classRe.exec(plain)) !== null) {
    pushUnique(map, 'class', m[0]);
  }

  const addrRe = new RegExp(ADDRESS_RE.source, ADDRESS_RE.flags);
  while ((m = addrRe.exec(plain)) !== null) {
    pushUnique(map, 'address', m[0]);
  }

  for (const reSrc of LABEL_FIO_RES) {
    const re = new RegExp(reSrc.source, reSrc.flags);
    while ((m = re.exec(plain)) !== null) {
      const cap = m[1] || m[0];
      pushUnique(map, 'teacher', cap);
    }
  }

  const fioPat = new RegExp(FIO_WITH_PATRONYMIC.source, FIO_WITH_PATRONYMIC.flags);
  while ((m = fioPat.exec(plain)) !== null) {
    pushUnique(map, 'teacher', m[0]);
  }

  return [...map.entries()].map(([value, type]) => ({ type, value }));
}

module.exports = { extractAutoPiiEntities };

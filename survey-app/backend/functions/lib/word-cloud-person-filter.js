'use strict';

/**
 * Имена/отчества в облаке слов: эвристики + список частых русских имён.
 * Синхронизируйте список имён, regex и стоп-слово «фио» с frontend/src/lib/wordCloudDisplay.ts.
 */

function norm(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/\uFEFF/g, '')
    .replace(/ё/g, 'е');
}

/** Женские отчества: …овна / …евна / …ична / …инична */
const RE_PATRONYMIC_F = /(овна|евна|ична|инична)$/u;

/** Мужские отчества: …ович / …евич / …ьич (Ильич) */
const RE_PATRONYMIC_M = /(ович|евич|ьич)$/u;

/**
 * Текст вопроса: не подмешивать ответы в облако (там почти только ФИО).
 * @param {string} questionText
 */
function shouldExcludeQuestionTextFromWordCloud(questionText) {
  const t = norm(questionText);
  if (!t) return false;
  if (/\bфио\b/.test(t)) return true;
  if (/ф\.?\s*и\.?\s*о\.?/.test(t)) return true;
  if (/фамилия\s*[,.]?\s*имя|имя\s*[,.]?\s*фамилия/.test(t)) return true;
  if (/полное\s+(?:фио|имя)/.test(t)) return true;
  if (/посетивш(?:его|ий|ая|ий)\s+урок/.test(t)) return true;
  if (/(?:кто|как)\s+(?:посетил|посетивш)/.test(t)) return true;
  if (/фамилия\s+и\s+имя\s+и\s+отчество/.test(t)) return true;
  if (/имя\s+и\s+фамилия/.test(t)) return true;
  return false;
}

/** Частые русские имена и краткие формы (нижний регистр, ё→е). */
const RU_FIRST_NAMES = new Set(
  `
анна мария елена ольга наталья екатерина татьяна ирина светлана анастасия юлия оксана виктория
валентина людмила галина лариса екатерина дарья полина ксения алиса софия софья вероника
марина виктория нина зоя вера надежда любовь раиса тамара инна жанна эльвира алла инга
кристина виктория евгения дина элина яна жанна фаина роза лилия клавдия нелли эмма
александр дмитрий максим сергей андрей алексей артем артём михаил никита иван матвей
егор даниил кирилл владимир константин тимофей борис виктор глеб руслан павел роман
семен семён степан валентин вадим вячеслав григорий олег лев ярослав евгений денис
игорь арсений арсентий петр пётр федор фёдор антон платон леонид эдуард альберт
илья данил елисей марк роберт давид салават рамиль тимур эмиль азат
снежана божена елизавета василиса ульяна карина агата валерия диана алина милана
милена варвара ева арина амина камила эмилия ариана александра
`.split(/\s+/)
    .filter(Boolean)
    .map(norm),
);

/**
 * @param {string} w — уже normalizeWordCloudToken
 */
/** Типичные женские фамилии на -ова / -ева («Щербакова», «Бурзяева»); длина снижает ложные срабатывания. */
const RE_SURNAME_F_OVA_EVA = /(ова|ева)$/u;

function isExcludedPersonNameToken(w) {
  if (!w || w.length < 3) return false;
  if (RU_FIRST_NAMES.has(w)) return true;
  if (w.length >= 5 && RE_PATRONYMIC_F.test(w)) return true;
  if (w.length >= 5 && RE_PATRONYMIC_M.test(w)) return true;
  if (w.length >= 8 && RE_SURNAME_F_OVA_EVA.test(w)) return true;
  return false;
}

module.exports = {
  shouldExcludeQuestionTextFromWordCloud,
  isExcludedPersonNameToken,
  norm,
};

function normalizeRawFacetKey(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s || s === '(не указано)') return s;
  return s.toLocaleLowerCase('ru');
}

/**
 * Разбор ячеек «список через запятую»: запятая/точка с запятой внутри (…) не делит пункты
 * (иначе «температура, проветривание)» превращается в обрывки). Слэш / не считается разделителем —
 * иначе режутся сдвоенные подписи и англ. фразы с «/».
 */
export function splitListFeatureParts(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);

    if ((ch === ',' || ch === ';' || ch === '|') && depth === 0) {
      const t = cur.trim();
      if (t) parts.push(t);
      cur = '';
      continue;
    }
    if ((ch === '\n' || ch === '\r') && depth === 0) {
      const t = cur.trim();
      if (t) parts.push(t);
      cur = '';
      if (ch === '\r' && raw[i + 1] === '\n') i += 1;
      continue;
    }
    cur += ch;
  }
  const t = cur.trim();
  if (t) parts.push(t);
  return parts;
}

function normToken(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[«»""`´]/g, '')
    .replace(/\)+$/g, '')
    .replace(/^\(+/, '')
    .toLocaleLowerCase('ru');
}

/** Явный мусор и пустые обрывки после кривого ввода */
export function isListFeatureJunkToken(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  const n = normToken(t);
  if (/^etc\.?\)?$/i.test(n)) return true;
  if (/^и\s*т\.?\s*д\.?\)?$/i.test(n)) return true;
  if (/^и\s*пр\.?\)?$/i.test(n)) return true;
  if (n.length <= 1) return true;
  return false;
}

type SynonymGroup = {
  /** Стабильный ключ для счётчиков и покрытия педагога */
  id: string;
  /** Одна строка в UI: RU / EN где есть пара */
  label: string;
  /** Нормализованные варианты (точное совпадение после normToken) */
  variants: string[];
};

/**
 * Синонимы для наблюдательных листов (орг.-тех. условия урока и т.п.).
 * Расширяйте variants при новых опросах — без изменения логики движка.
 */
const SYNONYM_GROUPS: SynonymGroup[] = [
  {
    id: 'lf_student_readiness',
    label: "Готовность учащихся к уроку / Students' preparation for the lesson",
    variants: [
      "готовность учащихся к уроку",
      "students' preparation for the lesson",
      'students preparation for the lesson',
    ],
  },
  {
    id: 'lf_teacher_readiness',
    label: "Готовность учителя к уроку / Teacher's preparation for the lesson",
    variants: [
      'готовность учителя к уроку',
      "teacher's preparation for the lesson",
      'teachers preparation for the lesson',
      'teacher preparation for the lesson',
    ],
  },
  {
    id: 'lf_didactic_materials',
    label: 'Подбор и использование дидактических материалов / Appropriate selection and use of teaching aids',
    variants: [
      'дидактических материалов',
      'appropriate selection and use of teaching aids',
    ],
  },
  {
    id: 'lf_other',
    label: 'Другое',
    variants: ['другое', 'другое:'],
  },
  {
    id: 'lf_ict',
    label: 'Использование ТСО',
    variants: ['использование тсо', 'использование техники средств обучения'],
  },
  {
    id: 'lf_visual_aids',
    label: 'Наглядные пособия / visual aids',
    variants: ['наглядных пособий', 'visual aids', 'наглядные пособия'],
  },
  {
    id: 'lf_lesson_plan',
    label: 'Наличие плана урока / Lesson plan provided',
    variants: ['наличие плана урока', 'lesson plan provided', 'план урока'],
  },
  {
    id: 'lf_classroom_space',
    label: 'Организация образовательного пространства / Classroom organisation',
    variants: [
      'организация образовательного пространства',
      'classroom organisation',
      'classroom organization',
    ],
  },
  {
    id: 'lf_sanitary_climate',
    label: 'Санитарное состояние класса (температурный режим, проветривание) / Sanitary condition, ventilation',
    variants: [
      'санитарное состояние класса (температурный режим',
      'sanitary condition of the classroom (temperature',
      'ventilation',
      'проветривание',
      'проветривание)',
    ],
  },
  {
    id: 'lf_tech_map',
    label: 'Наличие технологической карты урока',
    variants: ['технологической карты', 'технологическая карта', 'наличие технологической карты'],
  },
  {
    id: 'lf_coursebook',
    label: 'Учебник / coursebook',
    variants: ['coursebook', 'учебник'],
  },
];

const VARIANT_TO_GROUP = new Map<string, SynonymGroup>();
for (const g of SYNONYM_GROUPS) {
  for (const v of g.variants) {
    VARIANT_TO_GROUP.set(normToken(v), g);
  }
}

export type ResolvedListFeatureToken = {
  /** Ключ агрегации (совпадает в universe / частотах / покрытии) */
  aggregateKey: string;
  /** Подпись в интерфейсе */
  displayLabel: string;
};

/**
 * Сопоставляет сырой фрагмент из ячейки с канонической группой или оставляет как уникальный пункт.
 */
export function resolveListFeatureToken(raw: string): ResolvedListFeatureToken | null {
  const t = raw.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  if (isListFeatureJunkToken(t)) return null;

  const n = normToken(t);
  const g = VARIANT_TO_GROUP.get(n);
  if (g) {
    return { aggregateKey: g.id, displayLabel: g.label };
  }

  const fallbackKey = `raw:${normalizeRawFacetKey(t)}`;
  return { aggregateKey: fallbackKey, displayLabel: t };
}

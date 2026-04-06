import type { ColumnRole } from './types';
import { normalizeHeader } from './types';
import { PULSE_AI_DIM_PREFIX, PULSE_ORDINAL_LEVEL_KEY } from './engine';

const PULSE_SURVEY_COL_PREFIX = '__pulse_survey_col_';

export type FilterColumnForSections = {
  filterKey: string;
  role: ColumnRole;
  header: string;
  colIndex: number;
};

/** Фиксированные блоки: id → заголовок и порядок на панели */
const FIXED_SECTIONS: { id: string; title: string; rank: number }[] = [
  { id: 'mentors', title: 'Наставники и педагоги', rank: 10 },
  { id: 'class-line', title: 'Параллель, класс, группа', rank: 20 },
  { id: 'survey-fields', title: 'Поля опроса (кроме даты)', rank: 21 },
  { id: 'text-metrics', title: 'Текстовые метрики', rank: 22 },
  { id: 'ai-derived', title: 'Смысловые группы (ИИ)', rank: 24 },
  { id: 'subject', title: 'Предмет и тематика', rank: 30 },
  { id: 'format', title: 'Формат занятия', rank: 40 },
  { id: 'site', title: 'Площадка и организация', rank: 50 },
  { id: 'geo', title: 'Территория и локация', rank: 60 },
  { id: 'cohort', title: 'Поток, год, программа', rank: 70 },
  { id: 'extra', title: 'Дополнительные признаки', rank: 90 },
];

const FIXED_IDS = new Set(FIXED_SECTIONS.map((s) => s.id));

function roleToFixedSection(role: ColumnRole): string | null {
  switch (role) {
    case 'filter_teacher_code':
      return 'mentors';
    case 'filter_parallel':
    case 'filter_class':
      return 'class-line';
    case 'filter_subject':
      return 'subject';
    case 'filter_format':
      return 'format';
    default:
      return null;
  }
}

/**
 * Эвристики по тексту заголовка (после normalizeHeader): куда отнести доп. фильтры и «сбившиеся» колонки.
 */
function inferFixedSectionFromHeader(header: string): string | null {
  const h = normalizeHeader(header);
  if (!h) return null;

  if (/наставник|педагог|учитель|тьютор|ментор|фио|ф\.и\.о|ф\s*и\s*о|руководител|куратор|ведущ|эксперт/.test(h)) {
    return 'mentors';
  }
  if (/параллель|^класс\b|учебн(ая|ый)\s*групп|группа\s*\d|литер|секция/.test(h)) {
    return 'class-line';
  }
  if (/предмет|урок|дисциплин|тема\s|тематик|модуль|раздел\sкурс/.test(h)) {
    return 'subject';
  }
  if (/формат|тип\s*урок|тип\s*занят|режим|онлайн|офлайн|смешанн|гибрид|дистанц|очн/.test(h)) {
    return 'format';
  }
  if (/школ|кампус|корпус|площадк|здани|подразделен|организац|учрежден|филиал/.test(h)) {
    return 'site';
  }
  if (/город|регион|област|край|стран|территор|локац|адрес/.test(h)) {
    return 'geo';
  }
  if (/поток|когорт|набор|год\s*обуч|учебн(ый|ого)\s*год|программ|специальност|направлен|курс\s*\d/.test(h)) {
    return 'cohort';
  }
  return null;
}

function dedicatedSectionId(filterKey: string, colIndex: number): string {
  const safe = filterKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  return `dedicated-${colIndex}-${safe || 'col'}`;
}

function dedicatedTitle(header: string, filterKey: string): string {
  const t = String(header ?? '').trim();
  if (t.length > 56) return `${t.slice(0, 53)}…`;
  return t || filterKey;
}

/**
 * Строит разделы боковой панели без вызова LLM: роли колонок + эвристики по заголовкам.
 * Порядок ключей внутри раздела — как порядок колонок в таблице (слева направо).
 */
export function buildAutoFilterSections(columns: FilterColumnForSections[]): { id: string; title: string; keys: string[] }[] {
  if (!columns.length) return [];

  type Acc = { title: string; rank: number; keys: string[]; minCol: number };
  const acc = new Map<string, Acc>();

  function ensureFixed(id: string): Acc {
    let a = acc.get(id);
    if (!a) {
      const meta = FIXED_SECTIONS.find((s) => s.id === id);
      a = { title: meta?.title ?? id, rank: meta?.rank ?? 80, keys: [], minCol: 1e9 };
      acc.set(id, a);
    }
    return a;
  }

  function ensureDedicated(id: string, title: string, rank: number): Acc {
    let a = acc.get(id);
    if (!a) {
      a = { title, rank, keys: [], minCol: 1e9 };
      acc.set(id, a);
    }
    return a;
  }

  const seenKeys = new Set<string>();

  for (const col of columns) {
    if (seenKeys.has(col.filterKey)) continue;
    seenKeys.add(col.filterKey);

    if (col.filterKey === PULSE_ORDINAL_LEVEL_KEY) {
      const bucket = ensureFixed('text-metrics');
      bucket.keys.push(col.filterKey);
      bucket.minCol = Math.min(bucket.minCol, col.colIndex);
      continue;
    }
    if (col.filterKey.startsWith(PULSE_AI_DIM_PREFIX)) {
      const bucket = ensureFixed('ai-derived');
      bucket.keys.push(col.filterKey);
      bucket.minCol = Math.min(bucket.minCol, col.colIndex);
      continue;
    }
    if (col.filterKey.startsWith(PULSE_SURVEY_COL_PREFIX)) {
      const bucket = ensureFixed('survey-fields');
      bucket.keys.push(col.filterKey);
      bucket.minCol = Math.min(bucket.minCol, col.colIndex);
      continue;
    }

    let sectionId: string | null = roleToFixedSection(col.role);
    if (sectionId == null) {
      sectionId = inferFixedSectionFromHeader(col.header);
    }

    if (sectionId != null && FIXED_IDS.has(sectionId)) {
      const bucket = ensureFixed(sectionId);
      bucket.keys.push(col.filterKey);
      bucket.minCol = Math.min(bucket.minCol, col.colIndex);
      continue;
    }

    const h = normalizeHeader(col.header);
    const isNamedCustom =
      col.role === 'filter_custom_1' || col.role === 'filter_custom_2' || col.role === 'filter_custom_3';
    if (!h && isNamedCustom) {
      const bucket = ensureFixed('extra');
      bucket.keys.push(col.filterKey);
      bucket.minCol = Math.min(bucket.minCol, col.colIndex);
      continue;
    }

    const dedId = dedicatedSectionId(col.filterKey, col.colIndex);
    const ded = ensureDedicated(dedId, dedicatedTitle(col.header, col.filterKey), 75 + col.colIndex * 0.01);
    ded.keys.push(col.filterKey);
    ded.minCol = Math.min(ded.minCol, col.colIndex);
  }

  const list = [...acc.entries()].map(([id, a]) => ({
    id,
    title: a.title,
    rank: a.rank,
    minCol: a.minCol,
    keys: a.keys,
  }));

  list.sort((x, y) => {
    if (x.rank !== y.rank) return x.rank - y.rank;
    if (x.minCol !== y.minCol) return x.minCol - y.minCol;
    return x.id.localeCompare(y.id, 'ru');
  });

  return list.map(({ id, title, keys }) => ({ id, title, keys }));
}

/** Роли колонок — см. docs/ANALYTICS_EXCEL_MAPPING.md */
export type ColumnRole =
  | 'ignore'
  | 'date'
  | 'row_label'
  | 'filter_teacher_code'
  | 'filter_parallel'
  | 'filter_class'
  | 'filter_subject'
  | 'filter_format'
  | 'filter_custom_1'
  | 'filter_custom_2'
  | 'filter_custom_3'
  | 'metric_numeric'
  | 'metric_ordinal_text'
  | 'text_ai_summary'
  | 'text_ai_recommendations'
  | 'text_list_features'
  | 'id_row';

export const COLUMN_ROLE_OPTIONS: { value: ColumnRole; label: string; group: string }[] = [
  { value: 'ignore', label: 'Не использовать', group: 'Служебное' },
  { value: 'id_row', label: 'ID строки', group: 'Служебное' },
  { value: 'date', label: 'Дата', group: 'Время и подпись' },
  { value: 'row_label', label: 'Подпись строки', group: 'Время и подпись' },
  { value: 'filter_teacher_code', label: 'Код/шифр педагога', group: 'Фильтры' },
  { value: 'filter_parallel', label: 'Параллель', group: 'Фильтры' },
  { value: 'filter_class', label: 'Класс', group: 'Фильтры' },
  { value: 'filter_subject', label: 'Предмет / тема', group: 'Фильтры' },
  { value: 'filter_format', label: 'Формат', group: 'Фильтры' },
  { value: 'filter_custom_1', label: 'Доп. фильтр 1', group: 'Фильтры' },
  { value: 'filter_custom_2', label: 'Доп. фильтр 2', group: 'Фильтры' },
  { value: 'filter_custom_3', label: 'Доп. фильтр 3', group: 'Фильтры' },
  { value: 'metric_numeric', label: 'Числовой пункт (больше = лучше)', group: 'Метрики' },
  { value: 'metric_ordinal_text', label: 'Текстовая шкала', group: 'Метрики' },
  { value: 'text_ai_summary', label: 'Текст: выводы / резюме', group: 'Тексты' },
  { value: 'text_ai_recommendations', label: 'Текст: рекомендации', group: 'Тексты' },
  { value: 'text_list_features', label: 'Список через запятую', group: 'Тексты' },
];

export function roleAllowsDuplicate(role: ColumnRole): boolean {
  return role === 'ignore' || role === 'metric_numeric';
}

export function validateRoles(roles: ColumnRole[]): { ok: boolean; message?: string } {
  const seen = new Set<ColumnRole>();
  for (const r of roles) {
    if (roleAllowsDuplicate(r)) continue;
    if (seen.has(r)) {
      return { ok: false, message: `Роль «${COLUMN_ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r}» назначена более чем одной колонке.` };
    }
    seen.add(r);
  }
  const hasMetric = roles.some((r) => r === 'metric_numeric' || r === 'metric_ordinal_text');
  const hasDate = roles.includes('date');
  const hasText = roles.some((r) => r.startsWith('text_'));
  if (!hasMetric && !hasDate && !hasText) {
    return {
      ok: false,
      message: 'Укажите хотя бы одну дату, числовую/шкальную метрику или текстовое поле.',
    };
  }
  return { ok: true };
}

export type CustomFilterLabels = {
  filter_custom_1?: string;
  filter_custom_2?: string;
  filter_custom_3?: string;
};

export type SavedMappingTemplate = {
  id: string;
  name: string;
  /** нормализованный заголовок → роль */
  headerMap: Record<string, ColumnRole>;
  customLabels: CustomFilterLabels;
  createdAt: string;
};

const LS_TEMPLATES = 'pulse_excel_analytics_templates_v1';

export function loadTemplates(): SavedMappingTemplate[] {
  try {
    const raw = localStorage.getItem(LS_TEMPLATES);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p.filter((x) => x && typeof x === 'object' && typeof (x as SavedMappingTemplate).name === 'string') as SavedMappingTemplate[];
  } catch {
    return [];
  }
}

export function saveTemplates(list: SavedMappingTemplate[]): void {
  localStorage.setItem(LS_TEMPLATES, JSON.stringify(list));
}

export function normalizeHeader(h: string): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

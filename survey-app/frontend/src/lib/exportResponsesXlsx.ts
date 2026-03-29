import * as XLSX from 'xlsx';
import type { SurveyExportRowsPayload } from '../types';

function cellDisplay(v: unknown): string | number {
  if (v == null) return '';
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  if (Array.isArray(v)) return v.map((x) => String(x)).join('; ');
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 32000 ? `${s.slice(0, 31997)}…` : s;
}

export function downloadSurveyResponsesXlsx(data: SurveyExportRowsPayload, filename: string): void {
  const { questions, rows } = data;
  const qHeaders = questions.map((q) => {
    const short = (q.text || `Вопрос ${q.id}`).replace(/\s+/g, ' ').trim().slice(0, 200);
    return `[${q.id}] ${short}`;
  });
  const headerRow = ['respondent_id', 'created_at', ...qHeaders];
  const aoa: (string | number)[][] = [headerRow];

  for (const r of rows) {
    const line: (string | number)[] = [r.respondent_id, r.created_at];
    for (const q of questions) {
      line.push(cellDisplay(r.answers[q.id]));
    }
    aoa.push(line);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ответы');
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

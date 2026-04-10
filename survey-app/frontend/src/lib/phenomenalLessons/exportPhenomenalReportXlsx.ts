import {
  composeReviewFlatText,
  type PhenomenalReportBlockDraft,
  type PhenomenalReportDraft,
} from './reportDraftTypes';
import { TEACHER_CHECKLIST_APRIL_HEADER_ROW } from './parseTeacherChecklistApril';
import { PHENOMENAL_RUBRIC_DIMENSIONS } from './phenomenalRubricDimensions';
import {
  chartMetricsFromBlockScores,
  competencyRowsForBlock,
  methodologyAvgRawOnTen,
  methodologyPointsLineForBlock,
  scaleLevelsForMetric,
  type PhenomenalCompetencyKey,
} from './competencyScores';
import { phenomenalBarChartPng, phenomenalRadarChartPng } from './phenomenalChartsCanvas';
import { usedRubricLevelsByDimension } from './rubricUsageLevels';

const HEATMAP_COL_LEVELS = [0, 1, 2, 3, 4] as const;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function parseSubmittedAtForCell(raw: string | null | undefined): Date | string {
  if (raw == null || String(raw).trim() === '') return '';
  try {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  } catch {
    /* ignore */
  }
  return String(raw);
}

function blockToChecklistDataRow(b: PhenomenalReportBlockDraft): (string | number | Date)[] {
  return [
    parseSubmittedAtForCell(b.submittedAt ?? null),
    b.observerName,
    b.subjects,
    b.lessonCode,
    b.conductingTeachers,
    b.rubricOrganizational ?? '',
    b.rubricGoalSetting ?? '',
    b.rubricTechnologies ?? '',
    b.rubricInformation ?? '',
    b.rubricGeneralContent ?? '',
    b.rubricCultural ?? '',
    b.rubricReflection ?? '',
    b.teacherNotes,
    b.methodologicalScore || '',
  ];
}

const FILL_SECTION = 'FFF1F5F9';
const FILL_RED = 'FFDC2626';
const FILL_GREY = 'FFE2E8F0';
const FILL_HEADER = 'FFF8FAFC';

function thinBorder() {
  return {
    top: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
    left: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
  };
}

/**
 * Экспорт .xlsx: листы «Ответы», «Сводка», «Критерии», «Дашборд» (как в интерфейсе, с цветами).
 * ExcelJS подгружается только при выгрузке (динамический import).
 */
export async function downloadPhenomenalReportXlsx(draft: PhenomenalReportDraft, filename: string): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Пульс / Феноменальные уроки';
  wb.created = new Date();

  const wsChecklist = wb.addWorksheet('Ответы', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  wsChecklist.addRow([...TEACHER_CHECKLIST_APRIL_HEADER_ROW]);
  wsChecklist.getRow(1).font = { bold: true };
  wsChecklist.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_HEADER } };
  for (const b of draft.blocks) {
    wsChecklist.addRow(blockToChecklistDataRow(b) as (string | number | Date)[]);
  }
  wsChecklist.columns = TEACHER_CHECKLIST_APRIL_HEADER_ROW.map(() => ({ width: 22 }));

  const wsSummary = wb.addWorksheet('Сводка и отзывы');
  wsSummary.getColumn(1).width = 28;
  wsSummary.getColumn(2).width = 72;
  let sr = 1;
  wsSummary.getCell(sr, 1).value = draft.title;
  wsSummary.getCell(sr, 1).font = { size: 14, bold: true };
  sr += 1;
  if (draft.periodLabel) {
    wsSummary.getCell(sr, 1).value = draft.periodLabel;
    sr += 1;
  }
  sr += 1;
  wsSummary.getCell(sr, 1).value = `Сформировано: ${draft.updatedAt}`;
  sr += 1;
  wsSummary.getCell(sr, 1).value =
    'Первый лист «Ответы» — формат исходного чек-листа; лист «Дашборд» — развёрнутая структура как в редакторе.';
  sr += 2;

  for (let bi = 0; bi < draft.blocks.length; bi++) {
    const b = draft.blocks[bi];
    wsSummary.getCell(sr, 1).value = `— Урок ${bi + 1} —`;
    wsSummary.getCell(sr, 1).font = { bold: true };
    sr += 1;
    const pairs: [string, string][] = [
      ['Шифр урока / класс', b.lessonCode],
      ['ФИО ведущих', b.conductingTeachers],
      ['Предметы', b.subjects],
      ['Оценка методики (/10)', b.methodologicalScore],
      ['Педагог-наблюдатель', b.observerName],
      ['Выводы педагога', b.teacherNotes],
    ];
    if (b.sourceTeacherRowIndices && b.sourceTeacherRowIndices.length > 1) {
      pairs.push(['Строки в файле педагогов (0-based)', b.sourceTeacherRowIndices.join(', ')]);
    } else if (b.sourceTeacherRowIndex != null) {
      pairs.push(['Строка в файле педагогов (0-based)', String(b.sourceTeacherRowIndex)]);
    }
    if (b.matchConfidence != null) {
      pairs.push(['Средняя уверенность ИИ при слиянии', String(Math.round(b.matchConfidence * 1000) / 1000)]);
    }
    for (const [k, v] of pairs) {
      wsSummary.getCell(sr, 1).value = k;
      wsSummary.getCell(sr, 2).value = v;
      sr += 1;
    }
    wsSummary.getCell(sr, 1).value = 'Отзывы родителей';
    wsSummary.getCell(sr, 1).font = { bold: true };
    sr += 1;
    if (b.reviews.length === 0) {
      wsSummary.getCell(sr, 1).value = '(нет строк)';
      sr += 1;
    } else {
      b.reviews.forEach((r, i) => {
        wsSummary.getCell(sr, 1).value = `${i + 1}.`;
        wsSummary.getCell(sr, 2).value = composeReviewFlatText(r);
        wsSummary.getRow(sr).getCell(2).alignment = { wrapText: true, vertical: 'top' };
        sr += 1;
      });
    }
    sr += 1;
  }

  const wsRubric = wb.addWorksheet('Критерии рубрики');
  wsRubric.getColumn(1).width = 36;
  wsRubric.getColumn(2).width = 100;
  wsRubric.addRow(['Критерий (кратко)', 'Полная формулировка для отчёта']);
  wsRubric.getRow(1).font = { bold: true };
  let rr = 2;
  for (const d of PHENOMENAL_RUBRIC_DIMENSIONS) {
    wsRubric.getCell(rr, 1).value = d.titleRu;
    wsRubric.getCell(rr, 2).value = d.description;
    wsRubric.getRow(rr).getCell(2).alignment = { wrapText: true, vertical: 'top' };
    rr += 1;
  }

  const wsDash = wb.addWorksheet('Дашборд', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  wsDash.columns = [
    { width: 34 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 72 },
  ];

  let r = 1;
  wsDash.mergeCells(r, 1, r, 7);
  wsDash.getCell(r, 1).value = draft.title;
  wsDash.getCell(r, 1).font = { size: 16, bold: true };
  wsDash.getCell(r, 1).alignment = { vertical: 'middle', horizontal: 'center' };
  wsDash.getRow(r).height = 28;
  r += 1;
  if (draft.periodLabel) {
    wsDash.mergeCells(r, 1, r, 7);
    wsDash.getCell(r, 1).value = draft.periodLabel;
    wsDash.getCell(r, 1).alignment = { horizontal: 'center' };
    r += 1;
  }
  r += 1;

  for (let bi = 0; bi < draft.blocks.length; bi++) {
    const b = draft.blocks[bi];
    wsDash.mergeCells(r, 1, r, 7);
    const titleRow = wsDash.getRow(r);
    titleRow.getCell(1).value = `Урок ${bi + 1}`;
    titleRow.getCell(1).font = { bold: true, size: 13 };
    titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_SECTION } };
    titleRow.getCell(1).border = thinBorder();
    titleRow.height = 22;
    r += 1;

    const meta: [string, string][] = [
      ['Шифр урока / класс', b.lessonCode],
      ['ФИО ведущих', b.conductingTeachers],
      ['Предметы', b.subjects],
      ['Оценка методики (/10)', methodologyPointsLineForBlock(b)],
      ['Педагог-наблюдатель', b.observerName],
    ];
    for (const [label, val] of meta) {
      wsDash.getCell(r, 1).value = label;
      wsDash.getCell(r, 1).font = { bold: true };
      wsDash.getCell(r, 1).border = thinBorder();
      wsDash.mergeCells(r, 2, r, 7);
      wsDash.getCell(r, 2).value = val;
      wsDash.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' };
      wsDash.getCell(r, 2).border = thinBorder();
      r += 1;
    }

    wsDash.getCell(r, 1).value = 'Выводы педагога (из Excel)';
    wsDash.getCell(r, 1).font = { bold: true };
    wsDash.mergeCells(r, 2, r, 7);
    wsDash.getCell(r, 2).value = b.teacherNotes;
    wsDash.getRow(r).getCell(2).alignment = { wrapText: true, vertical: 'top' };
    wsDash.getCell(r, 1).border = thinBorder();
    wsDash.getCell(r, 2).border = thinBorder();
    r += 1;

    wsDash.mergeCells(r, 1, r, 7);
    wsDash.getCell(r, 1).value = 'Рубрика чек-листа (7 компетенций)';
    wsDash.getCell(r, 1).font = { bold: true, size: 12 };
    wsDash.getCell(r, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_HEADER } };
    r += 1;

    for (const d of PHENOMENAL_RUBRIC_DIMENSIONS) {
      wsDash.mergeCells(r, 1, r, 7);
      wsDash.getCell(r, 1).value = d.titleRu;
      wsDash.getCell(r, 1).font = { bold: true };
      wsDash.getCell(r, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F6' } };
      r += 1;
      wsDash.getCell(r, 1).value = 'Полная формулировка';
      wsDash.getCell(r, 1).font = { italic: true, size: 10 };
      wsDash.mergeCells(r, 2, r, 7);
      wsDash.getCell(r, 2).value = d.description;
      wsDash.getRow(r).getCell(2).alignment = { wrapText: true, vertical: 'top' };
      r += 1;
      wsDash.getCell(r, 1).value = 'Ответ педагога';
      wsDash.getCell(r, 1).font = { bold: true };
      wsDash.mergeCells(r, 2, r, 7);
      wsDash.getCell(r, 2).value = b[d.key] ?? '';
      wsDash.getRow(r).getCell(2).alignment = { wrapText: true, vertical: 'top' };
      r += 1;
    }

    wsDash.mergeCells(r, 1, r, 7);
    wsDash.getCell(r, 1).value = 'Набранные баллы по этому уроку';
    wsDash.getCell(r, 1).font = { bold: true, size: 12 };
    wsDash.getCell(r, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_HEADER } };
    r += 1;

    const scoreRows = competencyRowsForBlock(b);
    wsDash.getCell(r, 1).value = 'Оценка методики (/10)';
    wsDash.getCell(r, 1).font = { bold: true };
    wsDash.mergeCells(r, 2, r, 7);
    wsDash.getCell(r, 2).value = methodologyPointsLineForBlock(b);
    r += 1;
    for (const row of scoreRows) {
      wsDash.getCell(r, 1).value = row.shortLabel;
      wsDash.getCell(r, 1).font = { bold: true };
      wsDash.mergeCells(r, 2, r, 7);
      wsDash.getCell(r, 2).value =
        row.mean != null ? `${row.mean.toFixed(2)} / ${row.maxLevel}` : '—';
      r += 1;
    }

    wsDash.mergeCells(r, 1, r, 7);
    wsDash.getCell(r, 1).value =
      'Использованные уровни в тексте рубрики: столбцы 0–4 (шесть компетенций), для рефлексии — только 0–1. Красный — уровень есть в строке «N - …», серый — нет, «—» — уровень не предусмотрен.';
    wsDash.getCell(r, 1).font = { bold: true };
    wsDash.getCell(r, 1).alignment = { wrapText: true };
    r += 1;

    const usage = usedRubricLevelsByDimension(b);
    const hdr = wsDash.getRow(r);
    hdr.getCell(1).value = 'Компетенция';
    hdr.getCell(1).font = { bold: true };
    hdr.getCell(1).border = thinBorder();
    let c = 2;
    for (const lv of HEATMAP_COL_LEVELS) {
      hdr.getCell(c).value = String(lv);
      hdr.getCell(c).font = { bold: true };
      hdr.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
      hdr.getCell(c).border = thinBorder();
      c += 1;
    }
    r += 1;

    for (const d of PHENOMENAL_RUBRIC_DIMENSIONS) {
      const dimKey = d.key as PhenomenalCompetencyKey;
      const levels = scaleLevelsForMetric(dimKey);
      const row = wsDash.getRow(r);
      row.getCell(1).value = d.titleRu;
      row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(1).border = thinBorder();
      let col = 2;
      const set = usage[d.key];
      for (const lv of HEATMAP_COL_LEVELS) {
        const cell = row.getCell(col);
        cell.border = thinBorder();
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (!levels.includes(lv)) {
          cell.value = '—';
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          cell.font = { color: { argb: 'FFCBD5E1' } };
        } else {
          const on = set.has(lv);
          cell.value = on ? '●' : '';
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: on ? FILL_RED : FILL_GREY },
          };
          cell.font = on ? { color: { argb: 'FFFFFFFF' }, bold: true } : { color: { argb: 'FF64748B' } };
        }
        col += 1;
      }
      r += 1;
    }

    const dashMetrics = chartMetricsFromBlockScores(scoreRows, methodologyAvgRawOnTen(b));
    if (dashMetrics.length > 0) {
      wsDash.mergeCells(r, 1, r, 7);
      wsDash.getCell(r, 1).value =
        'Диаграммы: столбцы и радар по доле набранного балла от максимума по каждой метрике (как в опроснике).';
      wsDash.getCell(r, 1).font = { bold: true };
      wsDash.getCell(r, 1).alignment = { wrapText: true };
      r += 1;

      const barBuf = await phenomenalBarChartPng(dashMetrics);
      if (barBuf) {
        const barId = wb.addImage({
          base64: arrayBufferToBase64(barBuf),
          extension: 'png',
        });
        wsDash.addImage(barId, {
          tl: { col: 0, row: r - 1 },
          ext: { width: 520, height: 260 },
        });
        r += 19;
      }
      if (dashMetrics.length >= 3) {
        const radarBuf = await phenomenalRadarChartPng(dashMetrics);
        if (radarBuf) {
          const radarId = wb.addImage({
            base64: arrayBufferToBase64(radarBuf),
            extension: 'png',
          });
          wsDash.addImage(radarId, {
            tl: { col: 0, row: r - 1 },
            ext: { width: 320, height: 320 },
          });
          r += 23;
        }
      }
    }

    wsDash.mergeCells(r, 1, r, 7);
    wsDash.getCell(r, 1).value = 'Отзывы родителей (строки)';
    wsDash.getCell(r, 1).font = { bold: true, size: 12 };
    wsDash.getCell(r, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_HEADER } };
    r += 1;
    if (b.reviews.length === 0) {
      wsDash.mergeCells(r, 1, r, 7);
      wsDash.getCell(r, 1).value = 'Пока нет строк.';
      r += 1;
    } else {
      b.reviews.forEach((rev, ri) => {
        wsDash.getCell(r, 1).value = `${ri + 1}.`;
        wsDash.mergeCells(r, 2, r, 7);
        wsDash.getCell(r, 2).value = composeReviewFlatText(rev);
        wsDash.getRow(r).getCell(2).alignment = { wrapText: true, vertical: 'top' };
        r += 1;
      });
    }

    r += 2;
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const name = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

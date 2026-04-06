import type { ColumnRole, CustomFilterLabels } from './types';
import type { FilterSelection } from './engine';

/** Снимок маппинга и среза для сохранения на сервере (POST /api/excel-analytics-projects). */
export type SavedExcelSession = {
  v: 1;
  fingerprint: string;
  fileName: string;
  sheet: string;
  headerRow1Based: number;
  headers: string[];
  roles: ColumnRole[];
  customLabels: CustomFilterLabels;
  ordinalLevels: string[];
  filterSelection: FilterSelection;
  filterPanelHiddenKeys: string[];
};

export function fileFingerprintFromFile(f: File): string {
  return `${f.name}\u0001${f.size}\u0001${f.lastModified}`;
}

export function matchSessionForSheet(
  saved: SavedExcelSession | null,
  fingerprint: string,
  sheet: string,
  headerRow1Based: number,
  headers: string[],
): boolean {
  if (!saved || saved.fingerprint !== fingerprint) return false;
  if (saved.sheet !== sheet || saved.headerRow1Based !== headerRow1Based) return false;
  if (saved.headers.length !== headers.length) return false;
  for (let i = 0; i < headers.length; i++) {
    if (saved.headers[i] !== headers[i]) return false;
  }
  return true;
}

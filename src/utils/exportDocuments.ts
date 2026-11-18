import ExcelJS from 'exceljs';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type {
  AgriculturalAssociation,
  DailyDisbursementRow,
  ExportScope,
  FertilizerType,
  Governorate,
  GovernorateCenter,
  SystemSettings,
  TractorDelivery,
} from '../types/domain.ts';
import type { GovernorateBalanceSummary } from './analytics.ts';
import { escapeHtml } from './arabicNormalize.ts';
import { computeDisbursementRow, formatNumberAr } from './calculations.ts';

export interface SheetExportRowInput {
  association: AgriculturalAssociation;
  centerName: string;
  urea: { opening: number | null; closing: number | null; settlement: number | null; reason: string };
  nitrate: { opening: number | null; closing: number | null; settlement: number | null; reason: string };
  sulfate: { opening: number | null; closing: number | null; settlement: number | null; reason: string };
}

export interface ExportDocumentContext {
  organizationNameAr: string;
  governorate: Governorate;
  reportDate: string;
  sheetRows: SheetExportRowInput[];
  tractors: TractorDelivery[];
  balancesSummaries: GovernorateBalanceSummary[];
  associations: AgriculturalAssociation[];
  centers: GovernorateCenter[];
  fertilizerTypes: FertilizerType[];
  settings: SystemSettings;
  treatEmptyAsZero: boolean;
}

function sanitizeFileSegment(val: string): string {
  return val.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-');
}

export function buildExportFileName(govName: string, reportDate: string, ext: 'xlsx' | 'docx' | 'pdf'): string {
  return `كشف-صرف-الأسمدة-${sanitizeFileSegment(govName)}-${sanitizeFileSegment(reportDate)}.${ext}`;
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 1500);
}

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF94A3B8' } },
  left: { style: 'thin', color: { argb: 'FF94A3B8' } },
  bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
  right: { style: 'thin', color: { argb: 'FF94A3B8' } },
};

function colLetter(colNumber1Based: number): string {
  let n = colNumber1Based;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export async function exportToExcel(ctx: ExportDocumentContext): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = ctx.organizationNameAr || 'منظومة DST';
  wb.created = new Date();

  // Sheet 1: كشف الصرف
  const wsSheet = wb.addWorksheet('كشف الصرف', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  // Columns:
  // A: الجمعية (1)
  // B-D: بداية اليوم (يوريا, نترات, سلفات) (2,3,4)
  // E-G: نهاية اليوم (يوريا, نترات, سلفات) (5,6,7)
  // H-J: المنصرف = بداية - نهاية (8,9,10)
  // K-M: التسوية (11,12,13)
  // N-P: فرق التسوية = المنصرف - التسوية (14,15,16)
  // Q: الحالة (17)
  // R: سبب الفرق (18)
  wsSheet.mergeCells('A1:R1');
  wsSheet.getCell('A1').value = `${ctx.organizationNameAr} — كشف صرف الأسمدة اليومي`;
  wsSheet.getCell('A1').font = { name: 'Cairo', size: 14, bold: true, color: { argb: 'FF064E3B' } };
  wsSheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  wsSheet.getRow(1).height = 28;

  wsSheet.mergeCells('A2:R2');
  wsSheet.getCell('A2').value = `المحافظة: ${ctx.governorate.nameAr}   |   التاريخ: ${ctx.reportDate}   |   عدد الجمعيات: ${ctx.sheetRows.length}`;
  wsSheet.getCell('A2').font = { name: 'Cairo', size: 11, bold: true, color: { argb: 'FF334155' } };
  wsSheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
  wsSheet.getRow(2).height = 22;

  // Row 3: Group headers
  wsSheet.mergeCells('A3:A4');
  wsSheet.getCell('A3').value = 'الجمعية الزراعية';
  wsSheet.mergeCells('B3:D3');
  wsSheet.getCell('B3').value = 'بداية اليوم';
  wsSheet.mergeCells('E3:G3');
  wsSheet.getCell('E3').value = 'نهاية اليوم';
  wsSheet.mergeCells('H3:J3');
  wsSheet.getCell('H3').value = 'المنصرف (بداية − نهاية)';
  wsSheet.mergeCells('K3:M3');
  wsSheet.getCell('K3').value = 'التسوية';
  wsSheet.mergeCells('N3:P3');
  wsSheet.getCell('N3').value = 'فرق التسوية (المنصرف − التسوية)';
  wsSheet.mergeCells('Q3:Q4');
  wsSheet.getCell('Q3').value = 'الحالة';
  wsSheet.mergeCells('R3:R4');
  wsSheet.getCell('R3').value = 'سبب الفرق / ملاحظات';

  const fertNames = ['يوريا', 'نترات', 'سلفات'];
  const subHeaders: Record<number, string> = {};
  [2, 5, 8, 11, 14].forEach((startCol) => {
    fertNames.forEach((fn, offset) => {
      subHeaders[startCol + offset] = fn;
    });
  });

  Object.entries(subHeaders).forEach(([cIdx, title]) => {
    wsSheet.getRow(4).getCell(Number(cIdx)).value = title;
  });

  [3, 4].forEach((rIdx) => {
    const row = wsSheet.getRow(rIdx);
    row.height = 22;
    for (let c = 1; c <= 18; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Cairo', size: 10, bold: true, color: { argb: 'FF0F172A' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: rIdx === 3 ? 'FFE2E8F0' : 'FFF1F5F9' },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = THIN_BORDER;
    }
  });

  const firstDataRow = 5;
  ctx.sheetRows.forEach((item, idx) => {
    const rNum = firstDataRow + idx;
    const row = wsSheet.getRow(rNum);
    row.getCell(1).value = `${item.association.nameAr} (${item.association.code})`;
    row.getCell(2).value = item.urea.opening;
    row.getCell(3).value = item.nitrate.opening;
    row.getCell(4).value = item.sulfate.opening;
    row.getCell(5).value = item.urea.closing;
    row.getCell(6).value = item.nitrate.closing;
    row.getCell(7).value = item.sulfate.closing;

    // Formulas for المنصرف = بداية - نهاية (blank if either input blank)
    row.getCell(8).value = {
      formula: `IF(OR(ISBLANK(B${rNum}),ISBLANK(E${rNum})),"",B${rNum}-E${rNum})`,
    };
    row.getCell(9).value = {
      formula: `IF(OR(ISBLANK(C${rNum}),ISBLANK(F${rNum})),"",C${rNum}-F${rNum})`,
    };
    row.getCell(10).value = {
      formula: `IF(OR(ISBLANK(D${rNum}),ISBLANK(G${rNum})),"",D${rNum}-G${rNum})`,
    };

    row.getCell(11).value = item.urea.settlement;
    row.getCell(12).value = item.nitrate.settlement;
    row.getCell(13).value = item.sulfate.settlement;

    // Formulas for فرق التسوية = المنصرف - التسوية
    row.getCell(14).value = {
      formula: `IF(OR(H${rNum}="",ISBLANK(K${rNum})),"",H${rNum}-K${rNum})`,
    };
    row.getCell(15).value = {
      formula: `IF(OR(I${rNum}="",ISBLANK(L${rNum})),"",I${rNum}-L${rNum})`,
    };
    row.getCell(16).value = {
      formula: `IF(OR(J${rNum}="",ISBLANK(M${rNum})),"",J${rNum}-M${rNum})`,
    };

    const uCalc = computeDisbursementRow(
      { openingBalance: item.urea.opening, closingBalance: item.urea.closing, settlementQty: item.urea.settlement },
      ctx.treatEmptyAsZero,
    );
    const nCalc = computeDisbursementRow(
      { openingBalance: item.nitrate.opening, closingBalance: item.nitrate.closing, settlementQty: item.nitrate.settlement },
      ctx.treatEmptyAsZero,
    );
    const sCalc = computeDisbursementRow(
      { openingBalance: item.sulfate.opening, closingBalance: item.sulfate.closing, settlementQty: item.sulfate.settlement },
      ctx.treatEmptyAsZero,
    );

    const anyVariance = uCalc.hasVariance || nCalc.hasVariance || sCalc.hasVariance;
    row.getCell(17).value = anyVariance ? '⚠ اختلاف' : '✔ مطابق';
    const reasons = [item.urea.reason, item.nitrate.reason, item.sulfate.reason]
      .filter((r) => r.trim().length > 0)
      .join(' | ');
    row.getCell(18).value = reasons || (anyVariance ? 'غير مبرر' : '—');

    for (let c = 1; c <= 18; c++) {
      const cell = row.getCell(c);
      cell.border = THIN_BORDER;
      cell.font = { name: 'Cairo', size: 10 };
      cell.alignment = {
        horizontal: c === 1 || c === 18 ? 'right' : 'center',
        vertical: 'middle',
      };
      if (c >= 2 && c <= 16) {
        cell.numFmt = '#,##0.##';
      }
    }

    // Highlight non-zero variances in bold red
    const varFlags = [
      [14, uCalc.hasVariance],
      [15, nCalc.hasVariance],
      [16, sCalc.hasVariance],
    ] as const;
    for (const [cIdx, flagged] of varFlags) {
      if (flagged) {
        const cell = row.getCell(cIdx);
        cell.font = { name: 'Cairo', size: 10, bold: true, color: { argb: 'FFB91C1C' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
      }
    }
    if (anyVariance) {
      row.getCell(17).font = { name: 'Cairo', size: 10, bold: true, color: { argb: 'FFB91C1C' } };
    } else {
      row.getCell(17).font = { name: 'Cairo', size: 10, bold: true, color: { argb: 'FF047857' } };
    }
  });

  if (ctx.sheetRows.length > 0) {
    const lastDataRow = firstDataRow + ctx.sheetRows.length - 1;
    const totalRowIdx = lastDataRow + 1;
    const totalRow = wsSheet.getRow(totalRowIdx);
    totalRow.getCell(1).value = 'الإجمالي العام';
    for (let c = 2; c <= 16; c++) {
      const col = colLetter(c);
      totalRow.getCell(c).value = { formula: `SUM(${col}${firstDataRow}:${col}${lastDataRow})` };
      totalRow.getCell(c).numFmt = '#,##0.##';
    }
    totalRow.getCell(17).value = '—';
    totalRow.getCell(18).value = 'شكارة (50 كجم)';
    for (let c = 1; c <= 18; c++) {
      const cell = totalRow.getCell(c);
      cell.font = { name: 'Cairo', size: 10, bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: c === 1 ? 'right' : 'center', vertical: 'middle' };
    }
  }

  wsSheet.columns.forEach((col, i) => {
    col.width = i === 0 ? 28 : i === 17 ? 24 : 11;
  });

  // Sheet 2: الجرارات
  const wsTractors = wb.addWorksheet('الجرارات', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  wsTractors.mergeCells('A1:J1');
  wsTractors.getCell('A1').value = `${ctx.organizationNameAr} — سجل الجرارات والبوليصات (${ctx.governorate.nameAr} · ${ctx.reportDate})`;
  wsTractors.getCell('A1').font = { name: 'Cairo', size: 13, bold: true };
  wsTractors.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  wsTractors.getRow(1).height = 26;

  const trHeaders = [
    'التاريخ',
    'الجمعية المستلمة',
    'رقم الجرار',
    'رقم البوليصة',
    'الصنف',
    'عدد البوليصة',
    'العدد الفعلي',
    'فرق الشحنة (الفعلي − البوليصة)',
    'الحالة',
    'الاعتماد',
  ];
  const trHeaderRow = wsTractors.getRow(3);
  trHeaders.forEach((h, idx) => {
    const cell = trHeaderRow.getCell(idx + 1);
    cell.value = h;
    cell.font = { name: 'Cairo', size: 10, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  ctx.tractors.forEach((tr, idx) => {
    const rIdx = 4 + idx;
    const row = wsTractors.getRow(rIdx);
    const assoc = ctx.associations.find((a) => a.id === tr.associationId);
    const fert = ctx.fertilizerTypes.find((f) => f.code === tr.fertilizerCode);
    const matched = tr.inspectionStatus === 'matched' && tr.bagVariance === 0;

    row.getCell(1).value = tr.arrivalDate;
    row.getCell(2).value = assoc?.nameAr || tr.associationId;
    row.getCell(3).value = tr.tractorPlate;
    row.getCell(4).value = tr.manifestNumber;
    row.getCell(5).value = fert?.nameAr || tr.fertilizerCode;
    row.getCell(6).value = tr.manifestBags;
    row.getCell(7).value = tr.actualBags;
    row.getCell(8).value = { formula: `G${rIdx}-F${rIdx}` };
    row.getCell(9).value = matched ? '✔ مطابق' : '⚠ اختلاف';
    row.getCell(10).value = tr.approvalState === 'final_approved' ? 'معتمد' : 'معلق';

    for (let c = 1; c <= 10; c++) {
      const cell = row.getCell(c);
      cell.border = THIN_BORDER;
      cell.font = { name: 'Cairo', size: 10 };
      cell.alignment = { horizontal: c === 2 ? 'right' : 'center', vertical: 'middle' };
    }
    if (!matched) {
      row.getCell(8).font = { name: 'Cairo', size: 10, bold: true, color: { argb: 'FFB91C1C' } };
      row.getCell(9).font = { name: 'Cairo', size: 10, bold: true, color: { argb: 'FFB91C1C' } };
    }
  });
  wsTractors.columns.forEach((col, i) => {
    col.width = i === 1 ? 26 : 15;
  });

  // Sheet 3: الأرصدة
  const wsBal = wb.addWorksheet('الأرصدة', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  wsBal.mergeCells('A1:G1');
  wsBal.getCell('A1').value = `${ctx.organizationNameAr} — أرصدة الجمعيات حتى ${ctx.reportDate}`;
  wsBal.getCell('A1').font = { name: 'Cairo', size: 13, bold: true };
  wsBal.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  wsBal.getRow(1).height = 26;

  const balHeaders = ['المحافظة', 'الجمعية', 'يوريا', 'نترات', 'سلفات', 'إجمالي الرصيد', 'تاريخ آخر تحديث'];
  const balHeaderRow = wsBal.getRow(3);
  balHeaders.forEach((h, idx) => {
    const cell = balHeaderRow.getCell(idx + 1);
    cell.value = h;
    cell.font = { name: 'Cairo', size: 10, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  let bRowIdx = 4;
  for (const govSum of ctx.balancesSummaries) {
    for (const aRow of govSum.associations) {
      const row = wsBal.getRow(bRowIdx);
      row.getCell(1).value = govSum.governorateName;
      row.getCell(2).value = `${aRow.associationName} (${aRow.associationCode})`;
      row.getCell(3).value = aRow.urea;
      row.getCell(4).value = aRow.nitrate;
      row.getCell(5).value = aRow.sulfate;
      row.getCell(6).value = aRow.hasAnyRecord ? { formula: `SUM(C${bRowIdx}:E${bRowIdx})` } : null;
      row.getCell(7).value = aRow.lastUpdatedDate || 'لم يُسجل بعد';
      for (let c = 1; c <= 7; c++) {
        const cell = row.getCell(c);
        cell.border = THIN_BORDER;
        cell.font = { name: 'Cairo', size: 10 };
        cell.alignment = { horizontal: c <= 2 ? 'right' : 'center', vertical: 'middle' };
        if (c >= 3 && c <= 6) cell.numFmt = '#,##0.##';
      }
      bRowIdx++;
    }
  }
  wsBal.columns.forEach((col, i) => {
    col.width = i === 1 ? 28 : 16;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const filename = buildExportFileName(ctx.governorate.nameAr, ctx.reportDate, 'xlsx');
  triggerBlobDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  );
  return filename;
}

export async function exportBalancesToExcel(
  balancesSummaries: GovernorateBalanceSummary[],
  reportDate: string,
  organizationNameAr: string,
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('الأرصدة', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.mergeCells('A1:G1');
  ws.getCell('A1').value = `${organizationNameAr} — تقرير الأرصدة الختامية حتى تاريخ ${reportDate}`;
  ws.getCell('A1').font = { name: 'Cairo', size: 13, bold: true };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 26;

  const headers = ['المحافظة', 'الجمعية', 'يوريا', 'نترات', 'سلفات', 'إجمالي الرصيد', 'آخر تحديث'];
  headers.forEach((h, i) => {
    const cell = ws.getRow(3).getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Cairo', size: 10, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  let rowIdx = 4;
  for (const gov of balancesSummaries) {
    for (const assoc of gov.associations) {
      const row = ws.getRow(rowIdx);
      row.getCell(1).value = gov.governorateName;
      row.getCell(2).value = `${assoc.associationName} (${assoc.associationCode})`;
      row.getCell(3).value = assoc.urea;
      row.getCell(4).value = assoc.nitrate;
      row.getCell(5).value = assoc.sulfate;
      row.getCell(6).value = assoc.hasAnyRecord ? { formula: `SUM(C${rowIdx}:E${rowIdx})` } : null;
      row.getCell(7).value = assoc.lastUpdatedDate || 'لم يُسجل بعد';
      for (let c = 1; c <= 7; c++) {
        const cell = row.getCell(c);
        cell.border = THIN_BORDER;
        cell.font = { name: 'Cairo', size: 10 };
        cell.alignment = { horizontal: c <= 2 ? 'right' : 'center', vertical: 'middle' };
      }
      rowIdx++;
    }
  }
  ws.columns.forEach((col, i) => {
    col.width = i === 1 ? 28 : 16;
  });

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `أرصدة-الأسمدة-${sanitizeFileSegment(reportDate)}.xlsx`;
  triggerBlobDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  );
  return filename;
}

function rtlParagraph(text: string, opts?: { bold?: boolean; size?: number; align?: 'right' | 'center'; color?: string }) {
  return new Paragraph({
    bidirectional: true,
    alignment: opts?.align === 'center' ? AlignmentType.CENTER : AlignmentType.RIGHT,
    children: [
      new TextRun({
        text,
        bold: opts?.bold ?? false,
        size: opts?.size ?? 18,
        color: opts?.color,
        rightToLeft: true,
        font: 'Arial',
      }),
    ],
  });
}

function cellBorderConfig() {
  const b = { style: BorderStyle.SINGLE, size: 4, color: '94A3B8' };
  return { top: b, bottom: b, left: b, right: b };
}

export async function exportToWord(
  ctx: ExportDocumentContext,
  scope: ExportScope,
): Promise<string> {
  const sortedRows = [...ctx.sheetRows].sort((a, b) => {
    const oa = typeof a.association.sortOrder === 'number' ? a.association.sortOrder : Number.MAX_SAFE_INTEGER;
    const ob = typeof b.association.sortOrder === 'number' ? b.association.sortOrder : Number.MAX_SAFE_INTEGER;
    return oa !== ob ? oa - ob : a.association.nameAr.localeCompare(b.association.nameAr, 'ar');
  });
  const children: Array<Paragraph | Table> = [
    rtlParagraph(`${ctx.organizationNameAr} — تقرير صرف الأسمدة الزراعية`, {
      bold: true,
      size: 28,
      align: 'center',
    }),
    rtlParagraph(
      `المحافظة: ${ctx.governorate.nameAr}   |   التاريخ: ${ctx.reportDate}   |   عدد الجمعيات: ${ctx.sheetRows.length}`,
      { bold: true, size: 20, align: 'center', color: '334155' },
    ),
    new Paragraph({ text: '' }),
  ];

  // Note on Word OOXML RTL: Reverse column and fertilizer order [سلفات، نترات، يوريا]
  // so every Word/LibreOffice/Google Docs viewer renders RTL left-to-right columns accurately.
  if (scope === 'both' || scope === 'sheet_only') {
    children.push(rtlParagraph('أولًا: كشف الصرف اليومي (المنصرف = بداية − نهاية | فرق التسوية = المنصرف − التسوية)', { bold: true, size: 22 }));

    const reversedHeaders = [
      'سبب الفرق',
      'الحالة',
      'فرق سلفات',
      'فرق نترات',
      'فرق يوريا',
      'تسوية سلفات',
      'تسوية نترات',
      'تسوية يوريا',
      'منصرف سلفات',
      'منصرف نترات',
      'منصرف يوريا',
      'نهاية سلفات',
      'نهاية نترات',
      'نهاية يوريا',
      'بداية سلفات',
      'بداية نترات',
      'بداية يوريا',
      'الجمعية الزراعية',
    ];

    const headerRow = new TableRow({
      tableHeader: true,
      children: reversedHeaders.map(
        (h) =>
          new TableCell({
            borders: cellBorderConfig(),
            shading: { type: ShadingType.CLEAR, fill: 'E2E8F0' },
            children: [rtlParagraph(h, { bold: true, size: 15, align: 'center' })],
          }),
      ),
    });

    const docTotals = {
      uOpen: 0, nOpen: 0, sOpen: 0,
      uClose: 0, nClose: 0, sClose: 0,
      uAct: 0, nAct: 0, sAct: 0,
      uSettle: 0, nSettle: 0, sSettle: 0,
      uVar: 0, nVar: 0, sVar: 0,
    };

    const dataRows = sortedRows.map((item) => {
      const uCalc = computeDisbursementRow(
        { openingBalance: item.urea.opening, closingBalance: item.urea.closing, settlementQty: item.urea.settlement },
        ctx.treatEmptyAsZero,
      );
      const nCalc = computeDisbursementRow(
        { openingBalance: item.nitrate.opening, closingBalance: item.nitrate.closing, settlementQty: item.nitrate.settlement },
        ctx.treatEmptyAsZero,
      );
      const sCalc = computeDisbursementRow(
        { openingBalance: item.sulfate.opening, closingBalance: item.sulfate.closing, settlementQty: item.sulfate.settlement },
        ctx.treatEmptyAsZero,
      );
      docTotals.uOpen += item.urea.opening ?? 0;
      docTotals.nOpen += item.nitrate.opening ?? 0;
      docTotals.sOpen += item.sulfate.opening ?? 0;
      docTotals.uClose += item.urea.closing ?? 0;
      docTotals.nClose += item.nitrate.closing ?? 0;
      docTotals.sClose += item.sulfate.closing ?? 0;
      docTotals.uAct += uCalc.actualDisbursed ?? 0;
      docTotals.nAct += nCalc.actualDisbursed ?? 0;
      docTotals.sAct += sCalc.actualDisbursed ?? 0;
      docTotals.uSettle += item.urea.settlement ?? 0;
      docTotals.nSettle += item.nitrate.settlement ?? 0;
      docTotals.sSettle += item.sulfate.settlement ?? 0;
      docTotals.uVar += uCalc.variance ?? 0;
      docTotals.nVar += nCalc.variance ?? 0;
      docTotals.sVar += sCalc.variance ?? 0;

      const anyVar = uCalc.hasVariance || nCalc.hasVariance || sCalc.hasVariance;
      const reason =
        [item.urea.reason, item.nitrate.reason, item.sulfate.reason].filter(Boolean).join(' | ') || '—';

      const vals = [
        reason,
        anyVar ? '⚠ اختلاف' : '✔ مطابق',
        formatNumberAr(sCalc.variance),
        formatNumberAr(nCalc.variance),
        formatNumberAr(uCalc.variance),
        formatNumberAr(item.sulfate.settlement),
        formatNumberAr(item.nitrate.settlement),
        formatNumberAr(item.urea.settlement),
        formatNumberAr(sCalc.actualDisbursed),
        formatNumberAr(nCalc.actualDisbursed),
        formatNumberAr(uCalc.actualDisbursed),
        formatNumberAr(item.sulfate.closing),
        formatNumberAr(item.nitrate.closing),
        formatNumberAr(item.urea.closing),
        formatNumberAr(item.sulfate.opening),
        formatNumberAr(item.nitrate.opening),
        formatNumberAr(item.urea.opening),
        item.association.nameAr,
      ];

      return new TableRow({
        children: vals.map((v, cIdx) => {
          const isVarCell = (cIdx === 2 && sCalc.hasVariance) || (cIdx === 3 && nCalc.hasVariance) || (cIdx === 4 && uCalc.hasVariance);
          return new TableCell({
            borders: cellBorderConfig(),
            shading: isVarCell ? { type: ShadingType.CLEAR, fill: 'FEE2E2' } : undefined,
            children: [
              rtlParagraph(v, {
                size: 15,
                bold: isVarCell || cIdx === 17,
                color: isVarCell ? 'B91C1C' : undefined,
                align: cIdx === 17 || cIdx === 0 ? 'right' : 'center',
              }),
            ],
          });
        }),
      });
    });

    const totalsVals = [
      'شكارة (50 كجم)',
      '—',
      formatNumberAr(docTotals.sVar),
      formatNumberAr(docTotals.nVar),
      formatNumberAr(docTotals.uVar),
      formatNumberAr(docTotals.sSettle),
      formatNumberAr(docTotals.nSettle),
      formatNumberAr(docTotals.uSettle),
      formatNumberAr(docTotals.sAct),
      formatNumberAr(docTotals.nAct),
      formatNumberAr(docTotals.uAct),
      formatNumberAr(docTotals.sClose),
      formatNumberAr(docTotals.nClose),
      formatNumberAr(docTotals.uClose),
      formatNumberAr(docTotals.sOpen),
      formatNumberAr(docTotals.nOpen),
      formatNumberAr(docTotals.uOpen),
      `الإجمالي (${sortedRows.length} جمعية)`,
    ];
    const totalsRow = new TableRow({
      children: totalsVals.map((v, cIdx) =>
        new TableCell({
          borders: cellBorderConfig(),
          shading: { type: ShadingType.CLEAR, fill: 'E2E8F0' },
          children: [
            rtlParagraph(v, {
              size: 15,
              bold: true,
              align: cIdx === 17 || cIdx === 0 ? 'right' : 'center',
            }),
          ],
        }),
      ),
    });

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.AUTOFIT,
        rows: [headerRow, ...dataRows, totalsRow],
      }),
    );
    children.push(new Paragraph({ text: '' }));
  }

  if (scope === 'both' || scope === 'tractors_only') {
    children.push(rtlParagraph('ثانيًا: سجل الجرارات والبوليصات (فرق الشحنة = العدد الفعلي − عدد البوليصة)', { bold: true, size: 22 }));
    const trReversedHeaders = [
      'الاعتماد',
      'الحالة',
      'فرق الشحنة',
      'الفعلي',
      'البوليصة',
      'الصنف',
      'رقم البوليصة',
      'رقم الجرار',
      'الجمعية المستلمة',
      'التاريخ',
    ];
    const trHead = new TableRow({
      tableHeader: true,
      children: trReversedHeaders.map(
        (h) =>
          new TableCell({
            borders: cellBorderConfig(),
            shading: { type: ShadingType.CLEAR, fill: 'E2E8F0' },
            children: [rtlParagraph(h, { bold: true, size: 16, align: 'center' })],
          }),
      ),
    });

    const trRows =
      ctx.tractors.length === 0
        ? [
            new TableRow({
              children: [
                new TableCell({
                  columnSpan: 10,
                  borders: cellBorderConfig(),
                  children: [rtlParagraph('لا توجد جرارات مسجلة لهذا النطاق.', { size: 16, align: 'center' })],
                }),
              ],
            }),
          ]
        : ctx.tractors.map((tr) => {
            const assoc = ctx.associations.find((a) => a.id === tr.associationId);
            const fert = ctx.fertilizerTypes.find((f) => f.code === tr.fertilizerCode);
            const matched = tr.inspectionStatus === 'matched' && tr.bagVariance === 0;
            const vals = [
              tr.approvalState === 'final_approved' ? 'معتمد' : 'معلق',
              matched ? '✔ مطابق' : '⚠ اختلاف',
              formatNumberAr(tr.bagVariance),
              formatNumberAr(tr.actualBags),
              formatNumberAr(tr.manifestBags),
              fert?.nameAr || tr.fertilizerCode,
              tr.manifestNumber,
              tr.tractorPlate,
              assoc?.nameAr || tr.associationId,
              tr.arrivalDate,
            ];
            return new TableRow({
              children: vals.map((v, i) =>
                new TableCell({
                  borders: cellBorderConfig(),
                  children: [
                    rtlParagraph(v, {
                      size: 16,
                      bold: i === 1 && !matched,
                      color: i === 1 && !matched ? 'B91C1C' : undefined,
                      align: i === 8 ? 'right' : 'center',
                    }),
                  ],
                }),
              ),
            });
          });

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.AUTOFIT,
        rows: [trHead, ...trRows],
      }),
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.LANDSCAPE,
              width: 16838,
              height: 11906,
            },
            margin: { top: 600, right: 600, bottom: 600, left: 600 },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const filename = buildExportFileName(ctx.governorate.nameAr, ctx.reportDate, 'docx');
  triggerBlobDownload(blob, filename);
  return filename;
}

export async function exportToPdf(
  ctx: ExportDocumentContext,
  scope: ExportScope,
): Promise<string> {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const container = document.createElement('div');
  container.setAttribute('dir', 'rtl');
  container.style.position = 'fixed';
  container.style.left = '-12000px';
  container.style.top = '0';
  container.style.width = '1120px';
  container.style.background = '#ffffff';
  container.style.color = '#000000';
  container.style.fontFamily = "'IBM Plex Sans Arabic', 'Cairo', sans-serif";
  container.style.padding = '16px';
  document.body.appendChild(container);

  const renderPageHtml = async (html: string, isFirstPage: boolean) => {
    container.innerHTML = html;
    await new Promise((r) => setTimeout(r, 40));
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });
    const imgData = canvas.toDataURL('image/png');
    if (!isFirstPage) pdf.addPage('a4', 'landscape');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2;
    const ratio = Math.min(availW / canvas.width, availH / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;
    pdf.addImage(imgData, 'PNG', margin, margin, w, h);
  };

  try {
    let pageAdded = false;
    const chunkSize = 18;

    if (scope === 'both' || scope === 'sheet_only') {
      const sortedPdfRows = [...ctx.sheetRows].sort((a, b) => {
        const oa = typeof a.association.sortOrder === 'number' ? a.association.sortOrder : Number.MAX_SAFE_INTEGER;
        const ob = typeof b.association.sortOrder === 'number' ? b.association.sortOrder : Number.MAX_SAFE_INTEGER;
        return oa !== ob ? oa - ob : a.association.nameAr.localeCompare(b.association.nameAr, 'ar');
      });
      const pdfTotals = {
        uOpen: 0, nOpen: 0, sOpen: 0,
        uClose: 0, nClose: 0, sClose: 0,
        uAct: 0, nAct: 0, sAct: 0,
        uSettle: 0, nSettle: 0, sSettle: 0,
        uVar: 0, nVar: 0, sVar: 0,
      };
      sortedPdfRows.forEach((item) => {
        const uCalc = computeDisbursementRow(
          { openingBalance: item.urea.opening, closingBalance: item.urea.closing, settlementQty: item.urea.settlement },
          ctx.treatEmptyAsZero,
        );
        const nCalc = computeDisbursementRow(
          { openingBalance: item.nitrate.opening, closingBalance: item.nitrate.closing, settlementQty: item.nitrate.settlement },
          ctx.treatEmptyAsZero,
        );
        const sCalc = computeDisbursementRow(
          { openingBalance: item.sulfate.opening, closingBalance: item.sulfate.closing, settlementQty: item.sulfate.settlement },
          ctx.treatEmptyAsZero,
        );
        pdfTotals.uOpen += item.urea.opening ?? 0;
        pdfTotals.nOpen += item.nitrate.opening ?? 0;
        pdfTotals.sOpen += item.sulfate.opening ?? 0;
        pdfTotals.uClose += item.urea.closing ?? 0;
        pdfTotals.nClose += item.nitrate.closing ?? 0;
        pdfTotals.sClose += item.sulfate.closing ?? 0;
        pdfTotals.uAct += uCalc.actualDisbursed ?? 0;
        pdfTotals.nAct += nCalc.actualDisbursed ?? 0;
        pdfTotals.sAct += sCalc.actualDisbursed ?? 0;
        pdfTotals.uSettle += item.urea.settlement ?? 0;
        pdfTotals.nSettle += item.nitrate.settlement ?? 0;
        pdfTotals.sSettle += item.sulfate.settlement ?? 0;
        pdfTotals.uVar += uCalc.variance ?? 0;
        pdfTotals.nVar += nCalc.variance ?? 0;
        pdfTotals.sVar += sCalc.variance ?? 0;
      });

      const totalPages = Math.max(1, Math.ceil(sortedPdfRows.length / chunkSize));
      for (let p = 0; p < totalPages; p++) {
        const slice = sortedPdfRows.slice(p * chunkSize, (p + 1) * chunkSize);
        const rowsHtml = slice
          .map((item) => {
            const uCalc = computeDisbursementRow(
              { openingBalance: item.urea.opening, closingBalance: item.urea.closing, settlementQty: item.urea.settlement },
              ctx.treatEmptyAsZero,
            );
            const nCalc = computeDisbursementRow(
              { openingBalance: item.nitrate.opening, closingBalance: item.nitrate.closing, settlementQty: item.nitrate.settlement },
              ctx.treatEmptyAsZero,
            );
            const sCalc = computeDisbursementRow(
              { openingBalance: item.sulfate.opening, closingBalance: item.sulfate.closing, settlementQty: item.sulfate.settlement },
              ctx.treatEmptyAsZero,
            );
            const anyVar = uCalc.hasVariance || nCalc.hasVariance || sCalc.hasVariance;
            const statusStr = anyVar ? '⚠ اختلاف' : '✔ مطابق';
            return `
              <tr>
                <td style="border:1px solid #000;padding:4px 6px;text-align:right;font-weight:700;">${escapeHtml(item.association.nameAr)}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(item.urea.opening))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(item.nitrate.opening))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(item.sulfate.opening))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(item.urea.closing))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(item.nitrate.closing))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(item.sulfate.closing))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;font-weight:700;">${escapeHtml(formatNumberAr(uCalc.actualDisbursed))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;font-weight:700;">${escapeHtml(formatNumberAr(nCalc.actualDisbursed))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;font-weight:700;">${escapeHtml(formatNumberAr(sCalc.actualDisbursed))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(item.urea.settlement))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(item.nitrate.settlement))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(item.sulfate.settlement))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;font-weight:700;">${escapeHtml(formatNumberAr(uCalc.variance))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;font-weight:700;">${escapeHtml(formatNumberAr(nCalc.variance))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;font-weight:700;">${escapeHtml(formatNumberAr(sCalc.variance))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;font-weight:700;">${escapeHtml(statusStr)}</td>
              </tr>
            `;
          })
          .join('');

        const isLastSheetPage = p === totalPages - 1 && sortedPdfRows.length > 0;
        const totalsFooterHtml = isLastSheetPage
          ? `<tfoot>
              <tr style="background:#e2e8f0;font-weight:800;">
                <td style="border:1px solid #000;padding:5px 6px;text-align:right;">الإجمالي (${sortedPdfRows.length})</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(pdfTotals.uOpen))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(pdfTotals.nOpen))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(pdfTotals.sOpen))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(pdfTotals.uClose))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(pdfTotals.nClose))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(pdfTotals.sClose))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(pdfTotals.uAct))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(pdfTotals.nAct))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(pdfTotals.sAct))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(pdfTotals.uSettle))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(pdfTotals.nSettle))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(pdfTotals.sSettle))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(pdfTotals.uVar))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(pdfTotals.nVar))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">${escapeHtml(formatNumberAr(pdfTotals.sVar))}</td>
                <td style="border:1px solid #000;padding:4px;text-align:center;">شيكارة</td>
              </tr>
            </tfoot>`
          : '';

        const pageHtml = `
          <div style="background:#fff;color:#000;direction:rtl;">
            <div style="text-align:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:10px;">
              <h1 style="margin:0;font-size:18px;font-weight:800;">${escapeHtml(ctx.organizationNameAr)} — كشف الصرف اليومي للأسمدة</h1>
              <p style="margin:4px 0 0;font-size:12px;">المحافظة: ${escapeHtml(ctx.governorate.nameAr)} | التاريخ: ${escapeHtml(ctx.reportDate)} | صفحة ${p + 1} من ${totalPages}</p>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:10px;color:#000;background:#fff;">
              <thead>
                <tr style="background:#f1f5f9;">
                  <th rowspan="2" style="border:1px solid #000;padding:5px;text-align:right;">الجمعية</th>
                  <th colspan="3" style="border:1px solid #000;padding:4px;text-align:center;">بداية اليوم</th>
                  <th colspan="3" style="border:1px solid #000;padding:4px;text-align:center;">نهاية اليوم</th>
                  <th colspan="3" style="border:1px solid #000;padding:4px;text-align:center;">المنصرف</th>
                  <th colspan="3" style="border:1px solid #000;padding:4px;text-align:center;">التسوية</th>
                  <th colspan="3" style="border:1px solid #000;padding:4px;text-align:center;">فرق التسوية</th>
                  <th rowspan="2" style="border:1px solid #000;padding:5px;text-align:center;">الحالة</th>
                </tr>
                <tr style="background:#f8fafc;">
                  <th style="border:1px solid #000;padding:3px;">يوريا</th><th style="border:1px solid #000;padding:3px;">نترات</th><th style="border:1px solid #000;padding:3px;">سلفات</th>
                  <th style="border:1px solid #000;padding:3px;">يوريا</th><th style="border:1px solid #000;padding:3px;">نترات</th><th style="border:1px solid #000;padding:3px;">سلفات</th>
                  <th style="border:1px solid #000;padding:3px;">يوريا</th><th style="border:1px solid #000;padding:3px;">نترات</th><th style="border:1px solid #000;padding:3px;">سلفات</th>
                  <th style="border:1px solid #000;padding:3px;">يوريا</th><th style="border:1px solid #000;padding:3px;">نترات</th><th style="border:1px solid #000;padding:3px;">سلفات</th>
                  <th style="border:1px solid #000;padding:3px;">يوريا</th><th style="border:1px solid #000;padding:3px;">نترات</th><th style="border:1px solid #000;padding:3px;">سلفات</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml || '<tr><td colspan="17" style="border:1px solid #000;padding:12px;text-align:center;">لا توجد صفوف جمعيات.</td></tr>'}
              </tbody>
              ${totalsFooterHtml}
            </table>
          </div>
        `;
        await renderPageHtml(pageHtml, !pageAdded);
        pageAdded = true;
      }
    }

    if (scope === 'both' || scope === 'tractors_only') {
      const trPages = Math.max(1, Math.ceil(ctx.tractors.length / chunkSize));
      for (let p = 0; p < trPages; p++) {
        const slice = ctx.tractors.slice(p * chunkSize, (p + 1) * chunkSize);
        const rowsHtml = slice
          .map((tr) => {
            const assoc = ctx.associations.find((a) => a.id === tr.associationId);
            const fert = ctx.fertilizerTypes.find((f) => f.code === tr.fertilizerCode);
            const matched = tr.inspectionStatus === 'matched' && tr.bagVariance === 0;
            return `
              <tr>
                <td style="border:1px solid #000;padding:5px;text-align:center;">${escapeHtml(tr.arrivalDate)}</td>
                <td style="border:1px solid #000;padding:5px;text-align:right;font-weight:700;">${escapeHtml(assoc?.nameAr || tr.associationId)}</td>
                <td style="border:1px solid #000;padding:5px;text-align:center;">${escapeHtml(tr.tractorPlate)}</td>
                <td style="border:1px solid #000;padding:5px;text-align:center;">${escapeHtml(tr.manifestNumber)}</td>
                <td style="border:1px solid #000;padding:5px;text-align:center;">${escapeHtml(fert?.nameAr || tr.fertilizerCode)}</td>
                <td style="border:1px solid #000;padding:5px;text-align:center;">${escapeHtml(formatNumberAr(tr.manifestBags))}</td>
                <td style="border:1px solid #000;padding:5px;text-align:center;">${escapeHtml(formatNumberAr(tr.actualBags))}</td>
                <td style="border:1px solid #000;padding:5px;text-align:center;font-weight:700;">${escapeHtml(formatNumberAr(tr.bagVariance))}</td>
                <td style="border:1px solid #000;padding:5px;text-align:center;font-weight:700;">${escapeHtml(matched ? '✔ مطابق' : '⚠ اختلاف')}</td>
              </tr>
            `;
          })
          .join('');

        const pageHtml = `
          <div style="background:#fff;color:#000;direction:rtl;">
            <div style="text-align:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:10px;">
              <h1 style="margin:0;font-size:18px;font-weight:800;">${escapeHtml(ctx.organizationNameAr)} — سجل الجرارات والبوليصات</h1>
              <p style="margin:4px 0 0;font-size:12px;">المحافظة: ${escapeHtml(ctx.governorate.nameAr)} | التاريخ: ${escapeHtml(ctx.reportDate)} | صفحة ${p + 1} من ${trPages}</p>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:11px;color:#000;background:#fff;">
              <thead>
                <tr style="background:#f1f5f9;">
                  <th style="border:1px solid #000;padding:6px;">التاريخ</th>
                  <th style="border:1px solid #000;padding:6px;text-align:right;">الجمعية المستلمة</th>
                  <th style="border:1px solid #000;padding:6px;">رقم الجرار</th>
                  <th style="border:1px solid #000;padding:6px;">رقم البوليصة</th>
                  <th style="border:1px solid #000;padding:6px;">الصنف</th>
                  <th style="border:1px solid #000;padding:6px;">عدد البوليصة</th>
                  <th style="border:1px solid #000;padding:6px;">العدد الفعلي</th>
                  <th style="border:1px solid #000;padding:6px;">فرق الشحنة</th>
                  <th style="border:1px solid #000;padding:6px;">الحالة</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml || '<tr><td colspan="9" style="border:1px solid #000;padding:12px;text-align:center;">لا توجد جرارات مسجلة لهذا النطاق.</td></tr>'}
              </tbody>
            </table>
          </div>
        `;
        await renderPageHtml(pageHtml, !pageAdded);
        pageAdded = true;
      }
    }

    const filename = buildExportFileName(ctx.governorate.nameAr, ctx.reportDate, 'pdf');
    const blob = pdf.output('blob');
    triggerBlobDownload(blob, filename);
    return filename;
  } finally {
    document.body.removeChild(container);
  }
}

import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import type { Lang } from '../types/wms.ts';

export function exportRowsToExcel(
  filename: string,
  sheetName: string,
  rows: Array<Record<string, unknown>>,
) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export async function exportReportToPdf(params: {
  filename: string;
  title: string;
  subtitle: string;
  lang: Lang;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
}) {
  const { filename, title, subtitle, lang, columns, rows } = params;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  // Render an off-screen clean HTML table with explicit hex colors for crisp Arabic RTL shaping
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.style.width = '1120px';
  container.style.background = '#ffffff';
  container.style.color = '#0f172a';
  container.style.padding = '32px';
  container.style.direction = dir;
  container.style.fontFamily =
    lang === 'ar'
      ? "'IBM Plex Sans Arabic', 'Cairo', sans-serif"
      : "'Manrope', sans-serif";

  const escapeHtml = (val: unknown) =>
    String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const headerCells = columns
    .map(
      (c) =>
        `<th style="padding:10px 12px;border-bottom:2px solid #1e3a5f;background:#0f172a;color:#ffffff;font-size:12px;font-weight:700;text-align:${dir === 'rtl' ? 'right' : 'left'};white-space:nowrap;">${escapeHtml(c.label)}</th>`,
    )
    .join('');

  const bodyRows = rows
    .slice(0, 200)
    .map((row, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      const cells = columns
        .map(
          (c) =>
            `<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#1e293b;text-align:${dir === 'rtl' ? 'right' : 'left'};">${escapeHtml(row[c.key] ?? '-')}</td>`,
        )
        .join('');
      return `<tr style="background:${bg};">${cells}</tr>`;
    })
    .join('');

  const company = lang === 'ar' ? 'شركة إيلا لصناعة المنسوجات — المستودع المركزي' : 'ELA Textile Manufacturing — Central Warehouse';
  const generatedLabel = lang === 'ar' ? 'تاريخ التقرير:' : 'Generated:';
  const dateStr = new Date().toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB');

  container.innerHTML = `
    <div style="border-bottom:2px solid #0f172a;padding-bottom:16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-end;">
      <div>
        <div style="font-size:12px;color:#475569;font-weight:600;margin-bottom:4px;">${escapeHtml(company)}</div>
        <h1 style="font-size:22px;font-weight:700;color:#0f172a;margin:0;">${escapeHtml(title)}</h1>
        <div style="font-size:13px;color:#64748b;margin-top:4px;">${escapeHtml(subtitle)}</div>
      </div>
      <div style="font-size:11px;color:#475569;text-align:${dir === 'rtl' ? 'left' : 'right'};">
        <div>${escapeHtml(generatedLabel)} ${escapeHtml(dateStr)}</div>
        <div style="margin-top:2px;">${lang === 'ar' ? `عدد السجلات: ${rows.length}` : `Records: ${rows.length}`}</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;

  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: columns.length > 6 ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(`${filename}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

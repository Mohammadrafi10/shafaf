import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";
import { ReportData } from "./report";
import { georgianToPersian } from "./date";
import { sanitizeFilename, sanitizeSheetName, formatCellForExcel } from "./exportHelpers";
import { getCompanySettings } from "./company";

/**
 * Export report to PDF
 */
export async function exportReportToPDF(
  reportData: ReportData,
  reportElement: HTMLElement
): Promise<void> {
  let actionButtons: Element | null = null;
  let styleElement: HTMLStyleElement | null = null;
  const elementsToFix: Array<{ element: HTMLElement; originalClasses: string; originalStyle: string }> = [];

  try {
    actionButtons = document.querySelector(".no-print");
    if (actionButtons) (actionButtons as HTMLElement).style.display = "none";

    const styleId = "pdf-export-oklch-fix";
    styleElement = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleElement) {
      styleElement = document.createElement("style");
      styleElement.id = styleId;
      styleElement.textContent = `
        * { background-image: none !important; }
        [class*="gradient"], [class*="from-"], [class*="to-"] {
          background: #3b82f6 !important; background-color: #3b82f6 !important; background-image: none !important;
        }
      `;
      document.head.appendChild(styleElement);
    }

    if (reportElement) {
      reportElement.querySelectorAll("*").forEach((el) => {
        const htmlEl = el as HTMLElement;
        const computedStyle = window.getComputedStyle(htmlEl);
        const bg = computedStyle.background || computedStyle.backgroundColor || "";
        if (bg.includes("oklch") || /gradient|from-|to-/.test(htmlEl.className || "")) {
          elementsToFix.push({
            element: htmlEl,
            originalClasses: htmlEl.className,
            originalStyle: htmlEl.style.cssText,
          });
          htmlEl.style.background = "#f8fafc";
          htmlEl.style.backgroundColor = "#f8fafc";
          htmlEl.style.backgroundImage = "none";
          htmlEl.className = (htmlEl.className || "")
            .split(" ")
            .filter((c) => !/gradient|from-|to-|hover:(from|to)-/.test(c))
            .join(" ");
        }
      });
    }

    await new Promise((r) => setTimeout(r, 250));

    const PDF_STYLE = `
      * { background-image: none !important; box-sizing: border-box !important; }
      [class*="gradient"], [class*="from-"], [class*="to-"] { background: #e5e7eb !important; background-color: #e5e7eb !important; }
      html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; width: 210mm !important; overflow: visible !important; }
      [data-pdf-root] { width: 210mm !important; max-width: 100% !important; margin: 0 auto !important; padding: 15mm !important; background: #fff !important; }
      [data-pdf-root] h2 { font-size: 18pt !important; margin: 0 0 10px 0 !important; color: #111 !important; }
      [data-pdf-root] h3 { font-size: 14pt !important; margin: 14px 0 8px 0 !important; color: #333 !important; }
      [data-pdf-root] p { font-size: 11pt !important; margin: 0 0 8px 0 !important; color: #444 !important; line-height: 1.5 !important; }
      [data-pdf-root] table { width: 100% !important; border-collapse: collapse !important; font-size: 10pt !important; table-layout: auto !important; }
      [data-pdf-root] th, [data-pdf-root] td { border: 1px solid #ccc !important; padding: 8px 10px !important; text-align: right !important; color: #222 !important; }
      [data-pdf-root] th { background: #f5f5f5 !important; font-weight: 600 !important; }
      [data-pdf-root] [class*="overflow-x-auto"] { overflow: visible !important; }
    `;

    let canvas: HTMLCanvasElement;
    try {
      canvas = await html2canvas(reportElement, {
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
        onclone: (clonedDoc) => {
          clonedDoc.querySelectorAll("style").forEach((s) => {
            if (s.textContent?.includes("oklch")) s.remove();
          });
          const pdfStyle = clonedDoc.createElement("style");
          pdfStyle.textContent = PDF_STYLE;
          const target = clonedDoc.head || clonedDoc.documentElement;
          if (target) target.insertBefore(pdfStyle, target.firstChild);
        },
      });
    } catch (err) {
      console.warn("html2canvas failed, trying simplified clone", err);
      const clone = reportElement.cloneNode(true) as HTMLElement;
      clone.style.position = "absolute";
      clone.style.left = "-9999px";
      clone.style.top = "0";
      clone.style.width = "210mm";
      clone.style.background = "#fff";
      clone.querySelectorAll("*").forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (/gradient|from-|to-/.test(htmlEl.className || "")) {
          htmlEl.className = (htmlEl.className || "")
            .split(" ")
            .filter((c) => !/gradient|from-|to-|hover/.test(c))
            .join(" ");
          htmlEl.style.background = "#e5e7eb";
          htmlEl.style.backgroundColor = "#e5e7eb";
          htmlEl.style.backgroundImage = "none";
        }
      });
      document.body.appendChild(clone);
      const override = document.createElement("style");
      override.id = "pdf-fallback-override";
      override.textContent = PDF_STYLE;
      document.head.appendChild(override);
      try {
        canvas = await html2canvas(clone, {
          scale: 3,
          useCORS: true,
          logging: false,
          backgroundColor: "#ffffff",
        });
      } finally {
        document.body.removeChild(clone);
        const o = document.getElementById("pdf-fallback-override");
        if (o) o.remove();
      }
    }

    const imgWidthMm = 210;
    const totalHeightMm = (canvas.height / canvas.width) * imgWidthMm;
    const pageHeightMm = 297;
    const numPages = Math.ceil(totalHeightMm / pageHeightMm);

    const pdf = new jsPDF("p", "mm", "a4");

    // Add company info if available
    let companySettings: any = null;
    try {
      companySettings = await getCompanySettings();
      if (companySettings?.name) {
        pdf.setFontSize(16);
        pdf.text(companySettings.name, 105, 15, { align: "center" });
      }
    } catch (e) {
      // Ignore if company settings not available
    }

    // Add report title
    pdf.setFontSize(14);
    pdf.text(reportData.title, 105, companySettings ? 25 : 20, { align: "center" });

    // Add date range
    pdf.setFontSize(10);
    const fromPersian = georgianToPersian(reportData.dateRange.from);
    const toPersian = georgianToPersian(reportData.dateRange.to);
    pdf.text(`از تاریخ: ${fromPersian} تا تاریخ: ${toPersian}`, 105, companySettings ? 32 : 27, {
      align: "center",
    });

    let startY = companySettings ? 40 : 35;

    for (let i = 0; i < numPages; i++) {
      if (i > 0) {
        pdf.addPage();
        startY = 20;
      }
      const ySrc = (i * pageHeightMm / totalHeightMm) * canvas.height;
      const hSrc = Math.min((pageHeightMm / totalHeightMm) * canvas.height, canvas.height - ySrc);
      const imgHeightMm = Math.min(pageHeightMm - startY, (hSrc / canvas.width) * imgWidthMm);
      const temp = document.createElement("canvas");
      temp.width = canvas.width;
      temp.height = hSrc;
      const ctx = temp.getContext("2d")!;
      ctx.drawImage(canvas, 0, ySrc, canvas.width, hSrc, 0, 0, canvas.width, hSrc);
      pdf.addImage(temp.toDataURL("image/png"), "PNG", 0, startY, imgWidthMm, imgHeightMm);
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    pdf.save(`گزارش-${sanitizeFilename(reportData.title)}-${dateStr}.pdf`);
  } finally {
    elementsToFix.forEach(({ element, originalClasses, originalStyle }) => {
      element.className = originalClasses;
      element.style.cssText = originalStyle;
    });
    if (styleElement?.parentNode) styleElement.parentNode.removeChild(styleElement);
    if (actionButtons) (actionButtons as HTMLElement).style.display = "";
  }
}

/**
 * Export report to Excel
 */
export async function exportReportToExcel(reportData: ReportData): Promise<void> {
  const wb = XLSX.utils.book_new();

  // Add summary sheet
  const summaryData: any[][] = [
    ["گزارش", reportData.title],
    ["از تاریخ", georgianToPersian(reportData.dateRange.from)],
    ["تا تاریخ", georgianToPersian(reportData.dateRange.to)],
    [],
    ["خلاصه", ""],
  ];

  Object.entries(reportData.summary).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      const label = key === "totalCount" ? "تعداد کل" :
                    key === "totalAmount" ? "مجموع مبلغ" :
                    key === "paidAmount" ? "مبلغ پرداخت شده" :
                    key === "remainingAmount" ? "مبلغ باقیمانده" :
                    key === "totalDeposits" ? "مجموع واریزها" :
                    key === "totalWithdrawals" ? "مجموع برداشت‌ها" :
                    key === "totalSales" ? "مجموع فروشات" :
                    key === "totalPaid" ? "مجموع پرداخت شده" :
                    key === "totalRemaining" ? "مجموع باقیمانده" :
                    key === "totalPurchases" ? "مجموع خریداری‌ها" :
                    key === "totalSalesAmount" ? "مجموع فروش محصولات" :
                    key === "totalPurchaseAmount" ? "مجموع خرید محصولات" :
                    key;
      summaryData.push([label, typeof value === "number" ? value : String(value)]);
    }
  });

  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWs, "خلاصه");

  // Add sections as separate sheets
  reportData.sections.forEach((section, index) => {
    if (section.type === "table" && section.columns && section.data.length > 0) {
      const headerRow = section.columns.map((c) => c.label);
      const dataRows = section.data.map((row) =>
        section.columns!.map((col) => formatCellForExcel(row[col.key]))
      );
      const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
      const sheetName = sanitizeSheetName(section.title) || `بخش ${index + 1}`;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    } else if (section.type === "summary" && section.data.length > 0) {
      // For summary sections, create a simple two-column table
      const rows: any[][] = [["عنوان", "مقدار"]];
      section.data.forEach((item: any) => {
        rows.push([item.label || "", item.value || ""]);
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const sheetName = sanitizeSheetName(section.title) || `خلاصه ${index + 1}`;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
  });

  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `گزارش-${sanitizeFilename(reportData.title)}-${dateStr}.xlsx`);
}

/** Column definition for stock export */
const STOCK_EXPORT_COLUMNS: { key: keyof import("./sales").StockBatchRow; label: string }[] = [
  { key: "product_name", label: "نام محصول" },
  { key: "batch_number", label: "شماره دسته" },
  { key: "purchase_date", label: "تاریخ خرید" },
  { key: "expiry_date", label: "تاریخ انقضا" },
  { key: "unit_name", label: "واحد" },
  { key: "amount", label: "مقدار اولیه" },
  { key: "remaining_quantity", label: "موجودی باقی‌مانده" },
  { key: "per_price", label: "قیمت خرید (واحد)" },
  { key: "total_purchase_cost", label: "مجموع هزینه خرید دسته" },
  { key: "cost_price", label: "قیمت تمام شده" },
  { key: "retail_price", label: "قیمت خرده‌فروشی" },
  { key: "stock_value", label: "ارزش موجودی" },
  { key: "potential_revenue_retail", label: "درآمد بالقوه (خرده)" },
  { key: "potential_profit", label: "سود بالقوه" },
  { key: "margin_percent", label: "درصد سود" },
];

/**
 * Export stock report (by batches) to Excel.
 */
export function exportStockReportToExcel(
  rows: import("./sales").StockBatchRow[],
  totals: { totalStockValue: number; totalPotentialRevenue: number; totalPotentialProfit: number }
): void {
  const wb = XLSX.utils.book_new();
  const summaryData: (string | number)[][] = [
    ["گزارش موجودی (بر اساس دسته)", ""],
    ["تاریخ خروجی", new Date().toISOString().slice(0, 10)],
    [],
    ["مجموع ارزش موجودی", totals.totalStockValue],
    ["مجموع درآمد بالقوه", totals.totalPotentialRevenue],
    ["مجموع سود بالقوه", totals.totalPotentialProfit],
    [],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWs, "خلاصه");

  const headerRow = STOCK_EXPORT_COLUMNS.map((c) => c.label);
  const dataRows = rows.map((row) =>
    STOCK_EXPORT_COLUMNS.map((col) => {
      let v: unknown = row[col.key];
      if (col.key === "retail_price") v = (v as number | null) ?? row.per_price;
      if (v == null) return "";
      return typeof v === "number" ? v : String(v);
    })
  );
  const dataWs = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  XLSX.utils.book_append_sheet(wb, dataWs, "موجودی دسته‌ها");

  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `گزارش-موجودی-دسته-${dateStr}.xlsx`);
}

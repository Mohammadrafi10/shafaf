import { useRef, useState, useEffect } from "react";
import { SaleWithItems, SalePayment } from "../utils/sales";
import { Customer } from "../utils/customer";
import { Product } from "../utils/product";
import { Unit } from "../utils/unit";
import { CompanySettings } from "../utils/company";
import { formatPersianDateLong } from "../utils/date";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import toast from "react-hot-toast";
import * as QRCode from "qrcode";

interface SaleInvoiceProps {
    saleData: SaleWithItems;
    customer: Customer;
    products: Product[];
    units: Unit[];
    payments?: SalePayment[];
    companySettings?: CompanySettings | null;
    onClose?: () => void;
}

export default function SaleInvoice({
    saleData,
    customer,
    products,
    units,
    payments: _payments,
    companySettings,
    onClose,
}: SaleInvoiceProps) {
    const printRef = useRef<HTMLDivElement>(null);
    const qrCodeCanvasRef = useRef<HTMLCanvasElement>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>("");

    // Generate QR code on mount
    useEffect(() => {
        if (qrCodeCanvasRef.current) {
            const qrData = JSON.stringify({
                type: "sale_invoice",
                id: saleData.sale.id,
                date: saleData.sale.date,
                customer: customer.full_name,
                total: saleData.sale.total_amount,
                paid: saleData.sale.paid_amount,
            });

            QRCode.toCanvas(qrCodeCanvasRef.current, qrData, {
                width: 200,
                margin: 2,
                color: {
                    dark: '#1e3a8a',
                    light: '#FFFFFF',
                },
            })
                .then(() => {
                    if (qrCodeCanvasRef.current) {
                        setQrCodeDataUrl(qrCodeCanvasRef.current.toDataURL());
                    }
                })
                .catch((error) => {
                    console.error("Error generating QR code:", error);
                });
        }
    }, [saleData, customer]);

    // Auto-download PDF when component mounts
    useEffect(() => {
        // Small delay to ensure QR code and content are rendered
        const timer = setTimeout(() => {
            if (printRef.current && !isExporting) {
                handleExportPDF(true); // Pass true to auto-close after download
            }
        }, 1500); // Wait for QR code to be generated

        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [qrCodeDataUrl]); // Trigger when QR code is ready

    const formatDate = (dateString: string) => {
        return formatPersianDateLong(dateString);
    };

    const formatNumber = (num: number) => {
        return new Intl.NumberFormat("en-US").format(num);
    };

    const getProductName = (productId: number) => {
        const product = products.find((p) => p.id === productId);
        return product?.name || "نامشخص";
    };

    const getUnitName = (unitId: number) => {
        const unit = units.find((u) => u.id === unitId);
        return unit?.name || "نامشخص";
    };

    const handleExportPDF = async (autoClose = false) => {
        if (!printRef.current) {
            toast.error("خطا در تولید PDF");
            return;
        }

        try {
            setIsExporting(true);

            const actionButtons = document.querySelector('.no-print');
            if (actionButtons) (actionButtons as HTMLElement).style.display = 'none';

            // Inject CSS override to prevent oklch parsing errors
            const styleId = 'pdf-export-oklch-fix';
            let styleElement = document.getElementById(styleId) as HTMLStyleElement;
            if (!styleElement) {
                styleElement = document.createElement('style');
                styleElement.id = styleId;
                styleElement.textContent = `
                    * {
                        background-image: none !important;
                    }
                    [class*="gradient"],
                    [class*="from-"],
                    [class*="to-"] {
                        background: #3b82f6 !important;
                        background-color: #3b82f6 !important;
                        background-image: none !important;
                    }
                `;
                document.head.appendChild(styleElement);
            }

            // Temporarily replace gradient classes with solid colors
            const elementsToFix: Array<{ element: HTMLElement; originalClasses: string; originalStyle: string }> = [];
            if (printRef.current) {
                const allElements = printRef.current.querySelectorAll('*');
                allElements.forEach((el) => {
                    const htmlEl = el as HTMLElement;
                    const computedStyle = window.getComputedStyle(htmlEl);
                    const bg = computedStyle.background || computedStyle.backgroundColor || '';

                    // Check if element has oklch in computed styles
                    if (bg.includes('oklch') || htmlEl.className.includes('gradient') || htmlEl.className.includes('from-') || htmlEl.className.includes('to-')) {
                        const originalClasses = htmlEl.className;
                        const originalStyle = htmlEl.style.cssText;

                        // Force solid color
                        htmlEl.style.background = '#3b82f6';
                        htmlEl.style.backgroundColor = '#3b82f6';
                        htmlEl.style.backgroundImage = 'none';

                        // Remove gradient classes
                        htmlEl.className = originalClasses
                            .split(' ')
                            .filter(cls => !cls.includes('gradient') && !cls.includes('from-') && !cls.includes('to-') && !cls.includes('hover:from-') && !cls.includes('hover:to-'))
                            .join(' ');

                        elementsToFix.push({ element: htmlEl, originalClasses, originalStyle });
                    }
                });
            }

            // Wait for styles to apply
            await new Promise(resolve => setTimeout(resolve, 200));

            let canvas;
            try {
                canvas = await html2canvas(printRef.current, {
                    scale: 3,
                    useCORS: true,
                    logging: false,
                    backgroundColor: '#ffffff',
                    onclone: (clonedDoc) => {
                        // Remove all stylesheets that might contain oklch
                        const styleSheets = clonedDoc.querySelectorAll('style, link[rel="stylesheet"]');
                        styleSheets.forEach((style) => {
                            if (style.textContent?.includes('oklch') || (style as HTMLLinkElement).href?.includes('tailwind')) {
                                style.remove();
                            }
                        });

                        // Traverse all elements and fix computed styles
                        const allElements = clonedDoc.querySelectorAll('*');
                        allElements.forEach((el) => {
                            const htmlEl = el as HTMLElement;

                            // Get computed styles and replace oklch
                            try {
                                const computedStyle = window.getComputedStyle(htmlEl);

                                // Check and fix background
                                const bg = computedStyle.background || computedStyle.backgroundColor || '';
                                if (bg.includes('oklch')) {
                                    htmlEl.style.background = '#3b82f6';
                                    htmlEl.style.backgroundColor = '#3b82f6';
                                    htmlEl.style.backgroundImage = 'none';
                                }

                                // Check and fix color
                                const color = computedStyle.color || '';
                                if (color.includes('oklch')) {
                                    htmlEl.style.color = '#1e293b';
                                }

                                // Check and fix border
                                const border = computedStyle.borderColor || computedStyle.borderTopColor || '';
                                if (border.includes('oklch')) {
                                    htmlEl.style.borderColor = '#e2e8f0';
                                }

                                // Remove gradient classes
                                if (htmlEl.className) {
                                    htmlEl.className = htmlEl.className
                                        .split(' ')
                                        .filter(cls => !cls.includes('gradient') && !cls.includes('from-') && !cls.includes('to-'))
                                        .join(' ');
                                }
                            } catch (e) {
                                // Ignore errors for individual elements
                            }
                        });
                    },
                });
            } catch (error) {
                // If still fails, try with even simpler approach - clone and simplify
                console.warn('First attempt failed, trying simpler rendering...', error);

                // Create a simplified clone
                const clone = printRef.current.cloneNode(true) as HTMLElement;
                clone.style.position = 'absolute';
                clone.style.left = '-9999px';
                clone.style.top = '0';
                document.body.appendChild(clone);

                // Remove all problematic classes and styles
                const allElements = clone.querySelectorAll('*');
                allElements.forEach((el) => {
                    const htmlEl = el as HTMLElement;
                    htmlEl.className = htmlEl.className
                        .split(' ')
                        .filter(cls => !cls.includes('gradient') && !cls.includes('from-') && !cls.includes('to-') && !cls.includes('hover'))
                        .join(' ');
                    htmlEl.style.background = htmlEl.style.background?.replace(/oklch\([^)]+\)/g, '#3b82f6') || '';
                    htmlEl.style.backgroundColor = htmlEl.style.backgroundColor?.replace(/oklch\([^)]+\)/g, '#3b82f6') || '';
                    htmlEl.style.color = htmlEl.style.color?.replace(/oklch\([^)]+\)/g, '#1e293b') || '';
                });

                try {
                    canvas = await html2canvas(clone, {
                        scale: 2,
                        useCORS: true,
                        logging: false,
                        backgroundColor: '#ffffff',
                    });
                } finally {
                    document.body.removeChild(clone);
                }
            }

            // Restore original classes and styles
            elementsToFix.forEach(({ element, originalClasses, originalStyle }) => {
                element.className = originalClasses;
                element.style.cssText = originalStyle;
            });

            // Remove injected style
            if (styleElement && styleElement.parentNode) {
                styleElement.parentNode.removeChild(styleElement);
            }

            if (actionButtons) (actionButtons as HTMLElement).style.display = '';

            const imgWidth = 210;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;

            const pdf = new jsPDF('p', 'mm', 'a4');
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, imgWidth, imgHeight);

            const fileName = `فاکتور-فروش-${saleData.sale.id}.pdf`;
            pdf.save(fileName);

            toast.success("PDF با موفقیت دانلود شد");

            // Auto-close modal after download if requested
            if (autoClose && onClose) {
                setTimeout(() => {
                    onClose();
                }, 500);
            }
        } catch (error) {
            console.error("Error exporting PDF:", error);
            toast.error("خطا در تولید PDF");
        } finally {
            setIsExporting(false);
        }
    };

    const remainingAmount = saleData.sale.total_amount - saleData.sale.paid_amount;

    return (
        <>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
                @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700;800&display=swap');
                
                .invoice-root {
                    font-family: 'Vazirmatn', 'Inter', system-ui, -apple-system, sans-serif;
                    background-color: #f1f5f9;
                }

                .invoice-card {
                    background: white;
                    width: 210mm;
                    min-height: 297mm;
                    margin: 40px auto;
                    padding: 0;
                    box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.15);
                    position: relative;
                    direction: rtl;
                    border-radius: 4px;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }

                .invoice-header-bg {
                    height: 12px;
                    background: linear-gradient(90deg, #1d4ed8 0%, #3b82f6 100%);
                    width: 100%;
                }

                .invoice-content {
                    padding: 40px 50px;
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                }

                .status-badge {
                    display: inline-flex;
                    align-items: center;
                    padding: 8px 16px;
                    border-radius: 12px;
                    font-size: 13px;
                    font-weight: 800;
                    margin-bottom: 20px;
                }
                
                .status-paid { background: #dbface; color: #166534; border: 1px solid #bbf7d0; }
                .status-partial { background: #fef9c3; color: #854d0e; border: 1px solid #fde047; }

                .company-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 50px;
                    border-bottom: 2px solid #f1f5f9;
                    padding-bottom: 40px;
                }

                .company-logo-container {
                    width: 90px;
                    height: 90px;
                    background: #ffffff;
                    border-radius: 18px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                    border: 2px solid #e2e8f0;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
                }

                .company-logo-img {
                    max-width: 75%;
                    max-height: 75%;
                    object-fit: contain;
                }

                .company-info-text h1 {
                    font-size: 32px;
                    font-weight: 900;
                    color: #0f172a;
                    margin: 0 0 10px 0;
                    letter-spacing: -0.02em;
                }

                .company-info-subtitle {
                    color: #64748b;
                    font-weight: 500;
                    font-size: 15px;
                }

                .info-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 60px;
                    margin-bottom: 50px;
                }

                .info-card h3 {
                    font-size: 13px;
                    font-weight: 700;
                    color: #94a3b8;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 16px;
                }

                .info-card-content {
                    background: #f8fafc;
                    border-radius: 16px;
                    padding: 24px;
                    border: 1px solid #e2e8f0;
                }

                .info-main-text {
                    font-size: 18px;
                    font-weight: 700;
                    color: #1e293b;
                    margin-bottom: 12px;
                }

                .info-sub-text {
                    font-size: 14px;
                    color: #64748b;
                    line-height: 1.6;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .invoice-meta {
                    text-align: left;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }

                .meta-item {
                    display: flex;
                    justify-content: flex-end;
                    align-items: center;
                    gap: 16px;
                }

                .meta-label {
                    color: #64748b;
                    font-size: 14px;
                    font-weight: 500;
                }

                .meta-value {
                    color: #0f172a;
                    font-weight: 700;
                    font-size: 16px;
                    direction: ltr;
                }

                .table-container {
                    margin-bottom: 40px;
                    border-radius: 16px;
                    overflow: hidden;
                    border: 1px solid #e2e8f0;
                }

                .modern-table {
                    width: 100%;
                    border-collapse: collapse;
                }

                .modern-table th {
                    background: #f8fafc;
                    padding: 20px 24px;
                    text-align: right;
                    font-size: 13px;
                    font-weight: 700;
                    color: #475569;
                    border-bottom: 1px solid #e2e8f0;
                    white-space: nowrap;
                }

                .modern-table td {
                    padding: 20px 24px;
                    border-bottom: 1px solid #f1f5f9;
                    font-size: 15px;
                    color: #334155;
                    vertical-align: middle;
                }

                .modern-table tr:last-child td {
                    border-bottom: none;
                }
                
                .modern-table tbody tr:nth-child(even) {
                    background-color: #fcfcfc;
                }

                .modern-table .product-name {
                    font-weight: 600;
                    color: #0f172a;
                    font-size: 15px;
                }
                
                .row-total {
                    font-weight: 700;
                    color: #2563eb;
                }

                .summary-section {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-top: auto;
                    padding-top: 30px;
                }

                .footer-notes {
                    flex: 1;
                    max-width: 50%;
                    padding-left: 40px;
                }

                .notes-title {
                    font-size: 14px;
                    font-weight: 700;
                    color: #1e293b;
                    margin-bottom: 10px;
                }

                .notes-body {
                    font-size: 13px;
                    color: #64748b;
                    line-height: 1.7;
                    background: #fff;
                    border: 1px dashed #cbd5e1;
                    border-radius: 12px;
                    padding: 16px;
                }

                .total-card {
                    background: #0f172a;
                    color: white;
                    padding: 32px;
                    border-radius: 20px;
                    width: 360px;
                    box-shadow: 0 20px 40px -10px rgba(15, 23, 42, 0.3);
                }

                .total-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 16px;
                }
                
                .total-row.highlight {
                    margin-bottom: 0;
                    padding-top: 20px;
                    margin-top: 20px;
                    border-top: 1px solid rgba(255,255,255,0.15);
                }

                .total-label {
                    font-size: 15px;
                    color: #94a3b8;
                    font-weight: 500;
                }

                .total-value {
                    font-size: 18px;
                    font-weight: 600;
                    color: #f8fafc;
                    direction: ltr;
                }

                .grand-total-label {
                    font-size: 18px;
                    font-weight: 600;
                    color: #fff;
                }

                .grand-total-value {
                    font-size: 32px;
                    font-weight: 800;
                    color: #60a5fa;
                    direction: ltr;
                }

                .footer-bottom {
                    background: #f8fafc;
                    padding: 24px 50px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-top: 1px solid #e2e8f0;
                }
                
                .signature-area {
                    display: flex;
                    gap: 60px;
                }
                
                .signature-box {
                    text-align: center;
                }
                
                .signature-line {
                    width: 140px;
                    height: 1px;
                    background: #cbd5e1;
                    margin-bottom: 12px;
                }
                
                .signature-text {
                    font-size: 11px;
                    font-weight: 700;
                    color: #94a3b8;
                    text-transform: uppercase;
                    letter-spacing: 0.1em;
                }

                .qr-section {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    background: white;
                    padding: 10px;
                    border-radius: 12px;
                    border: 1px solid #e2e8f0;
                }

                .qr-img {
                    width: 60px;
                    height: 60px;
                    object-fit: contain;
                }

                .qr-info {
                    display: flex;
                    flex-direction: column;
                }

                .qr-title {
                    font-size: 12px;
                    font-weight: 800;
                    color: #0f172a;
                }
                
                .qr-subtitle {
                    font-size: 10px;
                    color: #64748b;
                    margin-top: 2px;
                }

                @media print {
                    .invoice-root { background: white; padding: 0; }
                    .invoice-card { 
                        box-shadow: none; 
                        margin: 0; 
                        width: 100%; 
                        min-height: 100vh;
                        border-radius: 0;
                        border: none;
                    }
                    .no-print { display: none !important; }
                    .print-break-inside { break-inside: avoid; }
                }
            `}</style>

            <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/80 backdrop-blur-md p-8 overflow-y-auto invoice-root">
                <div className="max-w-[230mm] w-full mx-auto">
                    <div className="no-print flex flex-col md:flex-row justify-between items-center mb-8 gap-4 px-2">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                            </div>
                            <div>
                                <h2 className="text-white text-xl font-bold">پیش‌نمایش فاکتور فروش</h2>
                                <p className="text-slate-400 text-sm">نسخه نهایی جهت چاپ یا ذخیره</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <button
                                onClick={() => handleExportPDF(false)}
                                disabled={isExporting}
                                className="px-6 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white rounded-xl shadow-lg shadow-blue-500/20 transition-all font-bold flex items-center gap-2 disabled:opacity-50 transform hover:-translate-y-0.5"
                            >
                                {isExporting ? (
                                    <span className="flex items-center gap-2">
                                        <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                        در حال پردازش...
                                    </span>
                                ) : (
                                    <>
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                        </svg>
                                        دانلود PDF
                                    </>
                                )}
                            </button>

                            {onClose && (
                                <button
                                    onClick={onClose}
                                    className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-xl transition-all font-bold backdrop-blur-sm"
                                >
                                    بستن
                                </button>
                            )}
                        </div>
                    </div>

                    <div ref={printRef} className="invoice-card">
                        <div className="invoice-header-bg"></div>

                        <div className="invoice-content">
                            <div className="company-header">
                                <div className="flex gap-6 items-center">
                                    <div className="company-logo-container">
                                        {companySettings?.logo ? (
                                            <img src={companySettings.logo} alt="Logo" className="company-logo-img" />
                                        ) : (
                                            <div className="text-blue-600 font-bold text-3xl">S</div>
                                        )}
                                    </div>
                                    <div className="company-info-text">
                                        <div className={`status-badge ${remainingAmount > 0 ? 'status-partial' : 'status-paid'}`}>
                                            {remainingAmount > 0 ? 'باقی‌مانده دارد' : 'تسویه شده'}
                                        </div>
                                        <h1>{companySettings?.name || "نام شرکت شما"}</h1>
                                        <div className="company-info-subtitle">
                                            {companySettings?.phone && <span>{companySettings.phone} 📞</span>}
                                        </div>
                                    </div>
                                </div>

                                <div className="invoice-meta">
                                    <div className="meta-item">
                                        <span className="meta-label">شماره فاکتور</span>
                                        <span className="meta-value bg-slate-100 text-slate-700 px-3 py-1 rounded-md">#{saleData.sale.id}</span>
                                    </div>
                                    <div className="meta-item">
                                        <span className="meta-label">تاریخ صدور</span>
                                        <span className="meta-value">{formatDate(saleData.sale.date)}</span>
                                    </div>
                                    <div className="meta-item">
                                        <span className="meta-label">خریدار</span>
                                        <span className="meta-value text-blue-600 bg-blue-50 px-3 py-1 rounded-md">{customer.full_name}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="info-grid">
                                <div className="info-card">
                                    <h3>اطلاعات مشتری (خریدار)</h3>
                                    <div className="info-card-content">
                                        <div className="info-main-text">{customer.full_name}</div>
                                        <div className="info-sub-text">
                                            {customer.phone && <span>تماس: {customer.phone}</span>}
                                            {customer.address && <span>آدرس: {customer.address}</span>}
                                        </div>
                                    </div>
                                </div>
                                <div className="info-card">
                                    <h3>فروشنده (شرکت شما)</h3>
                                    <div className="info-card-content">
                                        <div className="info-main-text">{companySettings?.name || "شرکت مرکزی"}</div>
                                        <div className="info-sub-text">
                                            {companySettings?.address || "آدرس شرکت در تنظیمات ثبت نشده است."}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="table-container">
                                <table className="modern-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: "60px" }} className="text-center">#</th>
                                            <th>شرح کالا / خدمات</th>
                                            <th style={{ width: "100px" }} className="text-center">واحد</th>
                                            <th style={{ width: "100px" }} className="text-center">تعداد</th>
                                            <th style={{ width: "140px" }} className="text-left">فی (واحد)</th>
                                            <th style={{ width: "160px" }} className="text-left">مبلغ کل</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {saleData.items.map((item, index) => (
                                            <tr key={item.id}>
                                                <td className="text-center text-slate-400 font-bold text-sm">{index + 1}</td>
                                                <td className="product-name">{getProductName(item.product_id)}</td>
                                                <td className="text-center text-slate-500 bg-slate-50/50 rounded-lg mx-2">{getUnitName(item.unit_id)}</td>
                                                <td className="text-center font-bold text-slate-700">{formatNumber(item.amount)}</td>
                                                <td className="text-left font-medium text-slate-600">{formatNumber(item.per_price)}</td>
                                                <td className="text-left row-total">{formatNumber(item.total)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {saleData.additional_costs && saleData.additional_costs.length > 0 && (
                                <div className="table-container" style={{ marginBottom: 24 }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>هزینه‌های اضافی</div>
                                    <table className="modern-table">
                                        <thead>
                                            <tr>
                                                <th style={{ width: '60px' }} className="text-center">#</th>
                                                <th>شرح</th>
                                                <th style={{ width: '160px' }} className="text-left">مبلغ</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {saleData.additional_costs.map((cost, idx) => (
                                                <tr key={cost.id ?? idx}>
                                                    <td className="text-center text-slate-400 font-bold text-sm">{idx + 1}</td>
                                                    <td className="product-name">{cost.name}</td>
                                                    <td className="text-left row-total">{formatNumber(cost.amount)}</td>
                                                </tr>
                                            ))}
                                            <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                                                <td colSpan={2} className="text-left" style={{ padding: '16px 24px' }}>جمع هزینه‌های اضافی</td>
                                                <td className="text-left row-total" style={{ padding: '16px 24px' }}>
                                                    {formatNumber(saleData.additional_costs.reduce((s, c) => s + c.amount, 0))}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <div className="summary-section">
                                <div className="footer-notes">
                                    {saleData.sale.notes && (
                                        <>
                                            <div className="notes-title">توضیحات:</div>
                                            <div className="notes-body">{saleData.sale.notes}</div>
                                        </>
                                    )}
                                </div>

                                <div className="total-card print-break-inside">
                                    <div className="total-row">
                                        <span className="total-label">جمع کل فاکتور</span>
                                        <span className="total-value">{formatNumber(saleData.sale.total_amount)}</span>
                                    </div>
                                    <div className="total-row">
                                        <span className="total-label">پرداخت شده</span>
                                        <span className="total-value text-emerald-400">{formatNumber(saleData.sale.paid_amount)}</span>
                                    </div>
                                    {remainingAmount > 0 ? (
                                        <div className="total-row">
                                            <span className="total-label">مانده حساب</span>
                                            <span className="total-value text-orange-400">{formatNumber(remainingAmount)}</span>
                                        </div>
                                    ) : (
                                        <div className="total-row">
                                            <span className="total-label">وضعیت</span>
                                            <span className="total-value text-emerald-400 text-sm">تسویه کامل</span>
                                        </div>
                                    )}
                                    <div className="total-row highlight">
                                        <span className="grand-total-label">قابل پرداخت</span>
                                        <span className="grand-total-value">
                                            {formatNumber(saleData.sale.total_amount)}
                                            <span className="text-sm font-light text-blue-400 pr-1">ریال</span>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="footer-bottom">
                            <div className="signature-area">
                                <div className="signature-box">
                                    <div className="signature-line"></div>
                                    <div className="signature-text">مهر و امضای فروشنده</div>
                                </div>
                                <div className="signature-box">
                                    <div className="signature-line"></div>
                                    <div className="signature-text">مهر و امضای خریدار</div>
                                </div>
                            </div>

                            <div className="qr-section">
                                <canvas ref={qrCodeCanvasRef} style={{ display: 'none' }} />
                                {qrCodeDataUrl && (
                                    <img src={qrCodeDataUrl} alt="QR" className="qr-img" />
                                )}
                                <div className="qr-info">
                                    <span className="qr-title">اصالت سنجی</span>
                                    <span className="qr-subtitle">اسکن کنید</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

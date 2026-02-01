import { useRef, useState, useEffect } from "react";
import { PurchaseWithItems, PurchaseItem } from "../utils/purchase";
import { Supplier } from "../utils/supplier";
import { Product } from "../utils/product";
import { Unit } from "../utils/unit";
import { CompanySettings } from "../utils/company";
import { georgianToPersian } from "../utils/date";
import * as QRCode from "qrcode";

interface PurchaseInvoiceProps {
    purchaseData: PurchaseWithItems;
    supplier: Supplier;
    products: Product[];
    units: Unit[];
    companySettings?: CompanySettings | null;
    onClose?: () => void;
}

export default function PurchaseInvoice({
    purchaseData,
    supplier,
    products,
    units,
    companySettings,
    onClose,
}: PurchaseInvoiceProps) {
    const printRef = useRef<HTMLDivElement>(null);
    const qrCodeCanvasRef = useRef<HTMLCanvasElement>(null);
    const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>("");

    // Generate QR code on mount
    useEffect(() => {
        if (qrCodeCanvasRef.current) {
            const qrData = JSON.stringify({
                type: "purchase_invoice",
                id: purchaseData.purchase.id,
                date: purchaseData.purchase.date,
                supplier: supplier.full_name,
                total: purchaseData.purchase.total_amount,
            });

            QRCode.toCanvas(qrCodeCanvasRef.current, qrData, {
                width: 200,
                margin: 2,
                color: {
                    dark: '#065f46',
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
    }, [purchaseData, supplier]);

    const handlePrint = () => {
        window.print();
    };

    const formatDate = (dateString: string) => {
        if (!dateString) return "";
        const normalized = dateString.includes("T") ? dateString.slice(0, 10) : dateString.trim();
        return georgianToPersian(normalized);
    };

    const formatNumber = (num: number) => {
        return new Intl.NumberFormat("en-US").format(num);
    };

    const getProductName = (productId: number) => {
        const product = products.find((p: Product) => p.id === productId);
        return product?.name || "نامشخص";
    };

    const getUnitName = (unitId: number) => {
        const unit = units.find((u: Unit) => u.id === unitId);
        return unit?.name || "نامشخص";
    };

    return (
        <>
            <style>{`
                @import url('/fonts/400.css');
                .invoice-root {
                    font-family: 'IRANSans', Tahoma, 'Segoe UI', 'Arabic UI Display', Arial, sans-serif;
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
                    unicode-bidi: embed;
                    border-radius: 4px;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }

                .invoice-header-bg {
                    height: 12px;
                    background: linear-gradient(90deg, #047857 0%, #10b981 100%);
                    width: 100%;
                }

                .invoice-content {
                    padding: 40px 50px;
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    direction: rtl;
                    unicode-bidi: embed;
                    text-align: right;
                }

                .invoice-title-badge {
                    display: inline-flex;
                    align-items: center;
                    background: #ecfdf5;
                    color: #047857;
                    padding: 8px 20px;
                    border-radius: 12px;
                    font-size: 14px;
                    font-weight: 800;
                    letter-spacing: 0.02em;
                    margin-bottom: 20px;
                    border: 1px solid #d1fae5;
                }

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
                    unicode-bidi: embed;
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
                    direction: rtl;
                    unicode-bidi: embed;
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

                .modern-table td.row-total {
                    direction: ltr;
                    text-align: left;
                }
                
                .row-total {
                    font-weight: 700;
                    color: #059669;
                    direction: ltr;
                    unicode-bidi: embed;
                }

                .additional-costs-section {
                    margin-bottom: 32px;
                }

                .additional-costs-header {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 14px;
                }

                .additional-costs-icon {
                    width: 28px;
                    height: 28px;
                    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                    color: white;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 16px;
                    font-weight: 800;
                    line-height: 1;
                }

                .additional-costs-title {
                    font-size: 14px;
                    font-weight: 700;
                    color: #64748b;
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                    margin: 0;
                }

                .additional-costs-card {
                    background: #fffbeb;
                    border: 1px solid #fde68a;
                    border-radius: 16px;
                    overflow: hidden;
                    box-shadow: 0 2px 8px rgba(245, 158, 11, 0.08);
                }

                .additional-costs-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 14px;
                }

                .additional-costs-table thead tr {
                    background: #fef3c7;
                    border-bottom: 1px solid #fde68a;
                }

                .additional-costs-table th {
                    padding: 14px 20px;
                    text-align: right;
                    font-weight: 700;
                    color: #92400e;
                    font-size: 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                }

                .ac-col-num { width: 56px; text-align: center; }
                .ac-col-desc { min-width: 0; }
                .ac-col-amount { width: 140px; text-align: left; }

                .additional-costs-table .ac-row td {
                    padding: 14px 20px;
                    border-bottom: 1px solid #fef3c7;
                    color: #334155;
                    vertical-align: middle;
                    direction: rtl;
                    unicode-bidi: embed;
                    text-align: right;
                }

                .additional-costs-table .ac-row:last-child td {
                    border-bottom: none;
                }

                .additional-costs-table .ac-desc {
                    font-weight: 600;
                    color: #1e293b;
                }

                .additional-costs-table .ac-amount {
                    font-weight: 700;
                    color: #059669;
                    direction: ltr;
                    unicode-bidi: embed;
                    text-align: left;
                }

                .additional-costs-table tfoot .ac-total-row {
                    background: #fef3c7;
                    border-top: 2px solid #f59e0b;
                }

                .additional-costs-table tfoot .ac-total-row td {
                    padding: 16px 20px;
                    font-weight: 800;
                    font-size: 15px;
                    color: #0f172a;
                }

                .ac-total-label {
                    text-align: right;
                }

                .ac-total-value {
                    text-align: left;
                    color: #047857;
                    direction: ltr;
                    unicode-bidi: embed;
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
                
                .total-row:last-child {
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
                    color: #34d399;
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
                    body * { visibility: hidden; }
                    .invoice-print-area,
                    .invoice-print-area * { visibility: visible; }
                    .invoice-print-area {
                        position: absolute !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 100% !important;
                        min-height: 100vh !important;
                        background: white !important;
                        box-shadow: none !important;
                        margin: 0 !important;
                        border-radius: 0 !important;
                    }
                    .invoice-card { 
                        box-shadow: none; 
                        margin: 0 auto; 
                        width: 210mm;
                        min-height: auto;
                        border-radius: 0;
                        border: none;
                    }
                    .no-print { display: none !important; }
                    .print-break-inside { break-inside: avoid; }
                }
            `}</style>

            <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/80 backdrop-blur-md p-8 overflow-y-auto invoice-root" dir="rtl">
                <div className="max-w-[230mm] w-full mx-auto">
                    <div className="no-print flex flex-col md:flex-row justify-between items-center mb-6 gap-4 px-2">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                            </div>
                            <div>
                                <h2 className="text-white text-xl font-bold">پیش‌نمایش فاکتور</h2>
                                <p className="text-slate-400 text-sm">چاپ یا ذخیره به PDF از طریق دکمهٔ چاپ</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={handlePrint}
                                className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white rounded-xl shadow-lg font-bold flex items-center gap-2"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2h-2a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                                چاپ فاکتور
                            </button>
                            {onClose && (
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-xl transition-all font-bold"
                                >
                                    بستن
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="invoice-print-area">
                    <div ref={printRef} className="invoice-card" dir="rtl">
                        <div className="invoice-header-bg"></div>

                        <div className="invoice-content">
                            <div className="company-header">
                                <div className="flex gap-6 items-center">
                                    <div className="company-logo-container">
                                        {companySettings?.logo ? (
                                            <img src={companySettings.logo} alt="Logo" className="company-logo-img" />
                                        ) : (
                                            <div className="text-emerald-600 font-bold text-3xl">S</div>
                                        )}
                                    </div>
                                    <div className="company-info-text">
                                        <div className="invoice-title-badge">فاکتور خرید رسمی</div>
                                        <h1>{companySettings?.name || "نام شرکت شما"}</h1>
                                        <div className="company-info-subtitle">
                                            {companySettings?.phone && <span>{companySettings.phone} 📞</span>}
                                        </div>
                                    </div>
                                </div>

                                <div className="invoice-meta">
                                    <div className="meta-item">
                                        <span className="meta-label">شماره فاکتور</span>
                                        <span className="meta-value bg-slate-100 text-slate-700 px-3 py-1 rounded-md">#{purchaseData.purchase.id}</span>
                                    </div>
                                    <div className="meta-item">
                                        <span className="meta-label">تاریخ صدور</span>
                                        <span className="meta-value">{formatDate(purchaseData.purchase.date)}</span>
                                    </div>
                                    <div className="meta-item">
                                        <span className="meta-label">وضعیت</span>
                                        <span className="meta-value text-emerald-600 bg-emerald-50 px-3 py-1 rounded-md">تکمیل شده</span>
                                    </div>
                                </div>
                            </div>

                            <div className="info-grid">
                                <div className="info-card">
                                    <h3>فروشنده (تامین کننده)</h3>
                                    <div className="info-card-content">
                                        <div className="info-main-text">{supplier.full_name}</div>
                                        <div className="info-sub-text">
                                            {supplier.phone && <span>تماس: {supplier.phone}</span>}
                                            {supplier.address && <span>آدرس: {supplier.address}</span>}
                                        </div>
                                    </div>
                                </div>
                                <div className="info-card">
                                    <h3>خریدار (شرکت شما)</h3>
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
                                        {purchaseData.items.map((item: PurchaseItem, index: number) => (
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

                            {purchaseData.additional_costs && purchaseData.additional_costs.length > 0 && (
                                <div className="additional-costs-section">
                                    <div className="additional-costs-header">
                                        <span className="additional-costs-icon">+</span>
                                        <h3 className="additional-costs-title">هزینه‌های اضافی</h3>
                                    </div>
                                    <div className="additional-costs-card">
                                        <table className="additional-costs-table">
                                            <thead>
                                                <tr>
                                                    <th className="ac-col-num">#</th>
                                                    <th className="ac-col-desc">شرح</th>
                                                    <th className="ac-col-amount">مبلغ</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {purchaseData.additional_costs.map((cost, idx) => (
                                                    <tr key={cost.id ?? idx} className="ac-row">
                                                        <td className="ac-col-num">{idx + 1}</td>
                                                        <td className="ac-col-desc ac-desc">{cost.name}</td>
                                                        <td className="ac-col-amount ac-amount">{formatNumber(cost.amount)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr className="ac-total-row">
                                                    <td colSpan={2} className="ac-total-label">جمع هزینه‌های اضافی</td>
                                                    <td className="ac-total-value">
                                                        {formatNumber(purchaseData.additional_costs.reduce((s, c) => s + c.amount, 0))}
                                                    </td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                </div>
                            )}

                            <div className="summary-section">
                                <div className="footer-notes">
                                    {purchaseData.purchase.notes && (
                                        <>
                                            <div className="notes-title">توضیحات:</div>
                                            <div className="notes-body">{purchaseData.purchase.notes}</div>
                                        </>
                                    )}
                                </div>

                                <div className="total-card print-break-inside">
                                    <div className="total-row">
                                        <span className="total-label">جمع کل</span>
                                        <span className="total-value">{formatNumber(purchaseData.purchase.total_amount)}</span>
                                    </div>
                                    <div className="total-row" style={{ opacity: 0.7 }}>
                                        <span className="total-label">مالیات و عوارض</span>
                                        <span className="total-value">0</span>
                                    </div>
                                    <div className="total-row">
                                        <span className="grand-total-label">مبلغ قابل پرداخت</span>
                                        <span className="grand-total-value">
                                            {formatNumber(purchaseData.purchase.total_amount)}
                                            <span className="text-sm font-light text-emerald-400 pr-1">ریال</span>
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
            </div>
        </>
    );
}

import { useRef, useState, useEffect } from "react";
import toast from "react-hot-toast";
import { SaleWithItems, SalePayment } from "../utils/sales";
import { Customer } from "../utils/customer";
import { Product } from "../utils/product";
import { Unit } from "../utils/unit";
import { CompanySettings } from "../utils/company";
import { georgianToPersian } from "../utils/date";
import * as QRCode from "qrcode";
import {
    printSaleReceiptThermal,
    getStoredThermalPrinter,
    setStoredThermalPrinter,
    type ThermalReceiptPayload,
} from "../utils/thermalPrint";

interface SaleInvoiceProps {
    saleData: SaleWithItems;
    customer: Customer;
    products: Product[];
    units: Unit[];
    payments?: SalePayment[];
    companySettings?: CompanySettings | null;
    currencyName?: string;
    onClose?: () => void;
}

export default function SaleInvoice({
    saleData,
    customer,
    products,
    units,
    payments: _payments,
    companySettings,
    currencyName,
    onClose,
}: SaleInvoiceProps) {
    const printRef = useRef<HTMLDivElement>(null);
    const qrCodeCanvasRef = useRef<HTMLCanvasElement>(null);
    const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>("");
    const [showPrinterModal, setShowPrinterModal] = useState(false);
    const [printerIp, setPrinterIp] = useState("");
    const [printerPort, setPrinterPort] = useState("9100");
    const [savePrinterForNextTime, setSavePrinterForNextTime] = useState(true);
    const [thermalPrinting, setThermalPrinting] = useState(false);

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

    const handlePrint = () => {
        window.print();
    };

    function buildThermalPayload(): ThermalReceiptPayload {
        const productItems = (saleData.items || []).map((item) => ({
            name: `${getProductName(item.product_id)} (${getUnitName(item.unit_id)})`,
            quantity: item.amount,
            unit_price: item.per_price,
            line_total: item.total,
        }));
        const serviceItems = (saleData.service_items || []).map((si) => ({
            name: si.name,
            quantity: si.quantity,
            unit_price: si.price,
            line_total: si.total,
        }));
        return {
            company_name: companySettings?.name ?? null,
            sale_id: saleData.sale.id,
            sale_date: saleData.sale.date,
            total_amount: saleData.sale.total_amount,
            paid_amount: saleData.sale.paid_amount,
            order_discount_amount: saleData.sale.order_discount_amount ?? 0,
            notes: saleData.sale.notes ?? null,
            customer_name: customer.full_name,
            items: [...productItems, ...serviceItems],
            currency_label: currencyName ?? "",
        };
    }

    async function handleThermalPrint(ip?: string, port?: number) {
        const useIp = ip?.trim() || printerIp.trim();
        const usePort = port ?? (printerPort ? parseInt(printerPort, 10) : 9100);
        if (!useIp) {
            toast.error("آدرس IP چاپگر را وارد کنید");
            return;
        }
        setThermalPrinting(true);
        try {
            const payload = buildThermalPayload();
            await printSaleReceiptThermal(payload, useIp, isNaN(usePort) ? 9100 : usePort);
            toast.success("چاپ حرارتی با موفقیت ارسال شد");
            if (showPrinterModal && savePrinterForNextTime) {
                setStoredThermalPrinter(useIp, isNaN(usePort) ? 9100 : usePort);
            }
            setShowPrinterModal(false);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error(msg || "خطا در اتصال به چاپگر");
        } finally {
            setThermalPrinting(false);
        }
    }

    function openPrinterConfig() {
        const stored = getStoredThermalPrinter();
        setPrinterIp(stored?.ip ?? "");
        setPrinterPort(stored ? String(stored.port) : "9100");
        setSavePrinterForNextTime(true);
        setShowPrinterModal(true);
    }

    async function onThermalPrintClick() {
        const stored = getStoredThermalPrinter();
        if (stored) {
            await handleThermalPrint(stored.ip, stored.port);
        } else {
            setPrinterIp("");
            setPrinterPort("9100");
            setSavePrinterForNextTime(true);
            setShowPrinterModal(true);
        }
    }

    const formatDate = (dateString: string) => {
        if (!dateString) return "";
        const normalized = dateString.includes("T") ? dateString.slice(0, 10) : dateString.trim();
        return georgianToPersian(normalized);
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

    const remainingAmount = saleData.sale.total_amount - saleData.sale.paid_amount;
    const currencyLabel = currencyName ? ` ${currencyName}` : "";

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
                    min-height: auto;
                    margin: 16px auto;
                    padding: 0;
                    box-shadow: 0 8px 24px -6px rgba(0, 0, 0, 0.12);
                    position: relative;
                    direction: rtl;
                    unicode-bidi: embed;
                    border-radius: 4px;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }

                .invoice-header-bg {
                    height: 6px;
                    background: linear-gradient(90deg, #1d4ed8 0%, #3b82f6 100%);
                    width: 100%;
                }

                .invoice-content {
                    padding: 16px 20px;
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
                    background: #eff6ff;
                    color: #1d4ed8;
                    padding: 4px 10px;
                    border-radius: 8px;
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0.02em;
                    margin-bottom: 8px;
                    border: 1px solid #bfdbfe;
                }

                .company-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 20px;
                    border-bottom: 1px solid #f1f5f9;
                    padding-bottom: 16px;
                }

                .company-logo-container {
                    width: 48px;
                    height: 48px;
                    background: #ffffff;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                    border: 1px solid #e2e8f0;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
                }

                .company-logo-img {
                    max-width: 75%;
                    max-height: 75%;
                    object-fit: contain;
                }

                .company-info-text h1 {
                    font-size: 18px;
                    font-weight: 800;
                    color: #0f172a;
                    margin: 0 0 4px 0;
                    letter-spacing: -0.02em;
                }

                .company-info-subtitle {
                    color: #64748b;
                    font-weight: 500;
                    font-size: 11px;
                }

                .info-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 20px;
                    margin-bottom: 20px;
                }

                .info-card h3 {
                    font-size: 10px;
                    font-weight: 700;
                    color: #94a3b8;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 8px;
                }

                .info-card-content {
                    background: #f8fafc;
                    border-radius: 10px;
                    padding: 12px;
                    border: 1px solid #e2e8f0;
                }

                .info-main-text {
                    font-size: 13px;
                    font-weight: 700;
                    color: #1e293b;
                    margin-bottom: 6px;
                }

                .info-sub-text {
                    font-size: 11px;
                    color: #64748b;
                    line-height: 1.4;
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .invoice-meta {
                    text-align: left;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .meta-item {
                    display: flex;
                    justify-content: flex-end;
                    align-items: center;
                    gap: 8px;
                }

                .meta-label {
                    color: #64748b;
                    font-size: 11px;
                    font-weight: 500;
                }

                .meta-value {
                    color: #0f172a;
                    font-weight: 700;
                    font-size: 12px;
                    direction: ltr;
                    unicode-bidi: embed;
                }

                .table-container {
                    margin-bottom: 16px;
                    border-radius: 10px;
                    overflow: hidden;
                    border: 1px solid #e2e8f0;
                }

                .modern-table {
                    width: 100%;
                    border-collapse: collapse;
                }

                .modern-table th {
                    background: #f8fafc;
                    padding: 8px 12px;
                    text-align: right;
                    font-size: 10px;
                    font-weight: 700;
                    color: #475569;
                    border-bottom: 1px solid #e2e8f0;
                    white-space: nowrap;
                    direction: rtl;
                    unicode-bidi: embed;
                }

                .modern-table td {
                    padding: 8px 12px;
                    border-bottom: 1px solid #f1f5f9;
                    font-size: 11px;
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
                    font-size: 11px;
                }

                .modern-table td.row-total {
                    direction: ltr;
                    text-align: left;
                }
                
                .row-total {
                    font-weight: 700;
                    color: #2563eb;
                    direction: ltr;
                    unicode-bidi: embed;
                }

                .additional-costs-section {
                    margin-bottom: 16px;
                }

                .additional-costs-section .section-label {
                    font-size: 10px;
                    font-weight: 700;
                    color: #94a3b8;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 8px;
                }

                .summary-section {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-top: auto;
                    padding-top: 16px;
                }

                .footer-notes {
                    flex: 1;
                    max-width: 50%;
                    padding-left: 16px;
                }

                .notes-title {
                    font-size: 10px;
                    font-weight: 700;
                    color: #1e293b;
                    margin-bottom: 4px;
                }

                .notes-body {
                    font-size: 10px;
                    color: #64748b;
                    line-height: 1.5;
                    background: #fff;
                    border: 1px dashed #cbd5e1;
                    border-radius: 8px;
                    padding: 8px;
                }

                .total-card {
                    background: #0f172a;
                    color: white;
                    padding: 16px 20px;
                    border-radius: 12px;
                    width: 240px;
                    box-shadow: 0 8px 20px -6px rgba(15, 23, 42, 0.3);
                }

                .total-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                }
                
                .total-row:last-child {
                    margin-bottom: 0;
                    padding-top: 10px;
                    margin-top: 10px;
                    border-top: 1px solid rgba(255,255,255,0.15);
                }

                .total-label {
                    font-size: 11px;
                    color: #94a3b8;
                    font-weight: 500;
                }

                .total-value {
                    font-size: 12px;
                    font-weight: 600;
                    color: #f8fafc;
                    direction: ltr;
                }

                .grand-total-label {
                    font-size: 12px;
                    font-weight: 600;
                    color: #fff;
                }

                .grand-total-value {
                    font-size: 18px;
                    font-weight: 800;
                    color: #60a5fa;
                    direction: ltr;
                }

                .footer-bottom {
                    background: #f8fafc;
                    padding: 12px 20px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-top: 1px solid #e2e8f0;
                }
                
                .signature-area {
                    display: flex;
                    gap: 24px;
                }
                
                .signature-box {
                    text-align: center;
                }
                
                .signature-line {
                    width: 80px;
                    height: 1px;
                    background: #cbd5e1;
                    margin-bottom: 6px;
                }
                
                .signature-text {
                    font-size: 9px;
                    font-weight: 700;
                    color: #94a3b8;
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                }

                .qr-section {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    background: white;
                    padding: 6px;
                    border-radius: 8px;
                    border: 1px solid #e2e8f0;
                }

                .qr-img {
                    width: 40px;
                    height: 40px;
                    object-fit: contain;
                }

                .qr-info {
                    display: flex;
                    flex-direction: column;
                }

                .qr-title {
                    font-size: 10px;
                    font-weight: 800;
                    color: #0f172a;
                }
                
                .qr-subtitle {
                    font-size: 8px;
                    color: #64748b;
                    margin-top: 1px;
                }

                @media print {
                    .invoice-page-wrapper {
                        position: static !important;
                        background: white !important;
                        padding: 0 !important;
                        overflow: visible !important;
                    }
                    .invoice-page-wrapper .no-print { display: none !important; }
                    .invoice-print-area {
                        position: static !important;
                        width: 100% !important;
                        overflow: visible !important;
                        background: white !important;
                    }
                    .invoice-card { 
                        box-shadow: none; 
                        margin: 0 auto; 
                        width: 210mm;
                        min-height: auto !important;
                        overflow: visible !important;
                        border-radius: 0;
                        border: none;
                        page-break-after: auto;
                    }
                    .invoice-content { overflow: visible !important; }
                    .table-container { overflow: visible !important; page-break-inside: auto; }
                    .modern-table { page-break-inside: auto; }
                    .print-break-inside { break-inside: avoid; }
                }
            `}</style>

            <div className="invoice-page-wrapper min-h-screen bg-slate-100 dark:bg-gray-900 py-6 px-4 overflow-y-auto invoice-root" dir="rtl">
                <div className="max-w-[230mm] w-full mx-auto">
                    <div className="no-print flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
                        <div className="flex items-center gap-3 w-full sm:w-auto">
                            {onClose && (
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 border-2 border-gray-300 dark:border-gray-600 rounded-xl font-bold shadow-md transition-all"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                    </svg>
                                    بستن
                                </button>
                            )}
                            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200">فاکتور فروش</h2>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handlePrint}
                                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg transition-all"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2h-2a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                                چاپ فاکتور
                            </button>
                            <button
                                type="button"
                                onClick={onThermalPrintClick}
                                disabled={thermalPrinting}
                                className="flex items-center gap-2 px-5 py-2.5 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl font-bold shadow-lg transition-all"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                {thermalPrinting ? "در حال چاپ..." : "چاپ حرارتی"}
                            </button>
                            <button
                                type="button"
                                onClick={openPrinterConfig}
                                className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 underline"
                                title="تنظیم چاپگر حرارتی"
                            >
                                تنظیم چاپگر
                            </button>
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
                                            <div className="text-blue-600 font-bold text-3xl">S</div>
                                        )}
                                    </div>
                                    <div className="company-info-text">
                                        <div className="invoice-title-badge">فاکتور فروش رسمی</div>
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
                                        <span className="meta-label">وضعیت</span>
                                        <span className="meta-value text-blue-600 bg-blue-50 px-3 py-1 rounded-md">{remainingAmount > 0 ? "باقی‌مانده دارد" : "تکمیل شده"}</span>
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

                            {(() => {
                                const hasLineDiscount = saleData.items.some((i) => (i.discount_type === "percent" || i.discount_type === "fixed") && (i.discount_value ?? 0) > 0)
                                    || (saleData.service_items ?? []).some((s) => (s.discount_type === "percent" || s.discount_type === "fixed") && (s.discount_value ?? 0) > 0);
                                const subtotal = saleData.items.reduce((s, i) => s + i.total, 0) + (saleData.service_items ?? []).reduce((s, si) => s + si.total, 0);
                                const orderDisc = saleData.sale.order_discount_amount ?? 0;
                                return (
                                    <>
                            <div className="table-container">
                                <table className="modern-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: "60px" }} className="text-center">#</th>
                                            <th>شرح کالا / خدمات</th>
                                            <th style={{ width: "100px" }} className="text-center">واحد</th>
                                            <th style={{ width: "100px" }} className="text-center">تعداد</th>
                                            <th style={{ width: "140px" }} className="text-left">فی (واحد){currencyLabel}</th>
                                            {hasLineDiscount && <th style={{ width: "100px" }} className="text-left">تخفیف{currencyLabel}</th>}
                                            <th style={{ width: "160px" }} className="text-left">مبلغ کل{currencyLabel}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {saleData.items.map((item, index) => {
                                            const lineSub = item.per_price * item.amount;
                                            const lineDisc = (item.discount_type === "percent" || item.discount_type === "fixed") && (item.discount_value ?? 0) > 0
                                                ? (item.discount_type === "percent" ? (lineSub * Math.min(100, item.discount_value!) / 100) : Math.min(item.discount_value!, lineSub))
                                                : 0;
                                            return (
                                            <tr key={item.id}>
                                                <td className="text-center text-slate-400 font-bold text-sm">{index + 1}</td>
                                                <td className="product-name">{getProductName(item.product_id)}</td>
                                                <td className="text-center text-slate-500 bg-slate-50/50 rounded-lg mx-2">{getUnitName(item.unit_id)}</td>
                                                <td className="text-center font-bold text-slate-700">{formatNumber(item.amount)}</td>
                                                <td className="text-left font-medium text-slate-600">{formatNumber(item.per_price)}{currencyLabel}</td>
                                                {hasLineDiscount && <td className="text-left text-amber-600">{lineDisc > 0 ? `-${formatNumber(lineDisc)}` : "—"}</td>}
                                                <td className="text-left row-total">{formatNumber(item.total)}</td>
                                            </tr>
                                            );
                                        })}
                                        {(saleData.service_items ?? []).map((si, idx) => {
                                            const lineSub = si.price * si.quantity;
                                            const lineDisc = (si.discount_type === "percent" || si.discount_type === "fixed") && (si.discount_value ?? 0) > 0
                                                ? (si.discount_type === "percent" ? (lineSub * Math.min(100, si.discount_value!) / 100) : Math.min(si.discount_value!, lineSub))
                                                : 0;
                                            return (
                                            <tr key={`s-${si.id}`} style={{ background: "#f0fdf4" }}>
                                                <td className="text-center text-slate-400 font-bold text-sm">{saleData.items.length + idx + 1}</td>
                                                <td className="product-name">{si.name} (خدمت)</td>
                                                <td className="text-center text-slate-500 bg-slate-50/50 rounded-lg mx-2">—</td>
                                                <td className="text-center font-bold text-slate-700">{formatNumber(si.quantity)}</td>
                                                <td className="text-left font-medium text-slate-600">{formatNumber(si.price)}{currencyLabel}</td>
                                                {hasLineDiscount && <td className="text-left text-amber-600">{lineDisc > 0 ? `-${formatNumber(lineDisc)}` : "—"}</td>}
                                                <td className="text-left row-total">{formatNumber(si.total)}</td>
                                            </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {(subtotal > 0 || orderDisc > 0) && (
                                <div className="summary-section" style={{ marginTop: 8, padding: "8px 12px", background: "#f8fafc", borderRadius: 8 }}>
                                    <div className="total-row" style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                        <span>جمع جزء</span>
                                        <span>{formatNumber(subtotal)}{currencyLabel}</span>
                                    </div>
                                    {orderDisc > 0 && (
                                        <div className="total-row" style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, color: "#b45309" }}>
                                            <span>تخفیف کل فاکتور</span>
                                            <span>-{formatNumber(orderDisc)}{currencyLabel}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {saleData.additional_costs && saleData.additional_costs.length > 0 && (
                                <div className="additional-costs-section">
                                    <div className="section-label">هزینه‌های اضافی</div>
                                    <div className="table-container">
                                        <table className="modern-table">
                                            <thead>
                                                <tr>
                                                    <th style={{ width: "60px" }} className="text-center">#</th>
                                                    <th>شرح</th>
                                                    <th style={{ width: "160px" }} className="text-left">مبلغ{currencyLabel}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {saleData.additional_costs.map((cost, idx) => (
                                                    <tr key={cost.id ?? idx}>
                                                        <td className="text-center text-slate-400 font-bold text-sm">{idx + 1}</td>
                                                        <td className="product-name">{cost.name}</td>
                                                        <td className="text-left row-total">{formatNumber(cost.amount)}{currencyLabel}</td>
                                                    </tr>
                                                ))}
                                                <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
                                                    <td colSpan={2} className="text-right" style={{ padding: "8px 12px" }}>جمع هزینه‌های اضافی</td>
                                                    <td className="text-left row-total" style={{ padding: "8px 12px" }}>
                                                        {formatNumber(saleData.additional_costs.reduce((s, c) => s + c.amount, 0))}{currencyLabel}
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            </>
                                );
                            })()}

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
                                        <span className="total-label">جمع کل</span>
                                        <span className="total-value">{formatNumber(saleData.sale.total_amount)}{currencyLabel}</span>
                                    </div>
                                    <div className="total-row" style={{ opacity: 0.9 }}>
                                        <span className="total-label">پرداخت شده</span>
                                        <span className="total-value">{formatNumber(saleData.sale.paid_amount)}{currencyLabel}</span>
                                    </div>
                                    {remainingAmount > 0 && (
                                        <div className="total-row" style={{ opacity: 0.9 }}>
                                            <span className="total-label">مانده حساب</span>
                                            <span className="total-value">{formatNumber(remainingAmount)}{currencyLabel}</span>
                                        </div>
                                    )}
                                    <div className="total-row">
                                        <span className="grand-total-label">مبلغ قابل پرداخت</span>
                                        <span className="grand-total-value">
                                            {formatNumber(saleData.sale.total_amount)}{currencyLabel}
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

            {showPrinterModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" dir="rtl" onClick={() => !thermalPrinting && setShowPrinterModal(false)}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">تنظیم چاپگر حرارتی</h3>
                        <div className="space-y-3 mb-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">آدرس IP چاپگر *</label>
                                <input
                                    type="text"
                                    value={printerIp}
                                    onChange={(e) => setPrinterIp(e.target.value)}
                                    placeholder="192.168.1.100"
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">پورت (پیش‌فرض 9100)</label>
                                <input
                                    type="text"
                                    value={printerPort}
                                    onChange={(e) => setPrinterPort(e.target.value)}
                                    placeholder="9100"
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                                />
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={savePrinterForNextTime}
                                    onChange={(e) => setSavePrinterForNextTime(e.target.checked)}
                                    className="rounded border-gray-300"
                                />
                                <span className="text-sm text-gray-700 dark:text-gray-300">ذخیره برای دفعات بعد</span>
                            </label>
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button
                                type="button"
                                onClick={() => !thermalPrinting && setShowPrinterModal(false)}
                                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                            >
                                انصراف
                            </button>
                            <button
                                type="button"
                                onClick={() => handleThermalPrint()}
                                disabled={thermalPrinting || !printerIp.trim()}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium"
                            >
                                {thermalPrinting ? "در حال چاپ..." : "چاپ"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

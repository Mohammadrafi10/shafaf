import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { getStockByBatches, type StockBatchRow } from "../utils/sales";
import { formatPersianDate } from "../utils/date";
import { exportStockReportToExcel } from "../utils/reportExport";
import PageHeader from "./common/PageHeader";
import Table from "./common/Table";

interface StockReportProps {
    onBack: () => void;
}

type RowWithId = StockBatchRow & { id: number };

const translations = {
    title: "گزارش موجودی (بر اساس دسته)",
    backToDashboard: "بازگشت به داشبورد",
    productName: "نام محصول",
    batchNumber: "شماره دسته",
    purchaseDate: "تاریخ خرید",
    expiryDate: "تاریخ انقضا",
    unit: "واحد",
    amount: "مقدار اولیه",
    remaining: "موجودی باقی‌مانده",
    purchasePrice: "قیمت خرید (واحد)",
    totalPurchaseCost: "مجموع هزینه خرید دسته",
    costPrice: "قیمت تمام شده",
    retailPrice: "قیمت خرده‌فروشی",
    stockValue: "ارزش موجودی",
    potentialRevenue: "درآمد بالقوه (خرده)",
    potentialProfit: "سود بالقوه",
    marginPercent: "درصد سود",
    noData: "هیچ موجودی دسته‌ای ثبت نشده است.",
    loading: "در حال بارگذاری...",
    totalStockValue: "مجموع ارزش موجودی",
    totalPotentialRevenue: "مجموع درآمد بالقوه",
    totalPotentialProfit: "مجموع سود بالقوه",
    lowStock: "موجودی کم",
    exportExcel: "خروجی Excel",
};

export default function StockReport({ onBack }: StockReportProps) {
    const [rows, setRows] = useState<RowWithId[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(25);

    const loadData = async () => {
        setLoading(true);
        try {
            const data = await getStockByBatches();
            setRows(data.map((r) => ({ ...r, id: r.purchase_item_id })));
        } catch (e) {
            console.error("Failed to load stock:", e);
            setRows([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const totalItems = rows.length;
    const paginatedRows = rows.slice((page - 1) * perPage, page * perPage);
    const totalStockValue = rows.reduce((s, r) => s + r.stock_value, 0);
    const totalPotentialRevenue = rows.reduce((s, r) => s + r.potential_revenue_retail, 0);
    const totalPotentialProfit = rows.reduce((s, r) => s + r.potential_profit, 0);

    const columns = [
        {
            key: "product_name" as const,
            label: translations.productName,
            sortable: false,
            render: (r: RowWithId) => (
                <span className="font-medium text-gray-900 dark:text-white">{r.product_name}</span>
            ),
        },
        {
            key: "batch_number" as const,
            label: translations.batchNumber,
            sortable: false,
            render: (r: RowWithId) => (
                <span className="font-mono text-gray-700 dark:text-gray-300">{r.batch_number || "—"}</span>
            ),
        },
        {
            key: "purchase_date" as const,
            label: translations.purchaseDate,
            sortable: false,
            render: (r: RowWithId) => (
                <span className="text-gray-700 dark:text-gray-300">{formatPersianDate(r.purchase_date)}</span>
            ),
        },
        {
            key: "expiry_date" as const,
            label: translations.expiryDate,
            sortable: false,
            render: (r: RowWithId) => (
                <span className="text-gray-600 dark:text-gray-400">
                    {r.expiry_date ? formatPersianDate(r.expiry_date) : "—"}
                </span>
            ),
        },
        {
            key: "unit_name" as const,
            label: translations.unit,
            sortable: false,
            render: (r: RowWithId) => (
                <span className="text-gray-700 dark:text-gray-300">{r.unit_name}</span>
            ),
        },
        {
            key: "amount" as const,
            label: translations.amount,
            sortable: false,
            render: (r: RowWithId) => (
                <span className="text-gray-700 dark:text-gray-300" dir="ltr">
                    {Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
                </span>
            ),
        },
        {
            key: "remaining_quantity" as const,
            label: translations.remaining,
            sortable: false,
            render: (r: RowWithId) => {
                const isLow = r.amount > 0 && r.remaining_quantity < r.amount * 0.1;
                return (
                    <span
                        className={`font-semibold ${isLow ? "text-amber-600 dark:text-amber-400" : "text-green-700 dark:text-green-400"}`}
                        dir="ltr"
                        title={isLow ? translations.lowStock : undefined}
                    >
                        {Number(r.remaining_quantity).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
                        {isLow && " •"}
                    </span>
                );
            },
        },
        {
            key: "per_price" as const,
            label: translations.purchasePrice,
            sortable: false,
            render: (r: RowWithId) => (
                <span className="text-gray-700 dark:text-gray-300" dir="ltr">
                    {Number(r.per_price).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </span>
            ),
        },
        {
            key: "total_purchase_cost" as const,
            label: translations.totalPurchaseCost,
            sortable: false,
            render: (r: RowWithId) => (
                <span className="font-medium text-gray-900 dark:text-white" dir="ltr">
                    {Number(r.total_purchase_cost).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </span>
            ),
        },
        {
            key: "cost_price" as const,
            label: translations.costPrice,
            sortable: false,
            render: (r: RowWithId) => (
                <span className="text-gray-700 dark:text-gray-300" dir="ltr">
                    {Number(r.cost_price).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </span>
            ),
        },
        {
            key: "retail_price" as const,
            label: translations.retailPrice,
            sortable: false,
            render: (r: RowWithId) => (
                <span className="text-gray-700 dark:text-gray-300" dir="ltr">
                    {(r.retail_price ?? r.per_price).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </span>
            ),
        },
        {
            key: "stock_value" as const,
            label: translations.stockValue,
            sortable: false,
            render: (r: RowWithId) => (
                <span className="font-medium text-gray-900 dark:text-white" dir="ltr">
                    {Number(r.stock_value).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </span>
            ),
        },
        {
            key: "potential_revenue_retail" as const,
            label: translations.potentialRevenue,
            sortable: false,
            render: (r: RowWithId) => (
                <span className="text-gray-700 dark:text-gray-300" dir="ltr">
                    {Number(r.potential_revenue_retail).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </span>
            ),
        },
        {
            key: "potential_profit" as const,
            label: translations.potentialProfit,
            sortable: false,
            render: (r: RowWithId) => (
                <span className="font-medium text-emerald-700 dark:text-emerald-400" dir="ltr">
                    {Number(r.potential_profit).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </span>
            ),
        },
        {
            key: "margin_percent" as const,
            label: translations.marginPercent,
            sortable: false,
            render: (r: RowWithId) => (
                <span className="text-gray-700 dark:text-gray-300" dir="ltr">
                    {Number(r.margin_percent).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}٪
                </span>
            ),
        },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 relative overflow-hidden" dir="rtl">
            <div className="relative max-w-7xl mx-auto p-6 z-10">
                <PageHeader
                    title={translations.title}
                    onBack={onBack}
                    backLabel={translations.backToDashboard}
                    actions={
                        rows.length > 0
                            ? [
                                  {
                                      label: translations.exportExcel,
                                      onClick: () => {
                                          try {
                                              exportStockReportToExcel(rows, {
                                                  totalStockValue,
                                                  totalPotentialRevenue,
                                                  totalPotentialProfit,
                                              });
                                              toast.success("خروجی با موفقیت ذخیره شد");
                                          } catch (e) {
                                              console.error("Export failed:", e);
                                              toast.error("خطا در خروجی گرفتن");
                                          }
                                      },
                                      variant: "secondary" as const,
                                  },
                              ]
                            : []
                    }
                />

                {!loading && rows.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        className="mt-6 mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4"
                    >
                        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 backdrop-blur p-4 shadow-sm">
                            <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-1">{translations.totalStockValue}</p>
                            <p className="text-xl font-bold text-gray-900 dark:text-white" dir="ltr">
                                {totalStockValue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                            </p>
                        </div>
                        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 backdrop-blur p-4 shadow-sm">
                            <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-1">{translations.totalPotentialRevenue}</p>
                            <p className="text-xl font-bold text-gray-900 dark:text-white" dir="ltr">
                                {totalPotentialRevenue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                            </p>
                        </div>
                        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/20 backdrop-blur p-4 shadow-sm">
                            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 mb-1">{translations.totalPotentialProfit}</p>
                            <p className="text-xl font-bold text-emerald-800 dark:text-emerald-300" dir="ltr">
                                {totalPotentialProfit.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                            </p>
                        </div>
                    </motion.div>
                )}

                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="mt-6"
                >
                    <Table
                        data={paginatedRows}
                        columns={columns}
                        total={totalItems}
                        page={page}
                        perPage={perPage}
                        onPageChange={setPage}
                        onPerPageChange={(n) => { setPerPage(n); setPage(1); }}
                        loading={loading}
                    />
                    {!loading && rows.length === 0 && (
                        <p className="text-center text-gray-500 dark:text-gray-400 py-8">{translations.noData}</p>
                    )}
                </motion.div>
            </div>
        </div>
    );
}

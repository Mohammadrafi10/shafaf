import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { getStockByBatches, type StockBatchRow } from "../utils/sales";
import { formatPersianDate } from "../utils/date";
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
    noData: "هیچ موجودی دسته‌ای ثبت نشده است.",
    loading: "در حال بارگذاری...",
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
            render: (r: RowWithId) => (
                <span className="font-semibold text-green-700 dark:text-green-400" dir="ltr">
                    {Number(r.remaining_quantity).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
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
                />
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

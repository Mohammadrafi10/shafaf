import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
    initPurchasePaymentsTable,
    createPurchasePayment,
    getPurchasePayments,
    getPurchasePaymentsByPurchase,
    updatePurchasePayment,
    deletePurchasePayment,
    type PurchasePayment,
} from "../utils/purchase_payment";
import { getPurchases, type Purchase } from "../utils/purchase";
import { getCurrencies, type Currency } from "../utils/currency";
import { getSuppliers, type Supplier } from "../utils/supplier";
import { getAccounts, type Account } from "../utils/account";
import { isDatabaseOpen, openDatabase } from "../utils/db";
import Footer from "./Footer";
import PersianDatePicker from "./PersianDatePicker";
import { formatPersianDate, getCurrentPersianDate, persianToGeorgian } from "../utils/date";
import Table from "./common/Table";
import PageHeader from "./common/PageHeader";
import { Search } from "lucide-react";

// Dari translations
const translations = {
    title: "بیلانس تمویل کننده ها",
    addNew: "ثبت پرداخت جدید",
    edit: "ویرایش",
    delete: "حذف",
    cancel: "لغو",
    save: "ذخیره",
    purchase: "خریداری",
    amount: "مقدار",
    currency: "ارز",
    rate: "نرخ",
    total: "مجموع",
    date: "تاریخ",
    notes: "یادداشت",
    actions: "عملیات",
    purchaseTotal: "مبلغ کل خریداری",
    paidAmount: "پرداخت شده",
    remainingAmount: "باقیمانده",
    noPayments: "هیچ پرداختی ثبت نشده است",
    confirmDelete: "آیا از حذف این پرداخت اطمینان دارید؟",
    backToDashboard: "بازگشت به داشبورد",
    success: {
        created: "پرداخت با موفقیت ثبت شد",
        updated: "پرداخت با موفقیت بروزرسانی شد",
        deleted: "پرداخت با موفقیت حذف شد",
    },
    errors: {
        create: "خطا در ثبت پرداخت",
        update: "خطا در بروزرسانی پرداخت",
        delete: "خطا در حذف پرداخت",
        fetch: "خطا در دریافت لیست پرداخت‌ها",
        purchaseRequired: "انتخاب خریداری الزامی است",
        amountRequired: "مقدار الزامی است",
        currencyRequired: "انتخاب ارز الزامی است",
        dateRequired: "تاریخ الزامی است",
    },
    placeholders: {
        purchase: "خریداری را انتخاب کنید",
        amount: "مقدار را وارد کنید",
        rate: "نرخ ارز",
        date: "تاریخ را انتخاب کنید",
        notes: "یادداشت (اختیاری)",
    },
};

interface PurchasePaymentManagementProps {
    onBack?: () => void;
}

export default function PurchasePaymentManagement({ onBack }: PurchasePaymentManagementProps) {
    const [payments, setPayments] = useState<PurchasePayment[]>([]);
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [purchasePaymentsMap, setPurchasePaymentsMap] = useState<Record<number, PurchasePayment[]>>({});
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingPayment, setEditingPayment] = useState<PurchasePayment | null>(null);
    const [formData, setFormData] = useState({
        purchase_id: "",
        account_id: "",
        amount: "",
        currency: "",
        rate: "1",
        total: "",
        date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
        notes: "",
    });

    // Pagination & Search
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(10);
    const [totalItems, setTotalItems] = useState(0);
    const [search, setSearch] = useState("");
    const [sortBy, setSortBy] = useState("date");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

    useEffect(() => {
        loadData();
    }, [page, perPage, search, sortBy, sortOrder]);

    const loadData = async () => {
        try {
            setLoading(true);
            const dbOpen = await isDatabaseOpen();
            if (!dbOpen) {
                await openDatabase("db");
            }

            try {
                await initPurchasePaymentsTable();
            } catch (err) {
                console.log("Table initialization:", err);
            }

            const [paymentsResponse, purchasesResponse, suppliersResponse, currenciesData, accountsData] = await Promise.all([
                getPurchasePayments(page, perPage, search, sortBy, sortOrder),
                getPurchases(1, 10000), // Get all purchases
                getSuppliers(1, 10000), // Get all suppliers
                getCurrencies(),
                getAccounts(),
            ]);

            setPayments(paymentsResponse.items);
            setTotalItems(paymentsResponse.total);
            setPurchases(purchasesResponse.items);
            setSuppliers(suppliersResponse.items);
            setCurrencies(currenciesData);
            setAccounts(accountsData);

            // Load all payments grouped by purchase to calculate remaining amounts
            const paymentsMap: Record<number, PurchasePayment[]> = {};
            await Promise.all(
                purchasesResponse.items.map(async (purchase) => {
                    try {
                        const purchasePayments = await getPurchasePaymentsByPurchase(purchase.id);
                        paymentsMap[purchase.id] = purchasePayments;
                    } catch (error) {
                        paymentsMap[purchase.id] = [];
                    }
                })
            );
            setPurchasePaymentsMap(paymentsMap);
        } catch (error: any) {
            toast.error(translations.errors.fetch);
            console.error("Error loading data:", error);
        } finally {
            setLoading(false);
        }
    };

    const calculateTotal = () => {
        const amount = parseFloat(formData.amount) || 0;
        const rate = parseFloat(formData.rate) || 1;
        return amount * rate;
    };

    useEffect(() => {
        const total = calculateTotal();
        setFormData(prev => ({ ...prev, total: total.toFixed(2) }));
    }, [formData.amount, formData.rate]);

    const handleOpenModal = (payment?: PurchasePayment) => {
        if (payment) {
            setEditingPayment(payment);
            setFormData({
                purchase_id: payment.purchase_id.toString(),
                account_id: payment.account_id?.toString() || "",
                amount: payment.amount.toString(),
                currency: payment.currency,
                rate: payment.rate.toString(),
                total: payment.total.toString(),
                date: payment.date,
                notes: payment.notes || "",
            });
        } else {
            setEditingPayment(null);
            setFormData({
                purchase_id: "",
                account_id: "",
                amount: "",
                currency: currencies[0]?.name || "",
                rate: "1",
                total: "",
                date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
                notes: "",
            });
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingPayment(null);
        setFormData({
            purchase_id: "",
            account_id: "",
            amount: "",
            currency: "",
            rate: "1",
            total: "",
            date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
            notes: "",
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.purchase_id) {
            toast.error(translations.errors.purchaseRequired);
            return;
        }

        if (!formData.amount || parseFloat(formData.amount) <= 0) {
            toast.error(translations.errors.amountRequired);
            return;
        }

        if (!formData.currency) {
            toast.error(translations.errors.currencyRequired);
            return;
        }

        if (!formData.date) {
            toast.error(translations.errors.dateRequired);
            return;
        }

        const amount = parseFloat(formData.amount);
        const rate = parseFloat(formData.rate) || 1;
        const purchase_id = parseInt(formData.purchase_id);
        const account_id = formData.account_id ? parseInt(formData.account_id) : null;

        try {
            setLoading(true);
            if (editingPayment) {
                await updatePurchasePayment(
                    editingPayment.id,
                    amount,
                    formData.currency,
                    rate,
                    formData.date,
                    formData.notes || null
                );
                toast.success(translations.success.updated);
            } else {
                await createPurchasePayment(
                    purchase_id,
                    account_id,
                    amount,
                    formData.currency,
                    rate,
                    formData.date,
                    formData.notes || null
                );
                toast.success(translations.success.created);
            }
            handleCloseModal();
            await loadData();
        } catch (error: any) {
            toast.error(editingPayment ? translations.errors.update : translations.errors.create);
            console.error("Error saving payment:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: number) => {
        try {
            setLoading(true);
            await deletePurchasePayment(id);
            toast.success(translations.success.deleted);
            setDeleteConfirm(null);
            await loadData();
        } catch (error: any) {
            toast.error(translations.errors.delete);
            console.error("Error deleting payment:", error);
        } finally {
            setLoading(false);
        }
    };

    const getSupplierName = (supplierId: number) => {
        return suppliers.find(s => s.id === supplierId)?.full_name || `ID: ${supplierId}`;
    };

    const getPurchaseInfo = (purchaseId: number): string => {
        const purchase = purchases.find(p => p.id === purchaseId);
        if (!purchase) return "نامشخص";
        const supplierName = getSupplierName(purchase.supplier_id);
        return `${supplierName} - ${formatPersianDate(purchase.date)}`;
    };

    const calculatePaidAmount = (purchaseId: number): number => {
        const purchasePayments = purchasePaymentsMap[purchaseId] || [];
        return purchasePayments.reduce((sum, payment) => sum + payment.total, 0);
    };

    const calculateRemainingAmount = (purchaseId: number): number => {
        const purchase = purchases.find(p => p.id === purchaseId);
        if (!purchase) return 0;
        const paid = calculatePaidAmount(purchaseId);
        return purchase.total_amount - paid;
    };

    const columns = [
        {
            key: "purchase_id",
            label: translations.purchase,
            sortable: false,
            render: (payment: PurchasePayment) => {
                const purchase = purchases.find(p => p.id === payment.purchase_id);
                const paid = calculatePaidAmount(payment.purchase_id);
                const remaining = calculateRemainingAmount(payment.purchase_id);
                return (
                    <div className="space-y-2">
                        <div className="font-medium text-gray-900 dark:text-white">
                            {getPurchaseInfo(payment.purchase_id)}
                        </div>
                        <div className="text-xs space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-gray-500 dark:text-gray-400">مبلغ کل:</span>
                                <span className="font-bold text-purple-600 dark:text-purple-400">
                                    {purchase ? purchase.total_amount.toLocaleString('en-US') : '0'} افغانی
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-gray-500 dark:text-gray-400">پرداخت شده:</span>
                                <span className="font-bold text-green-600 dark:text-green-400">
                                    {paid.toLocaleString('en-US')} افغانی
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-gray-500 dark:text-gray-400">باقیمانده:</span>
                                <span className={`font-bold ${remaining > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                    {remaining.toLocaleString('en-US')} افغانی
                                </span>
                            </div>
                        </div>
                    </div>
                );
            }
        },
        {
            key: "amount",
            label: translations.amount,
            sortable: true,
            render: (payment: PurchasePayment) => (
                <span className="font-bold text-red-600 dark:text-red-400">
                    {payment.amount.toLocaleString()} <span className="opacity-75 text-xs text-gray-500">{payment.currency}</span>
                </span>
            )
        },
        { key: "rate", label: translations.rate, sortable: true },
        {
            key: "total",
            label: translations.total,
            sortable: true,
            render: (payment: PurchasePayment) => (
                <span className="font-bold text-gray-900 dark:text-white">
                    {payment.total.toLocaleString()}
                </span>
            )
        },
        {
            key: "date",
            label: translations.date,
            sortable: true,
            render: (payment: PurchasePayment) => formatPersianDate(payment.date)
        },
        {
            key: "notes",
            label: translations.notes,
            sortable: false,
            render: (payment: PurchasePayment) => payment.notes || "-"
        },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-6" dir="rtl">
            <div className="max-w-6xl mx-auto">
                <PageHeader
                    title={translations.title}
                    onBack={onBack}
                    backLabel={translations.backToDashboard}
                    actions={[
                        {
                            label: translations.addNew,
                            onClick: () => handleOpenModal(),
                            variant: "primary" as const
                        }
                    ]}
                />

                {/* Search Bar */}
                <div className="mb-6 relative max-w-md w-full">
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                        <Search className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setPage(1);
                        }}
                        className="block w-full pr-10 pl-3 py-3 border border-gray-200 dark:border-gray-700 rounded-xl leading-5 bg-white dark:bg-gray-800 placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 sm:text-sm transition-all shadow-sm hover:shadow-md"
                        placeholder="جستجو بر اساس ارز یا تاریخ..."
                    />
                </div>

                <Table<PurchasePayment>
                    data={payments}
                    columns={columns}
                    total={totalItems}
                    page={page}
                    perPage={perPage}
                    onPageChange={setPage}
                    onPerPageChange={setPerPage}
                    onSort={(key, dir) => {
                        setSortBy(key);
                        setSortOrder(dir);
                    }}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    loading={loading}
                    actions={(payment) => (
                        <div className="flex items-center gap-2">
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleOpenModal(payment)}
                                className="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                            </motion.button>
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => setDeleteConfirm(payment.id)}
                                className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </motion.button>
                        </div>
                    )}
                />

                {/* Modal for Add/Edit */}
                <AnimatePresence>
                    {isModalOpen && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                            onClick={handleCloseModal}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
                            >
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                                    {editingPayment ? translations.edit : translations.addNew}
                                </h2>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.purchase}
                                        </label>
                                        <select
                                            value={formData.purchase_id}
                                            onChange={(e) => setFormData({ ...formData, purchase_id: e.target.value })}
                                            required={!editingPayment}
                                            disabled={!!editingPayment}
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                            dir="rtl"
                                        >
                                            <option value="">{translations.placeholders.purchase}</option>
                                            {purchases.map((purchase) => {
                                                const supplierName = suppliers.find(s => s.id === purchase.supplier_id)?.full_name || `ID: ${purchase.supplier_id}`;
                                                return (
                                                    <option key={purchase.id} value={purchase.id}>
                                                        {supplierName} - {formatPersianDate(purchase.date)} - {purchase.total_amount.toLocaleString()}
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            حساب
                                        </label>
                                        <select
                                            value={formData.account_id}
                                            onChange={(e) => setFormData({ ...formData, account_id: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            dir="rtl"
                                        >
                                            <option value="">انتخاب حساب (اختیاری)</option>
                                            {accounts.filter(acc => acc.is_active).map((account) => (
                                                <option key={account.id} value={account.id}>
                                                    {account.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.amount}
                                            </label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={formData.amount}
                                                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder={translations.placeholders.amount}
                                                dir="ltr"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.currency}
                                            </label>
                                            <select
                                                value={formData.currency}
                                                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                dir="rtl"
                                            >
                                                <option value="">انتخاب ارز</option>
                                                {currencies.map((currency) => (
                                                    <option key={currency.id} value={currency.name}>
                                                        {currency.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.rate}
                                            </label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={formData.rate}
                                                onChange={(e) => setFormData({ ...formData, rate: e.target.value })}
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder={translations.placeholders.rate}
                                                dir="ltr"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.total}
                                            </label>
                                            <input
                                                type="text"
                                                value={formData.total}
                                                readOnly
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white"
                                                dir="ltr"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.date}
                                        </label>
                                        <PersianDatePicker
                                            value={formData.date}
                                            onChange={(date) => setFormData({ ...formData, date })}
                                            placeholder={translations.placeholders.date}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.notes}
                                        </label>
                                        <textarea
                                            value={formData.notes}
                                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                            rows={3}
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200 resize-none"
                                            placeholder={translations.placeholders.notes}
                                            dir="rtl"
                                        />
                                    </div>
                                    <div className="flex gap-3 pt-4">
                                        <motion.button
                                            type="button"
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={handleCloseModal}
                                            className="flex-1 px-4 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-bold rounded-xl transition-colors"
                                        >
                                            {translations.cancel}
                                        </motion.button>
                                        <motion.button
                                            type="submit"
                                            disabled={loading}
                                            whileHover={{ scale: loading ? 1 : 1.05 }}
                                            whileTap={{ scale: loading ? 1 : 0.95 }}
                                            className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-bold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {loading ? (
                                                <span className="flex items-center justify-center gap-2">
                                                    <motion.div
                                                        animate={{ rotate: 360 }}
                                                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                                        className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                                                    />
                                                    {translations.save}
                                                </span>
                                            ) : (
                                                translations.save
                                            )}
                                        </motion.button>
                                    </div>
                                </form>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Delete Confirmation Modal */}
                <AnimatePresence>
                    {deleteConfirm && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4"
                            onClick={() => setDeleteConfirm(null)}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                                animate={{ scale: 1, opacity: 1, y: 0 }}
                                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-md border border-red-100 dark:border-red-900/30"
                            >
                                <div className="flex justify-center mb-6">
                                    <motion.div
                                        animate={{
                                            scale: [1, 1.1, 1],
                                            rotate: [0, -5, 5, -5, 0]
                                        }}
                                        transition={{
                                            duration: 0.5,
                                            repeat: Infinity,
                                            repeatDelay: 2
                                        }}
                                        className="w-20 h-20 bg-gradient-to-br from-red-500 to-pink-500 rounded-full flex items-center justify-center shadow-lg"
                                    >
                                        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                        </svg>
                                    </motion.div>
                                </div>
                                <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-white mb-3">
                                    {translations.delete}
                                </h2>
                                <p className="text-center text-gray-600 dark:text-gray-400 mb-8 leading-relaxed">
                                    {translations.confirmDelete}
                                </p>
                                <div className="flex gap-3">
                                    <motion.button
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => setDeleteConfirm(null)}
                                        className="flex-1 px-6 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-bold rounded-xl transition-all duration-200 shadow-md hover:shadow-lg"
                                    >
                                        {translations.cancel}
                                    </motion.button>
                                    <motion.button
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => handleDelete(deleteConfirm)}
                                        disabled={loading}
                                        className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 text-white font-bold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
                                    >
                                        {loading ? (
                                            <span className="flex items-center justify-center gap-2">
                                                <motion.div
                                                    animate={{ rotate: 360 }}
                                                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                                    className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                                                />
                                                در حال حذف...
                                            </span>
                                        ) : (
                                            <span className="flex items-center justify-center gap-2">
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                                {translations.delete}
                                            </span>
                                        )}
                                    </motion.button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <Footer />
            </div>
        </div>
    );
}

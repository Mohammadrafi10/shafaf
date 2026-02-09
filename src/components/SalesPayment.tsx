import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
    getSales,
    getSalePayments,
    createSalePayment,
    deleteSalePayment,
    type Sale,
    type SalePayment,
} from "../utils/sales";
import { getCustomers, type Customer } from "../utils/customer";
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
    title: "بیلانس مشتری ها",
    addNew: "ثبت پرداخت جدید",
    edit: "ویرایش",
    delete: "حذف",
    cancel: "لغو",
    save: "ذخیره",
    sale: "فروش",
    customer: "مشتری",
    amount: "مقدار",
    date: "تاریخ",
    actions: "عملیات",
    saleTotal: "مبلغ کل فروش",
    paidAmount: "پرداخت شده",
    remainingAmount: "باقیمانده",
    noPayments: "هیچ پرداختی ثبت نشده است",
    confirmDelete: "آیا از حذف این پرداخت اطمینان دارید؟",
    backToDashboard: "بازگشت به داشبورد",
    success: {
        created: "پرداخت با موفقیت ثبت شد",
        deleted: "پرداخت با موفقیت حذف شد",
    },
    errors: {
        create: "خطا در ثبت پرداخت",
        delete: "خطا در حذف پرداخت",
        fetch: "خطا در دریافت لیست پرداخت‌ها",
        saleRequired: "انتخاب فروش الزامی است",
        amountRequired: "مقدار الزامی است",
        dateRequired: "تاریخ الزامی است",
    },
    placeholders: {
        sale: "فروش را انتخاب کنید",
        amount: "مقدار را وارد کنید",
        date: "تاریخ را انتخاب کنید",
    },
};

interface SalesPaymentManagementProps {
    onBack?: () => void;
}

export default function SalesPaymentManagement({ onBack }: SalesPaymentManagementProps) {
    const [payments, setPayments] = useState<SalePayment[]>([]);
    const [sales, setSales] = useState<Sale[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [salePaymentsMap, setSalePaymentsMap] = useState<Record<number, SalePayment[]>>({});
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({
        sale_id: "",
        account_id: "",
        amount: "",
        date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
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

            // Get all sales and payments
            const [salesResponse, customersData, accountsData] = await Promise.all([
                getSales(1, 10000, search, sortBy, sortOrder),
                getCustomers(1, 10000),
                getAccounts(),
            ]);

            setSales(salesResponse.items);
            setCustomers(customersData.items);
            setAccounts(accountsData);

            // Collect all payments from all sales
            const allPayments: SalePayment[] = [];
            const paymentsMap: Record<number, SalePayment[]> = {};

            await Promise.all(
                salesResponse.items.map(async (sale) => {
                    try {
                        const salePayments = await getSalePayments(sale.id);
                        paymentsMap[sale.id] = salePayments;
                        allPayments.push(...salePayments);
                    } catch (error) {
                        paymentsMap[sale.id] = [];
                    }
                })
            );

            setSalePaymentsMap(paymentsMap);

            // Filter and paginate payments
            const startIndex = (page - 1) * perPage;
            const endIndex = startIndex + perPage;
            const paginatedPayments = allPayments.slice(startIndex, endIndex);
            setPayments(paginatedPayments);
            setTotalItems(allPayments.length);
        } catch (error: any) {
            toast.error(translations.errors.fetch);
            console.error("Error loading data:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = (payment?: SalePayment) => {
        if (payment) {
            setFormData({
                sale_id: payment.sale_id.toString(),
                account_id: payment.account_id?.toString() || "",
                amount: payment.amount.toString(),
                date: payment.date,
            });
        } else {
            setFormData({
                sale_id: "",
                account_id: "",
                amount: "",
                date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
            });
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setFormData({
            sale_id: "",
            account_id: "",
            amount: "",
            date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.sale_id) {
            toast.error(translations.errors.saleRequired);
            return;
        }

        if (!formData.amount || parseFloat(formData.amount) <= 0) {
            toast.error(translations.errors.amountRequired);
            return;
        }

        if (!formData.date) {
            toast.error(translations.errors.dateRequired);
            return;
        }

        const amount = parseFloat(formData.amount);
        const sale_id = parseInt(formData.sale_id);
        const account_id = formData.account_id ? parseInt(formData.account_id) : null;
        const sale = sales.find(s => s.id === sale_id);

        try {
            setLoading(true);
            await createSalePayment(
                sale_id,
                account_id,
                sale?.currency_id || null, // currency_id
                sale?.exchange_rate || 1, // exchange_rate
                amount,
                formData.date
            );
            toast.success(translations.success.created);
            handleCloseModal();
            await loadData();
        } catch (error: any) {
            toast.error(translations.errors.create);
            console.error("Error saving payment:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: number) => {
        try {
            setLoading(true);
            await deleteSalePayment(id);
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

    const getSaleInfo = (saleId: number): string => {
        const sale = sales.find(s => s.id === saleId);
        const customer = sale ? customers.find(c => c.id === sale.customer_id) : null;
        return sale ? `فروش #${sale.id} - ${customer ? customer.full_name : 'نامشخص'} - ${formatPersianDate(sale.date)}` : "نامشخص";
    };

    const calculatePaidAmount = (saleId: number): number => {
        const salePayments = salePaymentsMap[saleId] || [];
        return salePayments.reduce((sum, payment) => sum + payment.amount, 0);
    };

    const calculateRemainingAmount = (saleId: number): number => {
        const sale = sales.find(s => s.id === saleId);
        if (!sale) return 0;
        const paid = calculatePaidAmount(saleId);
        return sale.total_amount - paid;
    };

    const columns = [
        {
            key: "sale_id",
            label: translations.sale,
            sortable: false,
            render: (payment: SalePayment) => {
                const sale = sales.find(s => s.id === payment.sale_id);
                const paid = calculatePaidAmount(payment.sale_id);
                const remaining = calculateRemainingAmount(payment.sale_id);
                return (
                    <div className="space-y-2">
                        <div className="font-medium text-gray-900 dark:text-white">
                            {getSaleInfo(payment.sale_id)}
                        </div>
                        <div className="text-xs space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-gray-500 dark:text-gray-400">مبلغ کل:</span>
                                <span className="font-bold text-purple-600 dark:text-purple-400">
                                    {sale ? sale.total_amount.toLocaleString('en-US') : '0'} افغانی
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
            render: (payment: SalePayment) => (
                <span className="font-bold text-green-600 dark:text-green-400">
                    {payment.amount.toLocaleString('en-US')} افغانی
                </span>
            )
        },
        {
            key: "date",
            label: translations.date,
            sortable: true,
            render: (payment: SalePayment) => formatPersianDate(payment.date)
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
                        placeholder="جستجو بر اساس تاریخ..."
                    />
                </div>

                <Table<SalePayment>
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

                {/* Modal for Add */}
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
                                    {translations.addNew}
                                </h2>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.sale}
                                        </label>
                                        <select
                                            value={formData.sale_id}
                                            onChange={(e) => setFormData({ ...formData, sale_id: e.target.value })}
                                            required
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            dir="rtl"
                                        >
                                            <option value="">{translations.placeholders.sale}</option>
                                            {sales.map((sale) => {
                                                const customer = customers.find(c => c.id === sale.customer_id);
                                                return (
                                                    <option key={sale.id} value={sale.id}>
                                                        فروش #{sale.id} - {customer ? customer.full_name : 'نامشخص'} - {formatPersianDate(sale.date)} - {sale.total_amount.toLocaleString()}
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
                                            {translations.date}
                                        </label>
                                        <PersianDatePicker
                                            value={formData.date}
                                            onChange={(date) => setFormData({ ...formData, date })}
                                            placeholder={translations.placeholders.date}
                                            required
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

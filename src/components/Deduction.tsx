import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
    initDeductionsTable,
    createDeduction,
    getDeductions,
    updateDeduction,
    deleteDeduction,
    type Deduction,
} from "../utils/deduction";
import { getEmployees, type Employee } from "../utils/employee";
import { getCurrencies, type Currency } from "../utils/currency";
import { isDatabaseOpen, openDatabase } from "../utils/db";
import { getCurrentPersianYear } from "../utils/date";
import Footer from "./Footer";
import Table from "./common/Table";
import PageHeader from "./common/PageHeader";
import { Search } from "lucide-react";

const dariMonths = [
    "حمل", "ثور", "جوزا", "سرطان", "اسد", "سنبله",
    "میزان", "عقرب", "قوس", "جدی", "دلو", "حوت"
];

// Dari translations
const translations = {
    title: "مدیریت کسرها",
    addNew: "ثبت کسر جدید",
    edit: "ویرایش",
    delete: "حذف",
    cancel: "لغو",
    save: "ذخیره",
    employee: "کارمند",
    year: "سال",
    month: "ماه",
    currency: "ارز",
    rate: "نرخ",
    amount: "مقدار",
    total: "مجموع",
    actions: "عملیات",
    createdAt: "تاریخ ایجاد",
    updatedAt: "آخرین بروزرسانی",
    noDeductions: "هیچ کسری ثبت نشده است",
    confirmDelete: "آیا از حذف این کسر اطمینان دارید؟",
    backToDashboard: "بازگشت به داشبورد",
    success: {
        created: "کسر با موفقیت ثبت شد",
        updated: "کسر با موفقیت بروزرسانی شد",
        deleted: "کسر با موفقیت حذف شد",
    },
    errors: {
        create: "خطا در ثبت کسر",
        update: "خطا در بروزرسانی کسر",
        delete: "خطا در حذف کسر",
        fetch: "خطا در دریافت لیست کسرها",
        employeeRequired: "انتخاب کارمند الزامی است",
        yearRequired: "سال الزامی است",
        monthRequired: "ماه الزامی است",
        currencyRequired: "انتخاب ارز الزامی است",
        amountRequired: "مقدار الزامی است",
    },
    placeholders: {
        employee: "کارمند را انتخاب کنید",
        currency: "ارز را انتخاب کنید",
        amount: "مقدار را وارد کنید",
        rate: "نرخ ارز",
    },
};

interface DeductionManagementProps {
    onBack?: () => void;
}

export default function DeductionManagement({ onBack }: DeductionManagementProps) {
    const [deductions, setDeductions] = useState<Deduction[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingDeduction, setEditingDeduction] = useState<Deduction | null>(null);
    const [formData, setFormData] = useState({
        employee_id: "",
        year: getCurrentPersianYear().toString(),
        month: "",
        currency: "",
        rate: "1",
        amount: "",
        total: "",
    });
    const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

    // Pagination & Search
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(10);
    const [totalItems, setTotalItems] = useState(0);
    const [search, setSearch] = useState("");
    const [sortBy, setSortBy] = useState("year");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

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
                await initDeductionsTable();
            } catch (err) {
                console.log("Table initialization:", err);
            }

            const [deductionsResponse, employeesResponse, currenciesData] = await Promise.all([
                getDeductions(page, perPage, search, sortBy, sortOrder),
                getEmployees(1, 1000), // Get all employees (large page size)
                getCurrencies(),
            ]);

            setDeductions(deductionsResponse.items);
            setTotalItems(deductionsResponse.total);
            setEmployees(employeesResponse.items);
            setCurrencies(currenciesData);
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

    const handleOpenModal = (deduction?: Deduction) => {
        if (deduction) {
            setEditingDeduction(deduction);
            setFormData({
                employee_id: deduction.employee_id.toString(),
                year: deduction.year.toString(),
                month: deduction.month,
                currency: deduction.currency,
                rate: deduction.rate.toString(),
                amount: deduction.amount.toString(),
                total: (deduction.amount * deduction.rate).toFixed(2),
            });
        } else {
            setEditingDeduction(null);
            setFormData({
                employee_id: "",
                year: getCurrentPersianYear().toString(),
                month: "",
                currency: "",
                rate: "1",
                amount: "",
                total: "",
            });
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingDeduction(null);
        setFormData({
            employee_id: "",
            year: getCurrentPersianYear().toString(),
            month: "",
            currency: "",
            rate: "1",
            amount: "",
            total: "",
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.employee_id) {
            toast.error(translations.errors.employeeRequired);
            return;
        }

        if (!formData.year || parseInt(formData.year) <= 0) {
            toast.error(translations.errors.yearRequired);
            return;
        }

        if (!formData.month) {
            toast.error(translations.errors.monthRequired);
            return;
        }

        if (!formData.currency) {
            toast.error(translations.errors.currencyRequired);
            return;
        }

        if (!formData.amount || parseFloat(formData.amount) <= 0) {
            toast.error(translations.errors.amountRequired);
            return;
        }

        const amount = parseFloat(formData.amount);
        const rate = parseFloat(formData.rate) || 1;
        const year = parseInt(formData.year);

        try {
            setLoading(true);
            if (editingDeduction) {
                await updateDeduction(
                    editingDeduction.id,
                    parseInt(formData.employee_id),
                    year,
                    formData.month,
                    formData.currency,
                    rate,
                    amount
                );
                toast.success(translations.success.updated);
            } else {
                await createDeduction(
                    parseInt(formData.employee_id),
                    year,
                    formData.month,
                    formData.currency,
                    rate,
                    amount
                );
                toast.success(translations.success.created);
            }
            handleCloseModal();
            await loadData();
        } catch (error: any) {
            toast.error(editingDeduction ? translations.errors.update : translations.errors.create);
            console.error("Error saving deduction:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: number) => {
        try {
            setLoading(true);
            await deleteDeduction(id);
            toast.success(translations.success.deleted);
            setDeleteConfirm(null);
            await loadData();
        } catch (error: any) {
            toast.error(translations.errors.delete);
            console.error("Error deleting deduction:", error);
        } finally {
            setLoading(false);
        }
    };

    const getEmployeeName = (employeeId: number): string => {
        const employee = employees.find(e => e.id === employeeId);
        return employee ? employee.full_name : "نامشخص";
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-6" dir="rtl">
            <div className="w-full">
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
                        placeholder="جستجو بر اساس ارز، ماه یا سال..."
                    />
                </div>

                <Table<Deduction>
                    data={deductions}
                    columns={[
                        {
                            key: "employee_id",
                            label: translations.employee,
                            sortable: false,
                            render: (ded: Deduction) => (
                                <div className="font-medium text-gray-900 dark:text-white">
                                    {getEmployeeName(ded.employee_id)}
                                </div>
                            )
                        },
                        {
                            key: "year",
                            label: translations.year,
                            sortable: true,
                            render: (ded: Deduction) => ded.year.toString()
                        },
                        {
                            key: "month",
                            label: translations.month,
                            sortable: true,
                            render: (ded: Deduction) => ded.month
                        },
                        {
                            key: "amount",
                            label: translations.amount,
                            sortable: true,
                            render: (ded: Deduction) => (
                                <span className="font-bold text-red-600 dark:text-red-400">
                                    {ded.amount.toLocaleString()} <span className="opacity-75 text-xs text-gray-500">{ded.currency}</span>
                                </span>
                            )
                        },
                        { key: "rate", label: translations.rate, sortable: true },
                        {
                            key: "total",
                            label: translations.total,
                            sortable: false,
                            render: (ded: Deduction) => {
                                const total = ded.amount * ded.rate;
                                return (
                                    <span className="font-bold text-gray-900 dark:text-white">
                                        {total.toLocaleString()}
                                    </span>
                                );
                            }
                        },
                    ]}
                    page={page}
                    perPage={perPage}
                    total={totalItems}
                    onPageChange={setPage}
                    onPerPageChange={setPerPage}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={(newSortBy: string, newSortOrder: "asc" | "desc") => {
                        setSortBy(newSortBy);
                        setSortOrder(newSortOrder);
                    }}
                    loading={loading}
                    actions={(ded) => (
                        <div className="flex items-center gap-2">
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleOpenModal(ded)}
                                className="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                            </motion.button>
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => setDeleteConfirm(ded.id)}
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
                                    {editingDeduction ? translations.edit : translations.addNew}
                                </h2>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.employee} <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            value={formData.employee_id}
                                            onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                                            required
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            dir="rtl"
                                        >
                                            <option value="">{translations.placeholders.employee}</option>
                                            {employees.map((employee) => (
                                                <option key={employee.id} value={employee.id}>
                                                    {employee.full_name} {employee.position ? `(${employee.position})` : ""}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.year} <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="number"
                                                value={formData.year}
                                                onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder="سال"
                                                dir="ltr"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.month} <span className="text-red-500">*</span>
                                            </label>
                                            <select
                                                value={formData.month}
                                                onChange={(e) => setFormData({ ...formData, month: e.target.value })}
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                dir="rtl"
                                            >
                                                <option value="">ماه را انتخاب کنید</option>
                                                {dariMonths.map((month) => (
                                                    <option key={month} value={month}>
                                                        {month}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.currency} <span className="text-red-500">*</span>
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
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.amount} <span className="text-red-500">*</span>
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

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
    initExpensesTable,
    createExpense,
    getExpenses,
    updateExpense,
    deleteExpense,
    type Expense,
} from "../utils/expense";
import {
    initExpenseTypesTable,
    createExpenseType,
    getExpenseTypes,
    updateExpenseType,
    deleteExpenseType,
    type ExpenseType,
} from "../utils/expense_type";
import { getCurrencies, type Currency } from "../utils/currency";
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
    title: "مدیریت مصارف",
    addNew: "ثبت مصارف جدید",
    edit: "ویرایش",
    delete: "حذف",
    cancel: "لغو",
    save: "ذخیره",
    expenseType: "نوع مصارف",
    manageExpenseTypes: "مدیریت انواع مصارف",
    expenseTypeName: "نام نوع مصارف",
    addExpenseType: "افزودن نوع مصارف جدید",
    editExpenseType: "ویرایش نوع مصارف",
    amount: "مقدار",
    currency: "ارز",
    rate: "نرخ",
    total: "مجموع",
    date: "تاریخ",
    actions: "عملیات",
    createdAt: "تاریخ ایجاد",
    updatedAt: "آخرین بروزرسانی",
    noExpenses: "هیچ مصارفی ثبت نشده است",
    noExpenseTypes: "هیچ نوع مصارفی ثبت نشده است",
    confirmDelete: "آیا از حذف این مصارف اطمینان دارید؟",
    confirmDeleteType: "آیا از حذف این نوع مصارف اطمینان دارید؟",
    backToDashboard: "بازگشت به داشبورد",
    success: {
        created: "مصارف با موفقیت ثبت شد",
        updated: "مصارف با موفقیت بروزرسانی شد",
        deleted: "مصارف با موفقیت حذف شد",
        typeCreated: "نوع مصارف با موفقیت ثبت شد",
        typeUpdated: "نوع مصارف با موفقیت بروزرسانی شد",
        typeDeleted: "نوع مصارف با موفقیت حذف شد",
    },
    errors: {
        create: "خطا در ثبت مصارف",
        update: "خطا در بروزرسانی مصارف",
        delete: "خطا در حذف مصارف",
        fetch: "خطا در دریافت لیست مصارف",
        expenseTypeRequired: "انتخاب نوع مصارف الزامی است",
        amountRequired: "مقدار الزامی است",
        currencyRequired: "انتخاب ارز الزامی است",
        dateRequired: "تاریخ الزامی است",
        typeCreate: "خطا در ثبت نوع مصارف",
        typeUpdate: "خطا در بروزرسانی نوع مصارف",
        typeDelete: "خطا در حذف نوع مصارف",
        typeFetch: "خطا در دریافت لیست انواع مصارف",
        typeNameRequired: "نام نوع مصارف الزامی است",
    },
    placeholders: {
        expenseType: "نوع مصارف را انتخاب کنید",
        expenseTypeName: "نام نوع مصارف را وارد کنید",
        amount: "مقدار را وارد کنید",
        rate: "نرخ ارز",
        date: "تاریخ را انتخاب کنید",
    },
};

interface ExpenseManagementProps {
    onBack?: () => void;
}

export default function ExpenseManagement({ onBack }: ExpenseManagementProps) {
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [expenseTypes, setExpenseTypes] = useState<ExpenseType[]>([]);
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isExpenseTypeModalOpen, setIsExpenseTypeModalOpen] = useState(false);
    const [isExpenseTypeFormModalOpen, setIsExpenseTypeFormModalOpen] = useState(false);
    const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
    const [editingExpenseType, setEditingExpenseType] = useState<ExpenseType | null>(null);
    const [formData, setFormData] = useState({
        expense_type_id: "",
        account_id: "",
        amount: "",
        currency: "",
        rate: "1",
        total: "",
        date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
        bill_no: "",
        description: "",
    });
    const [expenseTypeFormData, setExpenseTypeFormData] = useState({
        name: "",
    });

    // Pagination & Search
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(10);
    const [totalItems, setTotalItems] = useState(0);
    const [search, setSearch] = useState("");
    const [sortBy, setSortBy] = useState("date");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
    const [deleteTypeConfirm, setDeleteTypeConfirm] = useState<number | null>(null);

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
                await initExpenseTypesTable();
                await initExpensesTable();
            } catch (err) {
                console.log("Table initialization:", err);
            }

            const [expensesResponse, expenseTypesData, currenciesData, accountsData] = await Promise.all([
                getExpenses(page, perPage, search, sortBy, sortOrder),
                getExpenseTypes(),
                getCurrencies(),
                getAccounts(),
            ]);

            setExpenses(expensesResponse.items);
            setTotalItems(expensesResponse.total);
            setExpenseTypes(expenseTypesData);
            setCurrencies(currenciesData);
            setAccounts(accountsData);
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

    // Update exchange rate when currency changes
    useEffect(() => {
        if (formData.currency) {
            const selectedCurrency = currencies.find(c => c.name === formData.currency);
            if (selectedCurrency) {
                setFormData(prev => ({ ...prev, rate: selectedCurrency.rate.toString() }));
            }
        }
    }, [formData.currency, currencies]);

    const handleOpenModal = (expense?: Expense) => {
        if (expense) {
            setEditingExpense(expense);
            setFormData({
                expense_type_id: expense.expense_type_id.toString(),
                account_id: expense.account_id?.toString() || "",
                amount: expense.amount.toString(),
                currency: expense.currency,
                rate: expense.rate.toString(),
                total: expense.total.toString(),
                date: expense.date,
                bill_no: expense.bill_no || "",
                description: expense.description || "",
            });
        } else {
            setEditingExpense(null);
            setFormData({
                expense_type_id: "",
                account_id: "",
                amount: "",
                currency: "",
                rate: "1",
                total: "",
                date: new Date().toISOString().split('T')[0],
                bill_no: "",
                description: "",
            });
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingExpense(null);
        setFormData({
            expense_type_id: "",
            account_id: "",
            amount: "",
            currency: "",
            rate: "1",
            total: "",
            date: new Date().toISOString().split('T')[0],
            bill_no: "",
            description: "",
        });
    };

    const handleOpenExpenseTypeModal = () => {
        setIsExpenseTypeModalOpen(true);
    };

    const handleCloseExpenseTypeModal = () => {
        setIsExpenseTypeModalOpen(false);
    };

    const handleOpenExpenseTypeFormModal = (expenseType?: ExpenseType) => {
        if (expenseType) {
            setEditingExpenseType(expenseType);
            setExpenseTypeFormData({ name: expenseType.name });
        } else {
            setEditingExpenseType(null);
            setExpenseTypeFormData({ name: "" });
        }
        setIsExpenseTypeFormModalOpen(true);
        setIsExpenseTypeModalOpen(false);
    };

    const handleCloseExpenseTypeFormModal = () => {
        setIsExpenseTypeFormModalOpen(false);
        setEditingExpenseType(null);
        setExpenseTypeFormData({ name: "" });
    };

    const handleExpenseTypeSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!expenseTypeFormData.name.trim()) {
            toast.error(translations.errors.typeNameRequired);
            return;
        }

        try {
            setLoading(true);
            if (editingExpenseType) {
                await updateExpenseType(editingExpenseType.id, expenseTypeFormData.name);
                toast.success(translations.success.typeUpdated);
            } else {
                await createExpenseType(expenseTypeFormData.name);
                toast.success(translations.success.typeCreated);
            }
            setIsExpenseTypeFormModalOpen(false);
            setEditingExpenseType(null);
            setExpenseTypeFormData({ name: "" });
            setIsExpenseTypeModalOpen(true);
            await loadData();
        } catch (error: any) {
            toast.error(editingExpenseType ? translations.errors.typeUpdate : translations.errors.typeCreate);
            console.error("Error saving expense type:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteExpenseType = async (id: number) => {
        try {
            setLoading(true);
            await deleteExpenseType(id);
            toast.success(translations.success.typeDeleted);
            setDeleteTypeConfirm(null);
            await loadData();
        } catch (error: any) {
            toast.error(translations.errors.typeDelete);
            console.error("Error deleting expense type:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.expense_type_id) {
            toast.error(translations.errors.expenseTypeRequired);
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
        const total = amount * rate;
        const expense_type_id = parseInt(formData.expense_type_id);
        const account_id = formData.account_id ? parseInt(formData.account_id) : null;

        try {
            setLoading(true);
            if (editingExpense) {
                await updateExpense(
                    editingExpense.id,
                    expense_type_id,
                    account_id,
                    amount,
                    formData.currency,
                    rate,
                    total,
                    formData.date,
                    formData.bill_no || null,
                    formData.description || null
                );
                toast.success(translations.success.updated);
            } else {
                await createExpense(
                    expense_type_id,
                    account_id,
                    amount,
                    formData.currency,
                    rate,
                    total,
                    formData.date,
                    formData.bill_no || null,
                    formData.description || null
                );
                toast.success(translations.success.created);
            }
            handleCloseModal();
            await loadData();
        } catch (error: any) {
            // Extract error message from backend
            // Tauri errors can be strings or Error objects
            const errorMessage = typeof error === "string" 
                ? error 
                : (error as Error)?.message || error?.toString() || String(error);
            // Show the actual error message from backend (e.g., "Insufficient balance in account. Available: 240, Required: 500")
            toast.error(errorMessage || (editingExpense ? translations.errors.update : translations.errors.create));
            console.error("Error saving expense:", error);
        } finally {
            setLoading(false);
        }
    };

    const getExpenseTypeName = (expenseTypeId: number): string => {
        const expenseType = expenseTypes.find(et => et.id === expenseTypeId);
        return expenseType ? expenseType.name : "نامشخص";
    };

    const handleDelete = async (id: number) => {
        try {
            setLoading(true);
            await deleteExpense(id);
            toast.success(translations.success.deleted);
            setDeleteConfirm(null);
            await loadData();
        } catch (error: any) {
            toast.error(translations.errors.delete);
            console.error("Error deleting expense:", error);
        } finally {
            setLoading(false);
        }
    };

    const columns = [
        {
            key: "expense_type_id",
            label: translations.expenseType,
            sortable: false,
            render: (exp: Expense) => (
                <div className="font-medium text-gray-900 dark:text-white">
                    {getExpenseTypeName(exp.expense_type_id)}
                </div>
            )
        },
        {
            key: "amount",
            label: translations.amount,
            sortable: true,
            render: (exp: Expense) => (
                <span className="font-bold text-red-600 dark:text-red-400">
                    {exp.amount.toLocaleString()} <span className="opacity-75 text-xs text-gray-500">{exp.currency}</span>
                </span>
            )
        },
        { key: "rate", label: translations.rate, sortable: true },
        {
            key: "total",
            label: translations.total,
            sortable: true,
            render: (exp: Expense) => (
                <span className="font-bold text-gray-900 dark:text-white">
                    {exp.total.toLocaleString()}
                </span>
            )
        },
        {
            key: "date",
            label: translations.date,
            sortable: true,
            render: (exp: Expense) => formatPersianDate(exp.date)
        },
        {
            key: "bill_no",
            label: "شماره بل",
            sortable: false,
            render: (exp: Expense) => exp.bill_no || "-"
        },
        {
            key: "description",
            label: "توضیحات",
            sortable: false,
            render: (exp: Expense) => exp.description || "-"
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
                            label: translations.manageExpenseTypes,
                            onClick: () => handleOpenExpenseTypeModal(),
                            variant: "secondary" as const
                        },
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

                <Table
                    data={expenses}
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
                    actions={(exp) => (
                        <div className="flex items-center gap-2">
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleOpenModal(exp)}
                                className="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                            </motion.button>
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => setDeleteConfirm(exp.id)}
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
                                    {editingExpense ? translations.edit : translations.addNew}
                                </h2>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                                                {translations.expenseType}
                                                <span className="text-red-500 mr-1">*</span>
                                            </label>
                                            <motion.button
                                                type="button"
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                onClick={() => {
                                                    setIsModalOpen(false);
                                                    handleOpenExpenseTypeModal();
                                                }}
                                                className="text-xs px-3 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition-colors"
                                            >
                                                {translations.manageExpenseTypes}
                                            </motion.button>
                                        </div>
                                        <select
                                            value={formData.expense_type_id}
                                            onChange={(e) => setFormData({ ...formData, expense_type_id: e.target.value })}
                                            required
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            dir="rtl"
                                        >
                                            <option value="">{translations.placeholders.expenseType}</option>
                                            {expenseTypes.map((expenseType) => (
                                                <option key={expenseType.id} value={expenseType.id}>
                                                    {expenseType.name}
                                                </option>
                                            ))}
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
                                                <span className="text-red-500 mr-1">*</span>
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
                                                <span className="text-red-500 mr-1">*</span>
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
                                                <span className="text-red-500 mr-1">*</span>
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
                                            <span className="text-red-500 mr-1">*</span>
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
                                            شماره بل
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.bill_no}
                                            onChange={(e) => setFormData({ ...formData, bill_no: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            placeholder="شماره بل را وارد کنید"
                                            dir="ltr"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            توضیحات
                                        </label>
                                        <textarea
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            rows={3}
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200 resize-none"
                                            placeholder="توضیحات را وارد کنید"
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

                {/* Expense Type Form Modal */}
                <AnimatePresence>
                    {isExpenseTypeFormModalOpen && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                            onClick={handleCloseExpenseTypeFormModal}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
                            >
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                                    {editingExpenseType ? translations.editExpenseType : translations.addExpenseType}
                                </h2>
                                <form onSubmit={handleExpenseTypeSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.expenseTypeName}
                                        </label>
                                        <input
                                            type="text"
                                            value={expenseTypeFormData.name}
                                            onChange={(e) => setExpenseTypeFormData({ name: e.target.value })}
                                            required
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            placeholder={translations.placeholders.expenseTypeName}
                                            dir="rtl"
                                        />
                                    </div>
                                    <div className="flex gap-3 pt-4">
                                        <motion.button
                                            type="button"
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={handleCloseExpenseTypeFormModal}
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

                {/* Expense Type List Modal */}
                <AnimatePresence>
                    {isExpenseTypeModalOpen && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                            onClick={handleCloseExpenseTypeModal}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-4xl max-h-[90vh] overflow-y-auto"
                            >
                                <div className="flex justify-between items-center mb-6">
                                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                        {translations.manageExpenseTypes}
                                    </h2>
                                    <motion.button
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => handleOpenExpenseTypeFormModal()}
                                        className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200"
                                    >
                                        {translations.addExpenseType}
                                    </motion.button>
                                </div>
                                {expenseTypes.length === 0 ? (
                                    <div className="text-center py-12">
                                        <p className="text-gray-500 dark:text-gray-400">{translations.noExpenseTypes}</p>
                                    </div>
                                ) : (
                                    <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
                                        {expenseTypes.map((expenseType) => (
                                            <motion.div
                                                key={expenseType.id}
                                                initial={{ opacity: 0, y: 20 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600 flex justify-between items-center"
                                            >
                                                <span className="text-gray-900 dark:text-white font-semibold">
                                                    {expenseType.name}
                                                </span>
                                                <div className="flex gap-2">
                                                    <motion.button
                                                        whileHover={{ scale: 1.05 }}
                                                        whileTap={{ scale: 0.95 }}
                                                        onClick={() => {
                                                            handleCloseExpenseTypeModal();
                                                            setTimeout(() => handleOpenExpenseTypeModal(), 100);
                                                        }}
                                                        className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg text-sm font-semibold hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                                                    >
                                                        {translations.edit}
                                                    </motion.button>
                                                    <motion.button
                                                        whileHover={{ scale: 1.05 }}
                                                        whileTap={{ scale: 0.95 }}
                                                        onClick={() => setDeleteTypeConfirm(expenseType.id)}
                                                        className="px-3 py-1 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg text-sm font-semibold hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                                                    >
                                                        {translations.delete}
                                                    </motion.button>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                )}
                                <div className="flex justify-end mt-6">
                                    <motion.button
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={handleCloseExpenseTypeModal}
                                        className="px-6 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-bold rounded-xl transition-colors"
                                    >
                                        {translations.cancel}
                                    </motion.button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Delete Expense Type Confirmation Modal */}
                <AnimatePresence>
                    {deleteTypeConfirm && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4"
                            onClick={() => setDeleteTypeConfirm(null)}
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
                                    {translations.confirmDeleteType}
                                </p>
                                <div className="flex gap-3">
                                    <motion.button
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => setDeleteTypeConfirm(null)}
                                        className="flex-1 px-6 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-bold rounded-xl transition-all duration-200 shadow-md hover:shadow-lg"
                                    >
                                        {translations.cancel}
                                    </motion.button>
                                    <motion.button
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => handleDeleteExpenseType(deleteTypeConfirm)}
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

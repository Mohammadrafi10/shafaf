import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
    initAccountsTable,
    initAccountTransactionsTable,
    initAccountCurrencyBalancesTable,
    createAccount,
    getAccounts,
    updateAccount,
    deleteAccount,
    depositAccount,
    withdrawAccount,
    getAccountTransactions,
    getAllAccountBalances,
    type Account,
    type AccountTransaction,
    type AccountCurrencyBalance,
} from "../utils/account";
import { getCurrencies, type Currency } from "../utils/currency";
import { getCoaCategories, initStandardCoaCategories, type CoaCategory } from "../utils/coa";
import { isDatabaseOpen, openDatabase } from "../utils/db";
import Footer from "./Footer";
import PersianDatePicker from "./PersianDatePicker";
import { formatPersianDate, getCurrentPersianDate, persianToGeorgian } from "../utils/date";
import PageHeader from "./common/PageHeader";
import CoaManagement from "./CoaManagement";
import JournalEntries from "./JournalEntries";

// Dari translations
const translations = {
    title: "مدیریت حساب‌ها",
    addNew: "ثبت حساب جدید",
    edit: "ویرایش",
    delete: "حذف",
    cancel: "لغو",
    save: "ذخیره",
    deposit: "واریز",
    withdraw: "برداشت",
    accountName: "نام حساب",
    currency: "ارز",
    initialBalance: "موجودی اولیه",
    currentBalance: "موجودی فعلی",
    notes: "یادداشت",
    amount: "مقدار",
    rate: "نرخ",
    total: "مجموع",
    date: "تاریخ",
    transactionType: "نوع تراکنش",
    full: "کامل",
    advance: "پیش‌پرداخت",
    isFull: "برداشت/واریز کامل",
    transactionHistory: "تاریخچه تراکنش‌ها",
    noAccounts: "هیچ حسابی ثبت نشده است",
    noTransactions: "هیچ تراکنشی ثبت نشده است",
    confirmDelete: "آیا از حذف این حساب اطمینان دارید؟",
    backToDashboard: "بازگشت به داشبورد",
    success: {
        created: "حساب با موفقیت ثبت شد",
        updated: "حساب با موفقیت بروزرسانی شد",
        deleted: "حساب با موفقیت حذف شد",
        deposited: "واریز با موفقیت انجام شد",
        withdrawn: "برداشت با موفقیت انجام شد",
    },
    errors: {
        create: "خطا در ثبت حساب",
        update: "خطا در بروزرسانی حساب",
        delete: "خطا در حذف حساب",
        fetch: "خطا در دریافت لیست حساب‌ها",
        nameRequired: "نام حساب الزامی است",
        amountRequired: "مقدار الزامی است",
        currencyRequired: "انتخاب ارز الزامی است",
        dateRequired: "تاریخ الزامی است",
        insufficientBalance: "موجودی کافی نیست",
        deposit: "خطا در واریز",
        withdraw: "خطا در برداشت",
    },
    placeholders: {
        accountName: "نام حساب را وارد کنید",
        currency: "ارز را انتخاب کنید",
        amount: "مقدار را وارد کنید",
        rate: "نرخ ارز",
        date: "تاریخ را انتخاب کنید",
        notes: "یادداشت (اختیاری)",
    },
};

interface AccountManagementProps {
    onBack?: () => void;
}

export default function AccountManagement({ onBack }: AccountManagementProps) {
    const [showCoaManagement, setShowCoaManagement] = useState(false);
    const [showJournalEntries, setShowJournalEntries] = useState(false);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [coaCategories, setCoaCategories] = useState<CoaCategory[]>([]);
    const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
    const [accountBalances, setAccountBalances] = useState<AccountCurrencyBalance[]>([]);
    const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
    const [loading, setLoading] = useState(false);
    const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
    const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<Account | null>(null);
    const [transactionType, setTransactionType] = useState<"deposit" | "withdraw">("deposit");
    const [accountFormData, setAccountFormData] = useState({
        name: "",
        currency_id: "",
        coa_category_id: "",
        account_code: "",
        account_type: "",
        initial_balance: "",
        is_active: true,
        notes: "",
    });
    const [transactionFormData, setTransactionFormData] = useState({
        amount: "",
        currency: "",
        rate: "1",
        total: "",
        date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
        is_full: false,
        notes: "",
    });

    const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const dbOpen = await isDatabaseOpen();
            if (!dbOpen) {
                await openDatabase("db");
            }

            try {
                await initAccountsTable();
                await initAccountTransactionsTable();
                await initAccountCurrencyBalancesTable();
                // Initialize standard COA categories if they don't exist
                await initStandardCoaCategories().catch(() => {
                    // Categories might already exist, ignore error
                });
            } catch (err) {
                console.log("Table initialization:", err);
            }

            const [accountsData, currenciesData, categoriesData] = await Promise.all([
                getAccounts(),
                getCurrencies(),
                getCoaCategories().catch(() => []),
            ]);

            setAccounts(accountsData);
            setCurrencies(currenciesData);
            setCoaCategories(categoriesData);
        } catch (error: any) {
            toast.error(translations.errors.fetch);
            console.error("Error loading data:", error);
        } finally {
            setLoading(false);
        }
    };

    const loadTransactions = async (accountId: number) => {
        try {
            const [transactionsData, balancesData] = await Promise.all([
                getAccountTransactions(accountId),
                getAllAccountBalances(accountId).catch(() => []),
            ]);
            setTransactions(transactionsData);
            setAccountBalances(balancesData);
        } catch (error: any) {
            console.error("Error loading transactions:", error);
        }
    };

    const calculateTotal = () => {
        const amount = parseFloat(transactionFormData.amount) || 0;
        const rate = parseFloat(transactionFormData.rate) || 1;
        return amount * rate;
    };

    useEffect(() => {
        if (!transactionFormData.is_full) {
            const total = calculateTotal();
            setTransactionFormData(prev => ({ ...prev, total: total.toFixed(2) }));
        }
    }, [transactionFormData.amount, transactionFormData.rate, transactionFormData.is_full]);

    const handleOpenAccountModal = (account?: Account) => {
        if (account) {
            setEditingAccount(account);
            setAccountFormData({
                name: account.name,
                currency_id: account.currency_id?.toString() || "",
                coa_category_id: account.coa_category_id?.toString() || "",
                account_code: account.account_code || "",
                account_type: account.account_type || "",
                initial_balance: account.initial_balance.toString(),
                is_active: account.is_active,
                notes: account.notes || "",
            });
        } else {
            setEditingAccount(null);
            setAccountFormData({
                name: "",
                currency_id: "",
                coa_category_id: "",
                account_code: "",
                account_type: "",
                initial_balance: "",
                is_active: true,
                notes: "",
            });
        }
        setIsAccountModalOpen(true);
    };

    const handleCloseAccountModal = () => {
        setIsAccountModalOpen(false);
        setEditingAccount(null);
        setAccountFormData({
            name: "",
            currency_id: "",
            coa_category_id: "",
            account_code: "",
            account_type: "",
            initial_balance: "",
            is_active: true,
            notes: "",
        });
    };

    const handleOpenTransactionModal = (account: Account, type: "deposit" | "withdraw") => {
        setSelectedAccount(account);
        setTransactionType(type);
        setTransactionFormData({
            amount: "",
            currency: currencies[0]?.name || "",
            rate: "1",
            total: "",
            date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
            is_full: false,
            notes: "",
        });
        setIsTransactionModalOpen(true);
    };

    const handleCloseTransactionModal = () => {
        setIsTransactionModalOpen(false);
        setSelectedAccount(null);
        setTransactionFormData({
            amount: "",
            currency: "",
            rate: "1",
            total: "",
            date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
            is_full: false,
            notes: "",
        });
    };

    const handleAccountSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!accountFormData.name.trim()) {
            toast.error(translations.errors.nameRequired);
            return;
        }

        try {
            setLoading(true);
            if (editingAccount) {
                await updateAccount(
                    editingAccount.id,
                    accountFormData.name,
                    accountFormData.currency_id ? parseInt(accountFormData.currency_id) : null,
                    accountFormData.coa_category_id ? parseInt(accountFormData.coa_category_id) : null,
                    accountFormData.account_code || null,
                    accountFormData.account_type || null,
                    parseFloat(accountFormData.initial_balance) || 0,
                    accountFormData.is_active,
                    accountFormData.notes || null
                );
                toast.success(translations.success.updated);
            } else {
                await createAccount(
                    accountFormData.name,
                    accountFormData.currency_id ? parseInt(accountFormData.currency_id) : null,
                    accountFormData.coa_category_id ? parseInt(accountFormData.coa_category_id) : null,
                    accountFormData.account_code || null,
                    accountFormData.account_type || null,
                    parseFloat(accountFormData.initial_balance) || 0,
                    accountFormData.notes || null
                );
                toast.success(translations.success.created);
            }
            handleCloseAccountModal();
            await loadData();
        } catch (error: any) {
            toast.error(editingAccount ? translations.errors.update : translations.errors.create);
            console.error("Error saving account:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleTransactionSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!selectedAccount) return;

        if (!transactionFormData.currency) {
            toast.error(translations.errors.currencyRequired);
            return;
        }

        if (!transactionFormData.is_full && (!transactionFormData.amount || parseFloat(transactionFormData.amount) <= 0)) {
            toast.error(translations.errors.amountRequired);
            return;
        }

        if (!transactionFormData.date) {
            toast.error(translations.errors.dateRequired);
            return;
        }

        const amount = parseFloat(transactionFormData.amount) || 0;
        const rate = parseFloat(transactionFormData.rate) || 1;

        try {
            setLoading(true);
            if (transactionType === "deposit") {
                await depositAccount(
                    selectedAccount.id,
                    amount,
                    transactionFormData.currency,
                    rate,
                    transactionFormData.date,
                    transactionFormData.is_full,
                    transactionFormData.notes || null
                );
                toast.success(translations.success.deposited);
            } else {
                await withdrawAccount(
                    selectedAccount.id,
                    amount,
                    transactionFormData.currency,
                    rate,
                    transactionFormData.date,
                    transactionFormData.is_full,
                    transactionFormData.notes || null
                );
                toast.success(translations.success.withdrawn);
            }
            handleCloseTransactionModal();
            await loadData();
            if (selectedAccount) {
                await loadTransactions(selectedAccount.id);
            }
        } catch (error: any) {
            const errorMessage = error.toString();
            if (errorMessage.includes("Insufficient") || errorMessage.includes("موجودی")) {
                toast.error(translations.errors.insufficientBalance);
            } else {
                toast.error(transactionType === "deposit" ? translations.errors.deposit : translations.errors.withdraw);
            }
            console.error("Error processing transaction:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: number) => {
        try {
            setLoading(true);
            await deleteAccount(id);
            toast.success(translations.success.deleted);
            setDeleteConfirm(null);
            await loadData();
        } catch (error: any) {
            toast.error(translations.errors.delete);
            console.error("Error deleting account:", error);
        } finally {
            setLoading(false);
        }
    };

    const getCurrencyName = (currencyId: number | null | undefined): string => {
        if (!currencyId) return "نامشخص";
        const currency = currencies.find(c => c.id === currencyId);
        return currency ? currency.name : "نامشخص";
    };

    const handleSelectAccount = async (account: Account) => {
        setSelectedAccount(account);
        await loadTransactions(account.id);
    };

    // If showing COA management, render that component
    if (showCoaManagement) {
        return (
            <CoaManagement 
                onBack={() => {
                    setShowCoaManagement(false);
                    loadData(); // Reload accounts to refresh COA categories
                }} 
            />
        );
    }

    // If showing Journal Entries, render that component
    if (showJournalEntries) {
        return (
            <JournalEntries 
                onBack={() => {
                    setShowJournalEntries(false);
                }} 
            />
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-6" dir="rtl">
            <div className="w-full">
                <PageHeader
                    title={translations.title}
                    onBack={onBack}
                    backLabel={translations.backToDashboard}
                    actions={[
                        {
                            label: "دفتر روزنامه",
                            onClick: () => setShowJournalEntries(true),
                            variant: "secondary" as const,
                            icon: (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                            )
                        },
                        {
                            label: "مدیریت دسته‌بندی حساب‌ها (COA)",
                            onClick: () => setShowCoaManagement(true),
                            variant: "secondary" as const,
                            icon: (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                                </svg>
                            )
                        },
                        {
                            label: translations.addNew,
                            onClick: () => handleOpenAccountModal(),
                            variant: "primary" as const
                        }
                    ]}
                />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Accounts List */}
                    <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-lg p-6">
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">حساب‌ها</h3>
                        {loading && accounts.length === 0 ? (
                            <div className="text-center py-8">
                                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                            </div>
                        ) : accounts.length === 0 ? (
                            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                {translations.noAccounts}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {accounts.map((account) => (
                                    <motion.div
                                        key={account.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        whileHover={{ scale: 1.02 }}
                                        className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                                            selectedAccount?.id === account.id
                                                ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                                                : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 hover:border-purple-300 dark:hover:border-purple-700"
                                        }`}
                                        onClick={() => handleSelectAccount(account)}
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <h4 className="font-bold text-gray-900 dark:text-white text-lg">
                                                {account.name}
                                            </h4>
                                            <div className="flex gap-2">
                                                <motion.button
                                                    whileHover={{ scale: 1.1 }}
                                                    whileTap={{ scale: 0.9 }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleOpenAccountModal(account);
                                                    }}
                                                    className="p-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                                </motion.button>
                                                <motion.button
                                                    whileHover={{ scale: 1.1 }}
                                                    whileTap={{ scale: 0.9 }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDeleteConfirm(account.id);
                                                    }}
                                                    className="p-1.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </motion.button>
                                            </div>
                                        </div>
                                        <div className="text-sm text-gray-600 dark:text-gray-400 mb-2 space-y-1">
                                            <div><span>ارز: {getCurrencyName(account.currency_id)}</span></div>
                                            {account.account_code && (
                                                <div><span>کد: {account.account_code}</span></div>
                                            )}
                                            {account.account_type && (
                                                <div><span>نوع: {account.account_type}</span></div>
                                            )}
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <div>
                                                <span className="text-xs text-gray-500 dark:text-gray-500">موجودی فعلی:</span>
                                                <span className={`font-bold text-lg ml-2 ${
                                                    account.current_balance >= 0
                                                        ? "text-green-600 dark:text-green-400"
                                                        : "text-red-600 dark:text-red-400"
                                                }`}>
                                                    {account.current_balance.toLocaleString()}
                                                </span>
                                            </div>
                                            <div className="flex gap-2">
                                                <motion.button
                                                    whileHover={{ scale: 1.05 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleOpenTransactionModal(account, "deposit");
                                                    }}
                                                    className="px-3 py-1.5 bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-lg text-xs font-semibold hover:bg-green-200 dark:hover:bg-green-900/30 transition-colors"
                                                >
                                                    {translations.deposit}
                                                </motion.button>
                                                <motion.button
                                                    whileHover={{ scale: 1.05 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleOpenTransactionModal(account, "withdraw");
                                                    }}
                                                    className="px-3 py-1.5 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg text-xs font-semibold hover:bg-red-200 dark:hover:bg-red-900/30 transition-colors"
                                                >
                                                    {translations.withdraw}
                                                </motion.button>
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Transaction History */}
                    <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-lg p-6">
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                            {selectedAccount ? `${translations.transactionHistory} - ${selectedAccount.name}` : translations.transactionHistory}
                        </h3>
                        {!selectedAccount ? (
                            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                یک حساب را انتخاب کنید
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {/* Multicurrency Balances */}
                                {accountBalances.length > 0 && (
                                    <div className="mb-4">
                                        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">موجودی‌ها بر اساس ارز:</h4>
                                        <div className="space-y-2">
                                            {accountBalances.map((balance: AccountCurrencyBalance) => {
                                                const currency = currencies.find(c => c.id === balance.currency_id);
                                                return (
                                                    <div key={balance.id} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                                        <span className="text-sm text-gray-700 dark:text-gray-300">{currency?.name || `ارز ${balance.currency_id}`}</span>
                                                        <span className={`font-bold ${
                                                            balance.balance >= 0
                                                                ? "text-green-600 dark:text-green-400"
                                                                : "text-red-600 dark:text-red-400"
                                                        }`}>
                                                            {balance.balance.toLocaleString()}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {/* Transaction History */}
                                {transactions.length === 0 ? (
                                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                        {translations.noTransactions}
                                    </div>
                                ) : (
                                    <div className="space-y-3 max-h-[600px] overflow-y-auto">
                                        {transactions.map((transaction) => (
                                            <motion.div
                                                key={transaction.id}
                                                initial={{ opacity: 0, x: -20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                className={`p-4 rounded-xl border-2 ${
                                                    transaction.transaction_type === "deposit"
                                                        ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10"
                                                        : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10"
                                                }`}
                                            >
                                                <div className="flex justify-between items-start mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${
                                                            transaction.transaction_type === "deposit"
                                                                ? "bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200"
                                                                : "bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200"
                                                        }`}>
                                                            {transaction.transaction_type === "deposit" ? translations.deposit : translations.withdraw}
                                                        </span>
                                                        {transaction.is_full && (
                                                            <span className="px-2 py-1 rounded-lg text-xs font-semibold bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200">
                                                                {translations.full}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className={`font-bold text-lg ${
                                                        transaction.transaction_type === "deposit"
                                                            ? "text-green-600 dark:text-green-400"
                                                            : "text-red-600 dark:text-red-400"
                                                    }`}>
                                                        {transaction.transaction_type === "deposit" ? "+" : "-"}
                                                        {transaction.total.toLocaleString()}
                                                    </span>
                                                </div>
                                                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                                                    <div>
                                                        <span>مقدار: {transaction.amount.toLocaleString()} {transaction.currency}</span>
                                                        <span className="mx-2">•</span>
                                                        <span>نرخ: {transaction.rate}</span>
                                                    </div>
                                                    <div>تاریخ: {formatPersianDate(transaction.transaction_date)}</div>
                                                    {transaction.notes && (
                                                        <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                                                            {transaction.notes}
                                                        </div>
                                                    )}
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Account Form Modal */}
                <AnimatePresence>
                    {isAccountModalOpen && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                            onClick={handleCloseAccountModal}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
                            >
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                                    {editingAccount ? translations.edit : translations.addNew}
                                </h2>
                                <form onSubmit={handleAccountSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.accountName}
                                        </label>
                                        <input
                                            type="text"
                                            value={accountFormData.name}
                                            onChange={(e) => setAccountFormData({ ...accountFormData, name: e.target.value })}
                                            required
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            placeholder={translations.placeholders.accountName}
                                            dir="rtl"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.currency}
                                            </label>
                                            <select
                                                value={accountFormData.currency_id}
                                                onChange={(e) => setAccountFormData({ ...accountFormData, currency_id: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                dir="rtl"
                                            >
                                                <option value="">انتخاب ارز (اختیاری)</option>
                                                {currencies.map((currency) => (
                                                    <option key={currency.id} value={currency.id}>
                                                        {currency.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                دسته COA
                                            </label>
                                            <select
                                                value={accountFormData.coa_category_id}
                                                onChange={(e) => setAccountFormData({ ...accountFormData, coa_category_id: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                dir="rtl"
                                            >
                                                <option value="">انتخاب دسته (اختیاری)</option>
                                                {coaCategories.map((category: CoaCategory) => (
                                                    <option key={category.id} value={category.id}>
                                                        {category.code} - {category.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                کد حساب
                                            </label>
                                            <input
                                                type="text"
                                                value={accountFormData.account_code}
                                                onChange={(e) => setAccountFormData({ ...accountFormData, account_code: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder="کد حساب (اختیاری)"
                                                dir="ltr"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                نوع حساب
                                            </label>
                                            <select
                                                value={accountFormData.account_type}
                                                onChange={(e) => setAccountFormData({ ...accountFormData, account_type: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                dir="rtl"
                                            >
                                                <option value="">انتخاب نوع (اختیاری)</option>
                                                <option value="Asset">دارایی</option>
                                                <option value="Liability">بدهی</option>
                                                <option value="Equity">حقوق صاحبان سهام</option>
                                                <option value="Revenue">درآمد</option>
                                                <option value="Expense">هزینه</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.initialBalance}
                                            </label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={accountFormData.initial_balance}
                                                onChange={(e) => setAccountFormData({ ...accountFormData, initial_balance: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder="0"
                                                dir="ltr"
                                            />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={accountFormData.is_active}
                                                onChange={(e) => setAccountFormData({ ...accountFormData, is_active: e.target.checked })}
                                                className="w-5 h-5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                            />
                                            <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                                حساب فعال
                                            </label>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.notes}
                                        </label>
                                        <textarea
                                            value={accountFormData.notes}
                                            onChange={(e) => setAccountFormData({ ...accountFormData, notes: e.target.value })}
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
                                            onClick={handleCloseAccountModal}
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

                {/* Transaction Modal */}
                <AnimatePresence>
                    {isTransactionModalOpen && selectedAccount && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                            onClick={handleCloseTransactionModal}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
                            >
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                                    {transactionType === "deposit" ? translations.deposit : translations.withdraw} - {selectedAccount.name}
                                </h2>
                                <form onSubmit={handleTransactionSubmit} className="space-y-4">
                                    <div>
                                        <label className="flex items-center gap-2 mb-2">
                                            <input
                                                type="checkbox"
                                                checked={transactionFormData.is_full}
                                                onChange={(e) => {
                                                    setTransactionFormData({
                                                        ...transactionFormData,
                                                        is_full: e.target.checked,
                                                        amount: e.target.checked ? "" : transactionFormData.amount,
                                                    });
                                                }}
                                                className="w-5 h-5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                            />
                                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                                {translations.isFull}
                                            </span>
                                        </label>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.currency}
                                            </label>
                                            <select
                                                value={transactionFormData.currency}
                                                onChange={(e) => setTransactionFormData({ ...transactionFormData, currency: e.target.value })}
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                dir="rtl"
                                            >
                                                <option value="">{translations.placeholders.currency}</option>
                                                {currencies.map((currency) => (
                                                    <option key={currency.id} value={currency.name}>
                                                        {currency.name}
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
                                                value={transactionFormData.amount}
                                                onChange={(e) => setTransactionFormData({ ...transactionFormData, amount: e.target.value })}
                                                disabled={transactionFormData.is_full}
                                                required={!transactionFormData.is_full}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                                placeholder={translations.placeholders.amount}
                                                dir="ltr"
                                            />
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
                                                value={transactionFormData.rate}
                                                onChange={(e) => setTransactionFormData({ ...transactionFormData, rate: e.target.value })}
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
                                                value={transactionFormData.is_full ? "محاسبه می‌شود" : transactionFormData.total}
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
                                            value={transactionFormData.date}
                                            onChange={(date) => setTransactionFormData({ ...transactionFormData, date })}
                                            placeholder={translations.placeholders.date}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.notes}
                                        </label>
                                        <textarea
                                            value={transactionFormData.notes}
                                            onChange={(e) => setTransactionFormData({ ...transactionFormData, notes: e.target.value })}
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
                                            onClick={handleCloseTransactionModal}
                                            className="flex-1 px-4 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-bold rounded-xl transition-colors"
                                        >
                                            {translations.cancel}
                                        </motion.button>
                                        <motion.button
                                            type="submit"
                                            disabled={loading}
                                            whileHover={{ scale: loading ? 1 : 1.05 }}
                                            whileTap={{ scale: loading ? 1 : 0.95 }}
                                            className={`flex-1 px-4 py-3 font-bold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                                                transactionType === "deposit"
                                                    ? "bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white"
                                                    : "bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 text-white"
                                            }`}
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
                                                transactionType === "deposit" ? translations.deposit : translations.withdraw
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

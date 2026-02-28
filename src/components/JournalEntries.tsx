import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { Search, Eye, Copy, Grid, List, Filter, X, Printer, CheckCircle2, XCircle, TrendingUp, TrendingDown, FileText, Edit } from "lucide-react";
import {
    initJournalEntriesTable,
    initJournalEntryLinesTable,
    createJournalEntry,
    getJournalEntries,
    getJournalEntry,
    updateJournalEntry,
    validateJournalEntry,
    type JournalEntry,
    type JournalEntryLine,
    type JournalEntryLineInput,
} from "../utils/journal";
import { getAccounts, type Account } from "../utils/account";
import { getCurrencies, type Currency } from "../utils/currency";
import { isDatabaseOpen, openDatabase } from "../utils/db";
import Footer from "./Footer";
import PersianDatePicker from "./PersianDatePicker";
import { formatPersianDate, getCurrentPersianDate, persianToGeorgian } from "../utils/date";
import PageHeader from "./common/PageHeader";
import Table from "./common/Table";

const translations = {
    title: "دفتر روزنامه",
    addNew: "ایجاد سند جدید",
    edit: "ویرایش",
    delete: "حذف",
    cancel: "لغو",
    save: "ذخیره",
    entryNumber: "شماره سند",
    entryDate: "تاریخ سند",
    description: "شرح",
    account: "حساب",
    currency: "ارز",
    debit: "بدهکار",
    credit: "بستانکار",
    exchangeRate: "نرخ ارز",
    baseAmount: "مبلغ پایه",
    addLine: "افزودن خط",
    removeLine: "حذف",
    backToDashboard: "بازگشت به داشبورد",
    search: "جستجو...",
    filter: "فیلتر",
    view: "مشاهده",
    copy: "کپی",
    print: "چاپ",
    statistics: "آمار",
    totalEntries: "کل اسناد",
    totalDebits: "کل بدهکار",
    totalCredits: "کل بستانکار",
    balanced: "متعادل",
    notBalanced: "نامتعادل",
    viewMode: "نمایش",
    cardView: "کارتی",
    tableView: "جدولی",
    dateFrom: "از تاریخ",
    dateTo: "تا تاریخ",
    referenceType: "نوع مرجع",
    allTypes: "همه",
    manual: "دستی",
    sale: "فروش",
    purchase: "خرید",
    lineDescription: "شرح خط",
    copyEntry: "کپی سند",
    success: {
        created: "سند با موفقیت ایجاد شد",
        copied: "سند با موفقیت کپی شد",
    },
    errors: {
        create: "خطا در ایجاد سند",
        fetch: "خطا در دریافت لیست اسناد",
        notBalanced: "سند متعادل نیست. مجموع بدهکار باید برابر مجموع بستانکار باشد",
        accountRequired: "انتخاب حساب الزامی است",
        dateRequired: "تاریخ الزامی است",
    },
};

interface JournalEntriesProps {
    onBack?: () => void;
}

type JournalEntryFormState = {
    entry_date: string;
    description: string;
    lines: JournalEntryLineInput[];
};

type JournalLineInputValues = { [key: number]: { debit: string; credit: string } };

const getDefaultDate = () => {
    const persianDate = getCurrentPersianDate();
    const georgianDate = persianToGeorgian(persianDate);
    return georgianDate || new Date().toISOString().split('T')[0];
};

export default function JournalEntries({ onBack }: JournalEntriesProps) {
    const [, setEntries] = useState<JournalEntry[]>([]);
    const [allEntries, setAllEntries] = useState<JournalEntry[]>([]); // For client-side filtering
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [viewingEntry, setViewingEntry] = useState<[JournalEntry, JournalEntryLine[]] | null>(null);
    const [editingEntry, setEditingEntry] = useState<[JournalEntry, JournalEntryLine[]] | null>(null);
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(10);
    const [totalItems, setTotalItems] = useState(0);
    const [searchQuery, setSearchQuery] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [referenceTypeFilter, setReferenceTypeFilter] = useState<string>("all");
    const [viewMode, setViewMode] = useState<"card" | "table">("card");
    const [sortBy, setSortBy] = useState("entry_date");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [showFilters, setShowFilters] = useState(false);
    const [accountSearchQueries, setAccountSearchQueries] = useState<{ [key: number]: string }>({});

    const [formData, setFormData] = useState<JournalEntryFormState>({
        entry_date: getDefaultDate(),
        description: "",
        lines: [] as JournalEntryLineInput[],
    });
    const [inputValues, setInputValues] = useState<JournalLineInputValues>({});

    useEffect(() => {
        loadData();
    }, [page, perPage]);

    // Load all entries for client-side filtering
    useEffect(() => {
        loadAllEntries();
    }, []);

    const loadAllEntries = async () => {
        try {
            const dbOpen = await isDatabaseOpen();
            if (!dbOpen) {
                await openDatabase("db");
            }
            // Load a large number to get all entries for filtering
            const entriesData = await getJournalEntries(1, 10000);
            setAllEntries(entriesData.items);
        } catch (error) {
            console.error("Error loading all entries:", error);
        }
    };

    const loadData = async () => {
        try {
            setLoading(true);
            const dbOpen = await isDatabaseOpen();
            if (!dbOpen) {
                await openDatabase("db");
            }

            try {
                await initJournalEntriesTable();
                await initJournalEntryLinesTable();
            } catch (err) {
                console.log("Table initialization:", err);
            }

            const [entriesData, accountsData, currenciesData] = await Promise.all([
                getJournalEntries(page, perPage),
                getAccounts(),
                getCurrencies(),
            ]);

            setEntries(entriesData.items);
            setTotalItems(entriesData.total);
            setAccounts(accountsData);
            setCurrencies(currenciesData);
        } catch (error: any) {
            toast.error(translations.errors.fetch);
            console.error("Error loading data:", error);
        } finally {
            setLoading(false);
        }
    };

    // Filter and sort entries
    const filteredAndSortedEntries = useMemo(() => {
        let filtered = [...allEntries];

        // Search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(entry =>
                entry.entry_number.toLowerCase().includes(query) ||
                (entry.description && entry.description.toLowerCase().includes(query)) ||
                formatPersianDate(entry.entry_date).includes(query)
            );
        }

        // Date range filter
        if (dateFrom) {
            filtered = filtered.filter(entry => entry.entry_date >= dateFrom);
        }
        if (dateTo) {
            filtered = filtered.filter(entry => entry.entry_date <= dateTo);
        }

        // Reference type filter
        if (referenceTypeFilter !== "all") {
            filtered = filtered.filter(entry => entry.reference_type === referenceTypeFilter);
        }

        // Sort
        filtered.sort((a, b) => {
            let aVal: any = a[sortBy as keyof JournalEntry];
            let bVal: any = b[sortBy as keyof JournalEntry];

            if (sortBy === "entry_date") {
                aVal = new Date(aVal).getTime();
                bVal = new Date(bVal).getTime();
            }

            if (sortOrder === "asc") {
                return aVal > bVal ? 1 : -1;
            } else {
                return aVal < bVal ? 1 : -1;
            }
        });

        return filtered;
    }, [allEntries, searchQuery, dateFrom, dateTo, referenceTypeFilter, sortBy, sortOrder]);

    // Paginate filtered entries
    const paginatedEntries = useMemo(() => {
        const start = (page - 1) * perPage;
        const end = start + perPage;
        return filteredAndSortedEntries.slice(start, end);
    }, [filteredAndSortedEntries, page, perPage]);

    // Update total items when filters change
    useEffect(() => {
        setTotalItems(filteredAndSortedEntries.length);
        if (page > Math.ceil(filteredAndSortedEntries.length / perPage)) {
            setPage(1);
        }
    }, [filteredAndSortedEntries.length, perPage]);

    // Statistics
    const statistics = useMemo(() => {
        return {
            totalEntries: allEntries.length,
            totalDebits: 0, // Calculated per entry when viewing (would require loading all entry lines)
            totalCredits: 0, // Calculated per entry when viewing (would require loading all entry lines)
        };
    }, [allEntries]);

    const handleViewEntry = async (id: number) => {
        try {
            const entryData = await getJournalEntry(id);
            setViewingEntry(entryData);
            setIsViewModalOpen(true);
        } catch (error: any) {
            toast.error("خطا در دریافت جزئیات سند");
            console.error("Error loading entry:", error);
        }
    };

    const handleCopyEntry = async (entry: JournalEntry) => {
        try {
            const entryData = await getJournalEntry(entry.id);
            setFormData({
                entry_date: getDefaultDate(),
                description: entryData[0].description || "",
                lines: entryData[1].map(line => ({
                    account_id: line.account_id,
                    currency_id: line.currency_id,
                    debit_amount: line.debit_amount,
                    credit_amount: line.credit_amount,
                    exchange_rate: line.exchange_rate,
                    description: line.description,
                })),
            });
            setInputValues({});
            setEditingEntry(null);
            setIsModalOpen(true);
            toast.success(translations.success.copied);
        } catch (error: any) {
            toast.error("خطا در کپی سند");
            console.error("Error copying entry:", error);
        }
    };

    const handleEditEntry = async (entry: JournalEntry) => {
        try {
            const entryData = await getJournalEntry(entry.id);
            setEditingEntry(entryData);
            setFormData({
                entry_date: entryData[0].entry_date,
                description: entryData[0].description || "",
                lines: entryData[1].map(line => ({
                    account_id: line.account_id,
                    currency_id: line.currency_id,
                    debit_amount: line.debit_amount,
                    credit_amount: line.credit_amount,
                    exchange_rate: line.exchange_rate,
                    description: line.description,
                })),
            });
            // Initialize input values from existing lines
            const initialInputValues: JournalLineInputValues = {};
            entryData[1].forEach((line, index) => {
                initialInputValues[index] = {
                    debit: line.debit_amount > 0 ? line.debit_amount.toString() : '',
                    credit: line.credit_amount > 0 ? line.credit_amount.toString() : ''
                };
            });
            setInputValues(initialInputValues);
            setAccountSearchQueries({});
            setIsModalOpen(true);
        } catch (error: any) {
            toast.error("خطا در بارگذاری سند برای ویرایش");
            console.error("Error loading entry for edit:", error);
        }
    };

    const handlePrint = () => {
        window.print();
    };

    const addLine = useCallback(() => {
        if (currencies.length === 0) {
            toast.error("لطفا ابتدا ارز ایجاد کنید");
            return;
        }
        setFormData(prev => {
            const newIndex = prev.lines.length;
            setInputValues(prevInputs => ({
                ...prevInputs,
                [newIndex]: { debit: '', credit: '' }
            }));
            setAccountSearchQueries(prevQueries => ({
                ...prevQueries,
                [newIndex]: ''
            }));
            return {
                ...prev,
                lines: [
                    ...prev.lines,
                    {
                        account_id: 0,
                        currency_id: currencies[0].id,
                        debit_amount: 0,
                        credit_amount: 0,
                        exchange_rate: 1,
                        description: null,
                    },
                ],
            };
        });
    }, [currencies]);

    const removeLine = useCallback((index: number) => {
        setFormData(prev => ({
            ...prev,
            lines: prev.lines.filter((_, i) => i !== index),
        }));
        setInputValues((prev: { [key: number]: { debit: string; credit: string } }) => {
            const newInputValues = { ...prev };
            delete newInputValues[index];
            // Reindex remaining inputs
            const reindexed: { [key: number]: { debit: string; credit: string } } = {};
            Object.keys(newInputValues).forEach((key) => {
                const oldIndex = parseInt(key);
                if (oldIndex > index) {
                    reindexed[oldIndex - 1] = newInputValues[oldIndex];
                } else if (oldIndex < index) {
                    reindexed[oldIndex] = newInputValues[oldIndex];
                }
            });
            return reindexed;
        });
        setAccountSearchQueries(prev => {
            const newAccountQueries = { ...prev };
            delete newAccountQueries[index];
            // Reindex remaining queries
            const reindexedQueries: { [key: number]: string } = {};
            Object.keys(newAccountQueries).forEach((key) => {
                const oldIndex = parseInt(key);
                if (oldIndex > index) {
                    reindexedQueries[oldIndex - 1] = newAccountQueries[oldIndex] || '';
                } else if (oldIndex < index) {
                    reindexedQueries[oldIndex] = newAccountQueries[oldIndex] || '';
                }
            });
            return reindexedQueries;
        });
    }, []);

    const copyLine = useCallback((index: number) => {
        setFormData(prev => {
            const lineToCopy = prev.lines[index];
            const newIndex = prev.lines.length;
            setInputValues(prevInputs => ({
                ...prevInputs,
                [newIndex]: {
                    debit: lineToCopy.debit_amount > 0 ? lineToCopy.debit_amount.toString() : '',
                    credit: lineToCopy.credit_amount > 0 ? lineToCopy.credit_amount.toString() : ''
                }
            }));
            setAccountSearchQueries(prevQueries => ({
                ...prevQueries,
                [newIndex]: ''
            }));
            return {
                ...prev,
                lines: [
                    ...prev.lines,
                    {
                        ...lineToCopy,
                        account_id: lineToCopy.account_id,
                        currency_id: lineToCopy.currency_id,
                        debit_amount: lineToCopy.debit_amount,
                        credit_amount: lineToCopy.credit_amount,
                        exchange_rate: lineToCopy.exchange_rate,
                        description: lineToCopy.description,
                    },
                ],
            };
        });
    }, []);

    const updateLine = useCallback((index: number, field: keyof JournalEntryLineInput, value: any) => {
        setFormData(prev => {
            const newLines = [...prev.lines];
            newLines[index] = { ...newLines[index], [field]: value };
            return { ...prev, lines: newLines };
        });
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.entry_date) {
            toast.error(translations.errors.dateRequired);
            return;
        }

        if (formData.lines.length === 0) {
            toast.error("حداقل یک خط الزامی است");
            return;
        }

        // Validate all lines
        for (let i = 0; i < formData.lines.length; i++) {
            const line = formData.lines[i];
            if (!line.account_id || line.account_id === 0) {
                toast.error(`خط ${i + 1}: انتخاب حساب الزامی است`);
                return;
            }
            if (!line.currency_id || line.currency_id === 0) {
                toast.error(`خط ${i + 1}: انتخاب ارز الزامی است`);
                return;
            }
            if (line.debit_amount === 0 && line.credit_amount === 0) {
                toast.error(`خط ${i + 1}: باید بدهکار یا بستانکار داشته باشد`);
                return;
            }
            if (line.debit_amount > 0 && line.credit_amount > 0) {
                toast.error(`خط ${i + 1}: نمی‌تواند هم بدهکار و هم بستانکار باشد`);
                return;
            }
        }


        try {
            setLoading(true);
            if (editingEntry) {
                // Update existing entry
                await updateJournalEntry(editingEntry[0].id, formData.lines);
                toast.success("سند با موفقیت به‌روزرسانی شد");
            } else {
                // Create new entry
                await createJournalEntry(
                    formData.entry_date,
                    formData.description || null,
                    "manual",
                    null,
                    formData.lines
                );
                toast.success(translations.success.created);
            }
            setIsModalOpen(false);
            setEditingEntry(null);
            setFormData({
                entry_date: getDefaultDate(),
                description: "",
                lines: [],
            });
            setInputValues({});
            setAccountSearchQueries({});
            await loadData();
            await loadAllEntries();
        } catch (error: any) {
            toast.error(editingEntry ? "خطا در به‌روزرسانی سند" : translations.errors.create);
            console.error("Error saving entry:", error);
        } finally {
            setLoading(false);
        }
    };

    const calculateTotalDebits = () => {
        return formData.lines.reduce((sum, line) => sum + line.debit_amount, 0);
    };

    const calculateTotalCredits = () => {
        return formData.lines.reduce((sum, line) => sum + line.credit_amount, 0);
    };

    const getAccountName = (accountId: number) => {
        return accounts.find(a => a.id === accountId)?.name || `ID: ${accountId}`;
    };

    const getCurrencyName = (currencyId: number) => {
        return currencies.find(c => c.id === currencyId)?.name || `ID: ${currencyId}`;
    };

    // Get filtered accounts for searchable dropdown
    const getFilteredAccounts = useCallback((index: number) => {
        const query = accountSearchQueries[index]?.toLowerCase() || '';
        if (!query) return accounts;
        return accounts.filter(account =>
            account.name.toLowerCase().includes(query) ||
            (account.account_code && account.account_code.toLowerCase().includes(query))
        );
    }, [accounts, accountSearchQueries]);

    // Calculate entry totals (requires loading lines)
    const getEntryTotals = useCallback(async (entryId: number) => {
        try {
            const entryData = await getJournalEntry(entryId);
            const debits = entryData[1].reduce((sum, line) => sum + line.debit_amount, 0);
            const credits = entryData[1].reduce((sum, line) => sum + line.credit_amount, 0);
            return { debits, credits, lines: entryData[1].length };
        } catch {
            return { debits: 0, credits: 0, lines: 0 };
        }
    }, []);

    // Table columns
    const tableColumns = [
        {
            key: "entry_number",
            label: translations.entryNumber,
            sortable: true,
            render: (entry: JournalEntry) => (
                <span className="font-bold text-purple-600 dark:text-purple-400">{entry.entry_number}</span>
            ),
        },
        {
            key: "entry_date",
            label: translations.entryDate,
            sortable: true,
            render: (entry: JournalEntry) => formatPersianDate(entry.entry_date),
        },
        {
            key: "description",
            label: translations.description,
            render: (entry: JournalEntry) => entry.description || "-",
        },
        {
            key: "reference_type",
            label: translations.referenceType,
            render: (entry: JournalEntry) => (
                entry.reference_type ? (
                    <span className="px-2 py-1 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs">
                        {entry.reference_type}
                    </span>
                ) : "-"
            ),
        },
    ];

    const tableActions = (entry: JournalEntry) => (
        <div className="flex gap-2">
            <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => {
                    e.stopPropagation();
                    handleViewEntry(entry.id);
                }}
                className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                title={translations.view}
            >
                <Eye className="w-4 h-4" />
            </motion.button>
            <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => {
                    e.stopPropagation();
                    handleEditEntry(entry);
                }}
                className="p-2 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded-lg transition-colors"
                title={translations.edit}
            >
                <Edit className="w-4 h-4" />
            </motion.button>
            <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => {
                    e.stopPropagation();
                    handleCopyEntry(entry);
                }}
                className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
                title={translations.copy}
            >
                <Copy className="w-4 h-4" />
            </motion.button>
        </div>
    );

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4 md:p-6" dir="rtl">
            <div className="w-full">
                <PageHeader
                    title={translations.title}
                    onBack={onBack}
                    backLabel={translations.backToDashboard}
                    actions={[
                        {
                            label: translations.addNew,
                            onClick: () => setIsModalOpen(true),
                            variant: "primary" as const
                        }
                    ]}
                />

                {/* Statistics Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-lg p-6 border border-purple-100 dark:border-purple-900/30"
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{translations.totalEntries}</p>
                                <p className="text-2xl font-bold text-gray-900 dark:text-white">{statistics.totalEntries}</p>
                            </div>
                            <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-xl">
                                <FileText className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                            </div>
                        </div>
                    </motion.div>
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-lg p-6 border border-green-100 dark:border-green-900/30"
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{translations.totalDebits}</p>
                                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                                    {statistics.totalDebits.toLocaleString('en-US')}
                                </p>
                            </div>
                            <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-xl">
                                <TrendingUp className="w-6 h-6 text-green-600 dark:text-green-400" />
                            </div>
                        </div>
                    </motion.div>
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-lg p-6 border border-red-100 dark:border-red-900/30"
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{translations.totalCredits}</p>
                                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                                    {statistics.totalCredits.toLocaleString('en-US')}
                                </p>
                            </div>
                            <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-xl">
                                <TrendingDown className="w-6 h-6 text-red-600 dark:text-red-400" />
                            </div>
                        </div>
                    </motion.div>
                </div>

                {/* Search and Filters */}
                <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-lg p-4 md:p-6 mb-6">
                    <div className="flex flex-col md:flex-row gap-4 mb-4">
                        {/* Search Bar */}
                        <div className="relative flex-1">
                            <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none z-10">
                                <Search className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                            </div>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    setPage(1);
                                }}
                                className="block w-full pr-12 pl-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl leading-5 bg-white dark:bg-gray-700 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 sm:text-sm transition-all"
                                placeholder={translations.search}
                                dir="rtl"
                            />
                        </div>

                        {/* View Mode Toggle */}
                        <div className="flex gap-2">
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => setViewMode("card")}
                                className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
                                    viewMode === "card"
                                        ? "bg-purple-600 text-white shadow-lg"
                                        : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                                }`}
                            >
                                <Grid className="w-4 h-4" />
                                <span className="hidden sm:inline">{translations.cardView}</span>
                            </motion.button>
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => setViewMode("table")}
                                className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
                                    viewMode === "table"
                                        ? "bg-purple-600 text-white shadow-lg"
                                        : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                                }`}
                            >
                                <List className="w-4 h-4" />
                                <span className="hidden sm:inline">{translations.tableView}</span>
                            </motion.button>
                        </div>

                        {/* Filter Toggle */}
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setShowFilters(!showFilters)}
                            className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 ${
                                showFilters
                                    ? "bg-purple-600 text-white shadow-lg"
                                    : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                            }`}
                        >
                            <Filter className="w-4 h-4" />
                            <span className="hidden sm:inline">{translations.filter}</span>
                        </motion.button>
                    </div>

                    {/* Advanced Filters */}
                    <AnimatePresence>
                        {showFilters && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700"
                            >
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        {translations.dateFrom}
                                    </label>
                                    <PersianDatePicker
                                        value={dateFrom}
                                        onChange={(date) => {
                                            setDateFrom(date);
                                            setPage(1);
                                        }}
                                        placeholder="از تاریخ"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        {translations.dateTo}
                                    </label>
                                    <PersianDatePicker
                                        value={dateTo}
                                        onChange={(date) => {
                                            setDateTo(date);
                                            setPage(1);
                                        }}
                                        placeholder="تا تاریخ"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        {translations.referenceType}
                                    </label>
                                    <select
                                        value={referenceTypeFilter}
                                        onChange={(e) => {
                                            setReferenceTypeFilter(e.target.value);
                                            setPage(1);
                                        }}
                                        className="w-full px-4 py-2 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500"
                                        dir="rtl"
                                    >
                                        <option value="all">{translations.allTypes}</option>
                                        <option value="manual">{translations.manual}</option>
                                        <option value="sale">{translations.sale}</option>
                                        <option value="purchase">{translations.purchase}</option>
                                    </select>
                                </div>
                                {(dateFrom || dateTo || referenceTypeFilter !== "all") && (
                                    <div className="md:col-span-3 flex justify-end">
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => {
                                                setDateFrom("");
                                                setDateTo("");
                                                setReferenceTypeFilter("all");
                                            }}
                                            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl flex items-center gap-2"
                                        >
                                            <X className="w-4 h-4" />
                                            پاک کردن فیلترها
                                        </motion.button>
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Entries List */}
                <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-lg p-4 md:p-6">
                    {loading && paginatedEntries.length === 0 ? (
                        <div className="text-center py-12">
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                className="inline-block w-8 h-8 border-2 border-purple-600 border-t-transparent rounded-full"
                            />
                        </div>
                    ) : paginatedEntries.length === 0 ? (
                        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                            <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
                            <p className="text-lg">هیچ سندی یافت نشد</p>
                        </div>
                    ) : viewMode === "table" ? (
                        <Table
                            data={paginatedEntries}
                            columns={tableColumns}
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
                            actions={tableActions}
                        />
                    ) : (
                        <div className="space-y-4">
                            {paginatedEntries.map((entry) => (
                                <EntryCard
                                    key={entry.id}
                                    entry={entry}
                                    accounts={accounts}
                                    currencies={currencies}
                                    onView={handleViewEntry}
                                    onEdit={handleEditEntry}
                                    onCopy={handleCopyEntry}
                                    getEntryTotals={getEntryTotals}
                                />
                            ))}
                        </div>
                    )}

                    {/* Pagination for Card View */}
                    {viewMode === "card" && totalItems > perPage && (
                        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                                نمایش {(page - 1) * perPage + 1} تا {Math.min(page * perPage, totalItems)} از {totalItems}
                            </div>
                            <div className="flex gap-2">
                                <select
                                    value={perPage}
                                    onChange={(e) => {
                                        setPerPage(Number(e.target.value));
                                        setPage(1);
                                    }}
                                    className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
                                >
                                    <option value={5}>5</option>
                                    <option value={10}>10</option>
                                    <option value={20}>20</option>
                                    <option value={50}>50</option>
                                </select>
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1}
                                    className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    قبلی
                                </button>
                                <button
                                    onClick={() => setPage(p => p + 1)}
                                    disabled={page >= Math.ceil(totalItems / perPage)}
                                    className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    بعدی
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Create Entry Modal */}
                <AnimatePresence>
                    {isModalOpen && (
                        <CreateEntryModal
                            formData={formData}
                            setFormData={setFormData}
                            inputValues={inputValues}
                            setInputValues={setInputValues}
                            accounts={accounts}
                            currencies={currencies}
                            accountSearchQueries={accountSearchQueries}
                            setAccountSearchQueries={setAccountSearchQueries}
                            getFilteredAccounts={getFilteredAccounts}
                            updateLine={updateLine}
                            addLine={addLine}
                            removeLine={removeLine}
                            copyLine={copyLine}
                            calculateTotalDebits={calculateTotalDebits}
                            calculateTotalCredits={calculateTotalCredits}
                            validateJournalEntry={validateJournalEntry}
                            handleSubmit={handleSubmit}
                            loading={loading}
                            editingEntry={editingEntry}
                            onClose={() => {
                                setIsModalOpen(false);
                                setEditingEntry(null);
                                setFormData({
                                    entry_date: getDefaultDate(),
                                    description: "",
                                    lines: [],
                                });
                                setInputValues({});
                                setAccountSearchQueries({});
                            }}
                            translations={translations}
                        />
                    )}
                </AnimatePresence>

                {/* View Entry Modal */}
                <AnimatePresence>
                    {isViewModalOpen && viewingEntry && (
                        <ViewEntryModal
                            entry={viewingEntry[0]}
                            lines={viewingEntry[1]}
                            accounts={accounts}
                            currencies={currencies}
                            getAccountName={getAccountName}
                            getCurrencyName={getCurrencyName}
                            formatPersianDate={formatPersianDate}
                            onClose={() => setIsViewModalOpen(false)}
                            onEdit={handleEditEntry}
                            onPrint={handlePrint}
                            translations={translations}
                        />
                    )}
                </AnimatePresence>

                <Footer />
            </div>
        </div>
    );
}

// Entry Card Component
function EntryCard({
    entry,
    accounts: _accounts,
    currencies: _currencies,
    onView,
    onEdit,
    onCopy,
    getEntryTotals,
}: {
    entry: JournalEntry;
    accounts: Account[];
    currencies: Currency[];
    onView: (id: number) => void;
    onEdit: (entry: JournalEntry) => void;
    onCopy: (entry: JournalEntry) => void;
    getEntryTotals: (id: number) => Promise<{ debits: number; credits: number; lines: number }>;
}) {
    const [totals, setTotals] = useState<{ debits: number; credits: number; lines: number } | null>(null);
    const [loadingTotals, setLoadingTotals] = useState(true);

    useEffect(() => {
        let cancelled = false;
        getEntryTotals(entry.id).then(data => {
            if (!cancelled) {
                setTotals(data);
                setLoadingTotals(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [entry.id]);

    const isBalanced = totals ? Math.abs(totals.debits - totals.credits) < 0.01 : true;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 md:p-6 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white to-gray-50 dark:from-gray-700/50 dark:to-gray-800/50 cursor-pointer hover:border-purple-500 dark:hover:border-purple-700 transition-all shadow-md hover:shadow-lg"
            onClick={() => onView(entry.id)}
        >
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg md:text-xl font-bold text-gray-900 dark:text-white">
                            {entry.entry_number}
                        </h3>
                        {isBalanced ? (
                            <span title="متعادل">
                                <CheckCircle2 className="w-5 h-5 text-green-500" />
                            </span>
                        ) : (
                            <span title="نامتعادل">
                                <XCircle className="w-5 h-5 text-red-500" />
                            </span>
                        )}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                        {formatPersianDate(entry.entry_date)}
                    </div>
                    {entry.description && (
                        <div className="text-sm text-gray-500 dark:text-gray-500 mb-2 line-clamp-2">
                            {entry.description}
                        </div>
                    )}
                    {loadingTotals ? (
                        <div className="flex gap-4 mt-2">
                            <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                            <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                        </div>
                    ) : totals && (
                        <div className="flex flex-wrap gap-4 mt-2 text-sm">
                            <span className="text-green-600 dark:text-green-400 font-semibold">
                                بدهکار: {totals.debits.toLocaleString('en-US')}
                            </span>
                            <span className="text-red-600 dark:text-red-400 font-semibold">
                                بستانکار: {totals.credits.toLocaleString('en-US')}
                            </span>
                            <span className="text-gray-500 dark:text-gray-400">
                                {totals.lines} خط
                            </span>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {entry.reference_type && (
                        <span className="px-3 py-1 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs font-semibold">
                            {entry.reference_type}
                        </span>
                    )}
                    <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={(e) => {
                            e.stopPropagation();
                            onView(entry.id);
                        }}
                        className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                        title="مشاهده"
                    >
                        <Eye className="w-5 h-5" />
                    </motion.button>
                    <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit(entry);
                        }}
                        className="p-2 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded-lg transition-colors"
                        title="ویرایش"
                    >
                        <Edit className="w-5 h-5" />
                    </motion.button>
                    <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={(e) => {
                            e.stopPropagation();
                            onCopy(entry);
                        }}
                        className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
                        title="کپی"
                    >
                        <Copy className="w-5 h-5" />
                    </motion.button>
                </div>
            </div>
        </motion.div>
    );
}

// Create Entry Modal Component
function CreateEntryModal({
    formData,
    setFormData,
    inputValues,
    setInputValues,
    accounts: _accounts,
    currencies,
    accountSearchQueries,
    setAccountSearchQueries,
    getFilteredAccounts,
    updateLine,
    addLine,
    removeLine,
    copyLine,
    calculateTotalDebits,
    calculateTotalCredits,
    validateJournalEntry,
    handleSubmit,
    loading,
    editingEntry,
    onClose,
    translations,
}: any) {
    const isBalanced = validateJournalEntry(formData.lines);
    const totalDebits = calculateTotalDebits();
    const totalCredits = calculateTotalCredits();
    const difference = Math.abs(totalDebits - totalCredits);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-6 md:p-8 w-full max-w-6xl max-h-[90vh] overflow-y-auto my-8"
            >
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                        {editingEntry ? `ویرایش سند ${editingEntry[0].entry_number}` : translations.addNew}
                    </h2>
                    <button
                        onClick={onClose}
                        className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.entryDate} <span className="text-red-500">*</span>
                                            </label>
                                            <PersianDatePicker
                                                value={formData.entry_date}
                                                onChange={(date) => setFormData({ ...formData, entry_date: date })}
                                                placeholder="تاریخ را انتخاب کنید"
                                                required
                                                disabled={!!editingEntry}
                                            />
                                            {editingEntry && (
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                    تاریخ قابل تغییر نیست
                                                </p>
                                            )}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.description}
                                            </label>
                                            <input
                                                type="text"
                                                value={formData.description}
                                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                                placeholder="شرح سند"
                                                dir="rtl"
                                                disabled={!!editingEntry}
                                            />
                                            {editingEntry && (
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                    شرح قابل تغییر نیست
                                                </p>
                                            )}
                                        </div>
                                    </div>

                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                                خطوط سند <span className="text-red-500">*</span>
                            </label>
                            <motion.button
                                type="button"
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={addLine}
                                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-sm flex items-center gap-2"
                            >
                                <span>+</span>
                                {translations.addLine}
                            </motion.button>
                        </div>

                        <div className="space-y-3 max-h-96 overflow-y-auto">
                            {formData.lines.map((line: JournalEntryLineInput, index: number) => (
                                <motion.div
                                    key={index}
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl border-2 border-gray-200 dark:border-gray-600"
                                >
                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                                        {/* Account - Searchable */}
                                        <div className="col-span-12 md:col-span-3">
                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                {translations.account} <span className="text-red-500">*</span>
                                            </label>
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={accountSearchQueries[index] || ''}
                                                    onChange={(e) => setAccountSearchQueries({
                                                        ...accountSearchQueries,
                                                        [index]: e.target.value
                                                    })}
                                                    onFocus={() => {
                                                        if (!accountSearchQueries[index]) {
                                                            setAccountSearchQueries({
                                                                ...accountSearchQueries,
                                                                [index]: ''
                                                            });
                                                        }
                                                    }}
                                                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500 mb-2"
                                                    placeholder="جستجو حساب..."
                                                    dir="rtl"
                                                />
                                                <select
                                                    value={line.account_id}
                                                    onChange={(e) => updateLine(index, 'account_id', parseInt(e.target.value))}
                                                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500"
                                                    dir="rtl"
                                                >
                                                    <option value={0}>انتخاب حساب</option>
                                                    {getFilteredAccounts(index).map((account: Account) => (
                                                        <option key={account.id} value={account.id}>
                                                            {account.name} {account.account_code ? `(${account.account_code})` : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>

                                        {/* Currency */}
                                        <div className="col-span-12 md:col-span-2">
                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                {translations.currency} <span className="text-red-500">*</span>
                                            </label>
                                            <select
                                                value={line.currency_id}
                                                onChange={(e) => updateLine(index, 'currency_id', parseInt(e.target.value))}
                                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500"
                                                dir="rtl"
                                            >
                                                {currencies.map((currency: Currency) => (
                                                    <option key={currency.id} value={currency.id}>
                                                        {currency.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Debit */}
                                        <div className="col-span-12 md:col-span-2">
                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                {translations.debit}
                                            </label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                value={inputValues[index]?.debit !== undefined ? inputValues[index].debit : (line.debit_amount > 0 ? line.debit_amount.toString() : '')}
                                                onChange={(e) => {
                                                    const inputValue = e.target.value;
                                                    if (!(inputValue === "" || /^\d*\.?\d*$/.test(inputValue))) return;
                                                    // Only update the current field during typing - don't clear the opposite field yet
                                                    setInputValues((prev: { [key: number]: { debit: string; credit: string } }) => {
                                                        const prevRow = prev[index] || { debit: "", credit: "" };
                                                        return {
                                                            ...prev,
                                                            [index]: {
                                                                debit: inputValue,
                                                                credit: prevRow.credit, // Keep existing credit value
                                                            },
                                                        };
                                                    });
                                                }}
                                                onBlur={(e) => {
                                                    const inputValue = e.target.value.trim();
                                                    const numValue = inputValue === "" ? 0 : parseFloat(inputValue);
                                                    if (Number.isNaN(numValue) || numValue < 0) {
                                                        // reset to last saved line value
                                                        setInputValues((prev: { [key: number]: { debit: string; credit: string } }) => {
                                                            const prevRow = prev[index] || { debit: "", credit: "" };
                                                            return {
                                                                ...prev,
                                                                [index]: {
                                                                    ...prevRow,
                                                                    debit: line.debit_amount > 0 ? String(line.debit_amount) : "",
                                                                },
                                                            };
                                                        });
                                                        return;
                                                    }

                                                    const finalDebit = numValue;
                                                    
                                                    // Update inputValues - keep both values, don't clear credit
                                                    setInputValues((prev: { [key: number]: { debit: string; credit: string } }) => {
                                                        const prevRow = prev[index] || { debit: "", credit: "" };
                                                        return {
                                                            ...prev,
                                                            [index]: {
                                                                debit: finalDebit > 0 ? String(finalDebit) : "",
                                                                credit: prevRow.credit, // Keep credit value - never clear it
                                                            },
                                                        };
                                                    });

                                                    // Update formData - only update debit_amount, don't touch credit_amount
                                                    // Validation on submit will ensure only one field has a value per line
                                                    updateLine(index, "debit_amount", finalDebit);
                                                }}
                                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500"
                                                dir="ltr"
                                                placeholder="0"
                                            />
                                        </div>

                                        {/* Credit */}
                                        <div className="col-span-12 md:col-span-2">
                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                {translations.credit}
                                            </label>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                value={inputValues[index]?.credit !== undefined ? inputValues[index].credit : (line.credit_amount > 0 ? line.credit_amount.toString() : '')}
                                                onChange={(e) => {
                                                    const inputValue = e.target.value;
                                                    if (!(inputValue === "" || /^\d*\.?\d*$/.test(inputValue))) return;
                                                    // Only update the current field during typing - don't clear the opposite field yet
                                                    setInputValues((prev: { [key: number]: { debit: string; credit: string } }) => {
                                                        const prevRow = prev[index] || { debit: "", credit: "" };
                                                        return {
                                                            ...prev,
                                                            [index]: {
                                                                debit: prevRow.debit, // Keep existing debit value
                                                                credit: inputValue,
                                                            },
                                                        };
                                                    });
                                                }}
                                                onBlur={(e) => {
                                                    const inputValue = e.target.value.trim();
                                                    const numValue = inputValue === "" ? 0 : parseFloat(inputValue);
                                                    if (Number.isNaN(numValue) || numValue < 0) {
                                                        setInputValues((prev: { [key: number]: { debit: string; credit: string } }) => {
                                                            const prevRow = prev[index] || { debit: "", credit: "" };
                                                            return {
                                                                ...prev,
                                                                [index]: {
                                                                    ...prevRow,
                                                                    credit: line.credit_amount > 0 ? String(line.credit_amount) : "",
                                                                },
                                                            };
                                                        });
                                                        return;
                                                    }

                                                    const finalCredit = numValue;
                                                    
                                                    // Update inputValues - keep both values, don't clear debit
                                                    setInputValues((prev: { [key: number]: { debit: string; credit: string } }) => {
                                                        const prevRow = prev[index] || { debit: "", credit: "" };
                                                        return {
                                                            ...prev,
                                                            [index]: {
                                                                debit: prevRow.debit, // Keep debit value - never clear it
                                                                credit: finalCredit > 0 ? String(finalCredit) : "",
                                                            },
                                                        };
                                                    });

                                                    // Update formData - only update credit_amount, don't touch debit_amount
                                                    // Validation on submit will ensure only one field has a value per line
                                                    updateLine(index, "credit_amount", finalCredit);
                                                }}
                                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500"
                                                dir="ltr"
                                                placeholder="0"
                                            />
                                        </div>

                                        {/* Exchange Rate */}
                                        <div className="col-span-12 md:col-span-2">
                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                {translations.exchangeRate}
                                            </label>
                                            <input
                                                type="number"
                                                step="0.0001"
                                                value={line.exchange_rate}
                                                onChange={(e) => updateLine(index, 'exchange_rate', parseFloat(e.target.value) || 1)}
                                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500"
                                                dir="ltr"
                                            />
                                        </div>

                                        {/* Actions */}
                                        <div className="col-span-12 md:col-span-1 flex gap-1">
                                            <motion.button
                                                type="button"
                                                whileHover={{ scale: 1.1 }}
                                                whileTap={{ scale: 0.9 }}
                                                onClick={() => copyLine(index)}
                                                className="flex-1 px-2 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-xs"
                                                title="کپی خط"
                                            >
                                                <Copy className="w-4 h-4 mx-auto" />
                                            </motion.button>
                                            <motion.button
                                                type="button"
                                                whileHover={{ scale: 1.1 }}
                                                whileTap={{ scale: 0.9 }}
                                                onClick={() => removeLine(index)}
                                                className="flex-1 px-2 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-xs"
                                                title="حذف"
                                            >
                                                <X className="w-4 h-4 mx-auto" />
                                            </motion.button>
                                        </div>
                                    </div>

                                    {/* Line Description */}
                                    <div className="mt-3">
                                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                            {translations.lineDescription}
                                        </label>
                                        <input
                                            type="text"
                                            value={line.description || ''}
                                            onChange={(e) => updateLine(index, 'description', e.target.value || null)}
                                            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500"
                                            placeholder="شرح خط (اختیاری)"
                                            dir="rtl"
                                        />
                                    </div>
                                </motion.div>
                            ))}
                        </div>

                        {/* Totals Summary */}
                        {formData.lines.length > 0 && (
                            <div className={`mt-4 p-4 rounded-xl border-2 ${
                                isBalanced 
                                    ? 'bg-gradient-to-r from-green-100 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/30 border-green-300 dark:border-green-700' 
                                    : 'bg-gradient-to-r from-red-100 to-pink-100 dark:from-red-900/30 dark:to-pink-900/30 border-red-300 dark:border-red-700'
                            }`}>
                                <div className="flex items-center gap-2 mb-3">
                                    {isBalanced ? (
                                        <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                                    ) : (
                                        <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                                    )}
                                    <span className={`font-bold text-lg ${
                                        isBalanced 
                                            ? 'text-green-700 dark:text-green-300' 
                                            : 'text-red-700 dark:text-red-300'
                                    }`}>
                                        {isBalanced ? translations.balanced : translations.notBalanced}
                                    </span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="flex justify-between items-center">
                                        <span className="font-semibold text-gray-900 dark:text-white">
                                            {translations.totalDebits}:
                                        </span>
                                        <span className={`font-bold text-lg ${
                                            isBalanced 
                                                ? "text-green-600 dark:text-green-400" 
                                                : "text-gray-700 dark:text-gray-300"
                                        }`}>
                                            {totalDebits.toLocaleString('en-US')}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="font-semibold text-gray-900 dark:text-white">
                                            {translations.totalCredits}:
                                        </span>
                                        <span className={`font-bold text-lg ${
                                            isBalanced 
                                                ? "text-green-600 dark:text-green-400" 
                                                : "text-gray-700 dark:text-gray-300"
                                        }`}>
                                            {totalCredits.toLocaleString('en-US')}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="font-semibold text-gray-900 dark:text-white">
                                            تفاوت:
                                        </span>
                                        <span className={`font-bold text-lg ${
                                            isBalanced 
                                                ? "text-green-600 dark:text-green-400" 
                                                : "text-red-600 dark:text-red-400"
                                        }`}>
                                            {difference.toLocaleString('en-US')}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex gap-3 pt-4">
                        <motion.button
                            type="button"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={onClose}
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
    );
}

// View Entry Modal Component
function ViewEntryModal({
    entry,
    lines,
    accounts: _accounts,
    currencies: _currencies,
    getAccountName,
    getCurrencyName,
    formatPersianDate,
    onClose,
    onEdit,
    onPrint,
    translations,
}: {
    entry: JournalEntry;
    lines: JournalEntryLine[];
    accounts: Account[];
    currencies: Currency[];
    getAccountName: (id: number) => string;
    getCurrencyName: (id: number) => string;
    formatPersianDate: (date: string) => string;
    onClose: () => void;
    onEdit: (entry: JournalEntry) => void;
    onPrint: () => void;
    translations: any;
}) {
    const totalDebits = lines.reduce((sum, line) => sum + line.debit_amount, 0);
    const totalCredits = lines.reduce((sum, line) => sum + line.credit_amount, 0);
    const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-6 md:p-8 w-full max-w-6xl max-h-[90vh] overflow-y-auto border border-purple-100 dark:border-purple-900/30"
            >
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                {entry.entry_number}
                            </h2>
                            {isBalanced ? (
                                <span title="متعادل">
                                    <CheckCircle2 className="w-6 h-6 text-green-500" />
                                </span>
                            ) : (
                                <span title="نامتعادل">
                                    <XCircle className="w-6 h-6 text-red-500" />
                                </span>
                            )}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                            تاریخ: {formatPersianDate(entry.entry_date)}
                        </div>
                        {entry.description && (
                            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                شرح: {entry.description}
                            </div>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => {
                                onEdit(entry);
                                onClose();
                            }}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl flex items-center gap-2 transition-colors"
                        >
                            <Edit className="w-4 h-4" />
                            <span className="hidden sm:inline">{translations.edit}</span>
                        </motion.button>
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={onPrint}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center gap-2 transition-colors"
                        >
                            <Printer className="w-4 h-4" />
                            <span className="hidden sm:inline">{translations.print}</span>
                        </motion.button>
                        <button
                            onClick={onClose}
                            className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all"
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-right">
                        <thead className="bg-gray-100 dark:bg-gray-700">
                            <tr>
                                <th className="px-4 py-3 text-sm font-bold text-gray-700 dark:text-gray-300">حساب</th>
                                <th className="px-4 py-3 text-sm font-bold text-gray-700 dark:text-gray-300">ارز</th>
                                <th className="px-4 py-3 text-sm font-bold text-gray-700 dark:text-gray-300">بدهکار</th>
                                <th className="px-4 py-3 text-sm font-bold text-gray-700 dark:text-gray-300">بستانکار</th>
                                <th className="px-4 py-3 text-sm font-bold text-gray-700 dark:text-gray-300">نرخ</th>
                                <th className="px-4 py-3 text-sm font-bold text-gray-700 dark:text-gray-300">مبلغ پایه</th>
                                <th className="px-4 py-3 text-sm font-bold text-gray-700 dark:text-gray-300">شرح</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                            {lines.map((line) => (
                                <tr key={line.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                                        {getAccountName(line.account_id)}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                                        {getCurrencyName(line.currency_id)}
                                    </td>
                                    <td className={`px-4 py-3 text-sm font-medium ${
                                        line.debit_amount > 0 
                                            ? 'text-green-600 dark:text-green-400' 
                                            : 'text-gray-400 dark:text-gray-500'
                                    }`} dir="ltr">
                                        {line.debit_amount > 0 ? line.debit_amount.toLocaleString('en-US') : '-'}
                                    </td>
                                    <td className={`px-4 py-3 text-sm font-medium ${
                                        line.credit_amount > 0 
                                            ? 'text-red-600 dark:text-red-400' 
                                            : 'text-gray-400 dark:text-gray-500'
                                    }`} dir="ltr">
                                        {line.credit_amount > 0 ? line.credit_amount.toLocaleString('en-US') : '-'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300" dir="ltr">
                                        {line.exchange_rate.toLocaleString('en-US')}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300" dir="ltr">
                                        {line.base_amount.toLocaleString('en-US')}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                                        {line.description || '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-gray-100 dark:bg-gray-700">
                            <tr>
                                <td colSpan={2} className="px-4 py-3 text-sm font-bold text-gray-900 dark:text-white">
                                    مجموع:
                                </td>
                                <td className={`px-4 py-3 text-sm font-bold ${
                                    isBalanced 
                                        ? 'text-green-600 dark:text-green-400' 
                                        : 'text-gray-900 dark:text-white'
                                }`} dir="ltr">
                                    {totalDebits.toLocaleString('en-US')}
                                </td>
                                <td className={`px-4 py-3 text-sm font-bold ${
                                    isBalanced 
                                        ? 'text-red-600 dark:text-red-400' 
                                        : 'text-gray-900 dark:text-white'
                                }`} dir="ltr">
                                    {totalCredits.toLocaleString('en-US')}
                                </td>
                                <td colSpan={3}></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </motion.div>
        </motion.div>
    );
}

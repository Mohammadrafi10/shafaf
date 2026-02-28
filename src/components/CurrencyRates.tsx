import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
    initCurrencyExchangeRatesTable,
    createExchangeRate,
    getExchangeRateHistory,
    type CurrencyExchangeRate,
} from "../utils/currency";
import { getCurrencies, type Currency } from "../utils/currency";
import { isDatabaseOpen, openDatabase } from "../utils/db";
import Footer from "./Footer";
import PersianDatePicker from "./PersianDatePicker";
import { formatPersianDate, getCurrentPersianDate, persianToGeorgian } from "../utils/date";
import PageHeader from "./common/PageHeader";

const translations = {
    title: "مدیریت نرخ ارز",
    addNew: "افزودن نرخ جدید",
    cancel: "لغو",
    save: "ذخیره",
    fromCurrency: "از ارز",
    toCurrency: "به ارز",
    rate: "نرخ",
    date: "تاریخ",
    backToDashboard: "بازگشت به داشبورد",
    success: {
        created: "نرخ با موفقیت ثبت شد",
    },
    errors: {
        create: "خطا در ثبت نرخ",
        fetch: "خطا در دریافت لیست نرخ‌ها",
        rateRequired: "نرخ الزامی است",
    },
};

interface CurrencyRatesProps {
    onBack?: () => void;
}

export default function CurrencyRates({ onBack }: CurrencyRatesProps) {
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [rates, setRates] = useState<CurrencyExchangeRate[]>([]);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedFromCurrency, setSelectedFromCurrency] = useState<number | null>(null);
    const [selectedToCurrency, setSelectedToCurrency] = useState<number | null>(null);
    const [formData, setFormData] = useState({
        from_currency_id: "",
        to_currency_id: "",
        rate: "",
        date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
    });

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        if (selectedFromCurrency && selectedToCurrency) {
            loadRates(selectedFromCurrency, selectedToCurrency);
        }
    }, [selectedFromCurrency, selectedToCurrency]);

    const loadData = async () => {
        try {
            setLoading(true);
            const dbOpen = await isDatabaseOpen();
            if (!dbOpen) {
                await openDatabase("db");
            }

            try {
                await initCurrencyExchangeRatesTable();
            } catch (err) {
                console.log("Table initialization:", err);
            }

            const currenciesData = await getCurrencies();
            setCurrencies(currenciesData);
            if (currenciesData.length >= 2) {
                setSelectedFromCurrency(currenciesData[0].id);
                setSelectedToCurrency(currenciesData[1].id);
            }
        } catch (error: any) {
            toast.error(translations.errors.fetch);
            console.error("Error loading data:", error);
        } finally {
            setLoading(false);
        }
    };

    const loadRates = async (fromId: number, toId: number) => {
        try {
            const ratesData = await getExchangeRateHistory(fromId, toId);
            setRates(ratesData);
        } catch (error: any) {
            console.error("Error loading rates:", error);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.from_currency_id || !formData.to_currency_id) {
            toast.error("انتخاب ارزها الزامی است");
            return;
        }

        if (!formData.rate || parseFloat(formData.rate) <= 0) {
            toast.error(translations.errors.rateRequired);
            return;
        }

        try {
            setLoading(true);
            await createExchangeRate(
                parseInt(formData.from_currency_id),
                parseInt(formData.to_currency_id),
                parseFloat(formData.rate),
                formData.date
            );
            toast.success(translations.success.created);
            setIsModalOpen(false);
            setFormData({
                from_currency_id: "",
                to_currency_id: "",
                rate: "",
                date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
            });
            if (selectedFromCurrency && selectedToCurrency) {
                await loadRates(selectedFromCurrency, selectedToCurrency);
            }
        } catch (error: any) {
            toast.error(translations.errors.create);
            console.error("Error creating rate:", error);
        } finally {
            setLoading(false);
        }
    };

    const getCurrencyName = (currencyId: number) => {
        return currencies.find(c => c.id === currencyId)?.name || `ID: ${currencyId}`;
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
                            onClick: () => setIsModalOpen(true),
                            variant: "primary" as const
                        }
                    ]}
                />

                <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-lg p-6 mb-6">
                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                {translations.fromCurrency}
                            </label>
                            <select
                                value={selectedFromCurrency || ""}
                                onChange={(e) => {
                                    const id = parseInt(e.target.value);
                                    setSelectedFromCurrency(id);
                                    if (id && selectedToCurrency) {
                                        loadRates(id, selectedToCurrency);
                                    }
                                }}
                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                dir="rtl"
                            >
                                <option value="">انتخاب ارز</option>
                                {currencies.map((currency) => (
                                    <option key={currency.id} value={currency.id}>
                                        {currency.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                {translations.toCurrency}
                            </label>
                            <select
                                value={selectedToCurrency || ""}
                                onChange={(e) => {
                                    const id = parseInt(e.target.value);
                                    setSelectedToCurrency(id);
                                    if (selectedFromCurrency && id) {
                                        loadRates(selectedFromCurrency, id);
                                    }
                                }}
                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                dir="rtl"
                            >
                                <option value="">انتخاب ارز</option>
                                {currencies.map((currency) => (
                                    <option key={currency.id} value={currency.id}>
                                        {currency.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {selectedFromCurrency && selectedToCurrency && (
                        <div className="space-y-3">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
                                تاریخچه نرخ: {getCurrencyName(selectedFromCurrency)} به {getCurrencyName(selectedToCurrency)}
                            </h3>
                            {rates.length === 0 ? (
                                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                    هیچ نرخی ثبت نشده است
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {rates.map((rate) => (
                                        <motion.div
                                            key={rate.id}
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="p-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50"
                                        >
                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <div className="font-bold text-gray-900 dark:text-white">
                                                        {rate.rate.toLocaleString('en-US')}
                                                    </div>
                                                    <div className="text-sm text-gray-600 dark:text-gray-400">
                                                        {formatPersianDate(rate.date)}
                                                    </div>
                                                </div>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Add Rate Modal */}
                <AnimatePresence>
                    {isModalOpen && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                            onClick={() => setIsModalOpen(false)}
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
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.fromCurrency} <span className="text-red-500">*</span>
                                            </label>
                                            <select
                                                value={formData.from_currency_id}
                                                onChange={(e) => setFormData({ ...formData, from_currency_id: e.target.value })}
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                dir="rtl"
                                            >
                                                <option value="">انتخاب ارز</option>
                                                {currencies.map((currency) => (
                                                    <option key={currency.id} value={currency.id}>
                                                        {currency.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.toCurrency} <span className="text-red-500">*</span>
                                            </label>
                                            <select
                                                value={formData.to_currency_id}
                                                onChange={(e) => setFormData({ ...formData, to_currency_id: e.target.value })}
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                dir="rtl"
                                            >
                                                <option value="">انتخاب ارز</option>
                                                {currencies.map((currency) => (
                                                    <option key={currency.id} value={currency.id}>
                                                        {currency.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.rate} <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="number"
                                                step="0.0001"
                                                value={formData.rate}
                                                onChange={(e) => setFormData({ ...formData, rate: e.target.value })}
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder="1.0000"
                                                dir="ltr"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.date} <span className="text-red-500">*</span>
                                            </label>
                                            <PersianDatePicker
                                                value={formData.date}
                                                onChange={(date) => setFormData({ ...formData, date })}
                                                placeholder="تاریخ را انتخاب کنید"
                                                required
                                            />
                                        </div>
                                    </div>
                                    <div className="flex gap-3 pt-4">
                                        <motion.button
                                            type="button"
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => setIsModalOpen(false)}
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

                <Footer />
            </div>
        </div>
    );
}

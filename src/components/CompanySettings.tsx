import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { save, open } from "@tauri-apps/plugin-dialog";
import { getCompanySettings, updateCompanySettings, initCompanySettingsTable } from "../utils/company";
import { getAvailableFonts, applyFont } from "../utils/fonts";
import { saveBackupToPath, restoreDatabase, getBackupsDir } from "../utils/db";
import { checkForUpdates, installUpdate } from "../utils/updater";
import Footer from "./Footer";

// Dari translations
const translations = {
    title: "تنظیمات شرکت",
    subtitle: "اطلاعات شرکت را ویرایش کنید",
    save: "ذخیره تغییرات",
    cancel: "لغو",
    companyName: "نام شرکت",
    logo: "لوگو",
    phone: "شماره تماس",
    address: "آدرس",
    font: "فونت",
    companyInfo: "اطلاعات شرکت",
    quickLinks: "دسترسی سریع",
    manageCurrencies: "مدیریت ارزها",
    manageUnits: "مدیریت واحدها",
    manageAccounts: "مدیریت حساب‌ها",
    success: {
        updated: "تنظیمات شرکت با موفقیت بروزرسانی شد",
    },
    errors: {
        update: "خطا در بروزرسانی تنظیمات شرکت",
        fetch: "خطا در دریافت اطلاعات شرکت",
    },
    placeholders: {
        companyName: "نام شرکت را وارد کنید",
        logo: "مسیر یا URL لوگو را وارد کنید",
        phone: "شماره تماس را وارد کنید",
        address: "آدرس را وارد کنید",
    },
    system: {
        backupAndUpdate: "پشتیبان و بروزرسانی",
        backupDesc: "ذخیره یک کپی از پایگاه داده در مسیر دلخواه",
        restoreDesc: "بازگردانی پایگاه داده از فایل پشتیبان قبلی",
        updateDesc: "بررسی و نصب آخرین نسخه برنامه",
        backup: "پشتیبان‌گیری",
        restore: "بازگردانی",
        checkUpdate: "بررسی بروزرسانی",
        installing: "در حال نصب...",
        upToDate: "شما از آخرین نسخه استفاده می‌کنید",
        updateAvailable: "بروزرسانی موجود است",
        installNow: "نصب بروزرسانی",
        autoBackupFolder: "پوشه پشتیبان خودکار",
        autoBackupDirLabel: "مسیر پشتیبان خودکار",
        chooseFolder: "انتخاب پوشه",
        autoBackupDirHint: "اگر خالی باشد از پوشه پیش‌فرض برنامه استفاده می‌شود",
    },
    license: {
        remainingDays: "اعتبار لایسنس: {days} روز باقی‌مانده",
        expired: "اعتبار لایسنس منقضی شده",
    },
};

export type CompanySettingsNavigatePage = "currency" | "unit" | "account";

interface CompanySettingsProps {
    onBack: () => void;
    onNavigate?: (page: CompanySettingsNavigatePage) => void;
}

export default function CompanySettings({ onBack, onNavigate }: CompanySettingsProps) {
    const [loading, setLoading] = useState(false);
    const [fetchLoading, setFetchLoading] = useState(true);
    const [formData, setFormData] = useState({
        name: "",
        logo: "",
        phone: "",
        address: "",
        font: "",
        auto_backup_dir: "",
    });
    const [availableFonts] = useState(getAvailableFonts());
    const [checkingUpdate, setCheckingUpdate] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<{ available: boolean; version?: string; date?: string; body?: string } | null>(null);
    const [backupsDir, setBackupsDir] = useState<string | null>(null);

    const handleBackupDatabase = async () => {
        try {
            const filePath = await save({
                defaultPath: `db-backup-${new Date().toISOString().split("T")[0]}.sql`,
                filters: [{ name: "MySQL Dump", extensions: ["sql"] }],
            });
            if (filePath) {
                await saveBackupToPath(filePath);
                toast.success("پشتیبان‌گیری با موفقیت انجام شد");
            }
        } catch (error: any) {
            if (error?.message && !String(error.message).includes("cancelled")) {
                toast.error("خطا در پشتیبان‌گیری از پایگاه داده");
            }
        }
    };

    const handleRestoreDatabase = async () => {
        try {
            const filePath = await open({
                filters: [{ name: "MySQL Dump", extensions: ["sql"] }],
                title: "انتخاب فایل پشتیبان",
            });
            if (filePath && typeof filePath === "string") {
                const confirmed = window.confirm(
                    "آیا مطمئن هستید که می‌خواهید پایگاه داده را بازگردانی کنید؟ تمام جداول به‌جز جدول کاربران (users) بازگردانی می‌شوند؛ کاربران فعلی حفظ می‌شوند."
                );
                if (confirmed) {
                    await restoreDatabase(filePath);
                    toast.success("بازگردانی پایگاه داده با موفقیت انجام شد");
                    window.location.reload();
                }
            }
        } catch (error: any) {
            if (error?.message && !String(error.message).includes("cancelled")) {
                toast.error("خطا در بازگردانی پایگاه داده");
            }
        }
    };

    const handleCheckForUpdates = async () => {
        try {
            setCheckingUpdate(true);
            const info = await checkForUpdates();
            if (info?.available) {
                setUpdateInfo(info);
                toast.success(`بروزرسانی جدید موجود است! نسخه ${info.version}`);
            } else {
                setUpdateInfo(null);
                toast.success(translations.system.upToDate);
            }
        } catch {
            toast.error("خطا در بررسی بروزرسانی");
        } finally {
            setCheckingUpdate(false);
        }
    };

    const handleInstallUpdate = async () => {
        try {
            toast.loading("در حال دانلود و نصب بروزرسانی...", { id: "update-install" });
            await installUpdate();
            toast.success("بروزرسانی با موفقیت نصب شد. برنامه در حال راه‌اندازی مجدد است...", { id: "update-install" });
        } catch {
            toast.error("خطا در نصب بروزرسانی", { id: "update-install" });
        }
    };

    useEffect(() => {
        loadSettings();
    }, []);

    useEffect(() => {
        getBackupsDir()
            .then(setBackupsDir)
            .catch(() => setBackupsDir(null));
    }, []);

    const loadSettings = async () => {
        try {
            setFetchLoading(true);
            // Initialize table first
            await initCompanySettingsTable();
            
            const settingsData = await getCompanySettings();
            if (settingsData) {
                setFormData({
                    name: settingsData.name || "",
                    logo: settingsData.logo || "",
                    phone: settingsData.phone || "",
                    address: settingsData.address || "",
                    font: settingsData.font || "",
                    auto_backup_dir: settingsData.auto_backup_dir || "",
                });
            }
        } catch (error: any) {
            toast.error(translations.errors.fetch);
            console.error("Error loading company settings:", error);
        } finally {
            setFetchLoading(false);
        }
    };

    const handleSelectImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            // Validate file type
            if (!file.type.startsWith('image/')) {
                toast.error("لطفاً یک فایل تصویری انتخاب کنید");
                return;
            }
            
            // Validate file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                toast.error("حجم فایل نباید بیشتر از 5 مگابایت باشد");
                return;
            }

            // Create a local URL for preview
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                // Store as data URL (base64)
                setFormData({ ...formData, logo: result });
            };
            reader.readAsDataURL(file);
        }
    };

    const handleRemoveImage = () => {
        setFormData({ ...formData, logo: "" });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.name.trim()) {
            toast.error("نام شرکت الزامی است");
            return;
        }

        try {
            setLoading(true);
            const updatedSettings = await updateCompanySettings({
                name: formData.name,
                logo: formData.logo || undefined,
                phone: formData.phone || undefined,
                address: formData.address || undefined,
                font: formData.font || undefined,
                auto_backup_dir: formData.auto_backup_dir?.trim() || null,
            });

            if (updatedSettings) {
                toast.success(translations.success.updated);
                // Apply the new font immediately
                try {
                    if (updatedSettings.font) {
                        await applyFont(updatedSettings.font);
                    } else {
                        await applyFont(null);
                    }
                } catch (fontError) {
                    console.error("Error applying font:", fontError);
                }
            }
        } catch (error: any) {
            toast.error(translations.errors.update);
            console.error("Error updating company settings:", error);
        } finally {
            setLoading(false);
        }
    };

    if (fetchLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center">
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full"
                />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-6" dir="rtl">
            <div className="max-w-4xl mx-auto">
                {/* Back Button */}
                <motion.div
                    initial={{ opacity: 0, x: -30 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4 }}
                    className="mb-6"
                >
                    <motion.button
                        whileHover={{ scale: 1.05, x: -5 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={onBack}
                        className="group flex items-center gap-3 px-6 py-3 bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl hover:bg-white dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold rounded-2xl shadow-lg hover:shadow-xl border-2 border-gray-200 dark:border-gray-700 hover:border-purple-400 dark:hover:border-purple-500 transition-all duration-300"
                    >
                        <motion.svg
                            className="w-5 h-5 text-purple-600 dark:text-purple-400"
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2.5"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            animate={{ x: [0, -3, 0] }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                        >
                            <path d="M15 19l-7-7 7-7" />
                        </motion.svg>
                        <span className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                            بازگشت به داشبورد
                        </span>
                    </motion.button>
                </motion.div>

                {/* Company Header Card */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-gradient-to-br from-purple-600 to-blue-600 rounded-3xl shadow-2xl p-8 mb-6 relative overflow-hidden"
                >
                    {/* Decorative circles */}
                    <div className="absolute -top-20 -right-20 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
                    <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-white/10 rounded-full blur-3xl" />

                    <div className="relative z-10 flex flex-col md:flex-row items-center gap-6">
                        <motion.div
                            whileHover={{ scale: 1.05, rotate: 5 }}
                            className="w-28 h-28 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center shadow-lg border-2 border-white/30"
                        >
                            {formData.logo ? (
                                <img
                                    src={formData.logo}
                                    alt={formData.name}
                                    className="w-full h-full object-contain rounded-xl"
                                    onError={(e) => {
                                        const target = e.target as HTMLImageElement;
                                        target.style.display = "none";
                                    }}
                                />
                            ) : (
                                <svg className="w-14 h-14 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                </svg>
                            )}
                        </motion.div>
                        <div className="text-center md:text-right">
                            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
                                {formData.name || translations.title}
                            </h1>
                            <p className="text-purple-100 text-lg mb-3">{translations.subtitle}</p>
                        </div>
                    </div>
                </motion.div>

                {/* Quick Links: Currency, Unit, Account */}
                {onNavigate && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15 }}
                        className="mb-6"
                    >
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                            <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                            {translations.quickLinks}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {[
                                { title: translations.manageCurrencies, page: "currency" as const, icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z", color: "from-amber-500 to-orange-500" },
                                { title: translations.manageUnits, page: "unit" as const, icon: "M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z", color: "from-pink-500 to-rose-500" },
                                { title: translations.manageAccounts, page: "account" as const, icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z", color: "from-yellow-500 to-amber-500" },
                            ].map((item) => (
                                <motion.button
                                    key={item.page}
                                    type="button"
                                    onClick={() => onNavigate(item.page)}
                                    whileHover={{ scale: 1.02, y: -4 }}
                                    whileTap={{ scale: 0.98 }}
                                    className={`group relative bg-gradient-to-br ${item.color} rounded-2xl shadow-lg hover:shadow-xl p-5 border border-white/20 text-white text-right transition-all duration-300 overflow-hidden`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="font-bold text-base">{item.title}</span>
                                        <svg className="w-6 h-6 opacity-80 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                        </svg>
                                    </div>
                                    <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors" />
                                </motion.button>
                            ))}
                        </div>
                    </motion.div>
                )}

                {/* Backup & Update Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="mb-6"
                >
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        <svg className="w-5 h-5 text-slate-600 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4 4m4-4V12" />
                        </svg>
                        {translations.system.backupAndUpdate}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <motion.button
                            type="button"
                            onClick={handleBackupDatabase}
                            whileHover={{ y: -4, scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className="group flex flex-col items-start gap-3 p-5 rounded-2xl bg-white dark:bg-gray-800 border-2 border-amber-200 dark:border-amber-800/50 hover:border-amber-400 dark:hover:border-amber-600 shadow-lg hover:shadow-xl transition-all text-right"
                        >
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-md group-hover:scale-110 transition-transform">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4 4m4-4V12" />
                                </svg>
                            </div>
                            <div>
                                <p className="font-bold text-gray-900 dark:text-white mb-1">{translations.system.backup}</p>
                                <p className="text-sm text-gray-600 dark:text-gray-400">{translations.system.backupDesc}</p>
                            </div>
                        </motion.button>
                        <motion.button
                            type="button"
                            onClick={handleRestoreDatabase}
                            whileHover={{ y: -4, scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className="group flex flex-col items-start gap-3 p-5 rounded-2xl bg-white dark:bg-gray-800 border-2 border-emerald-200 dark:border-emerald-800/50 hover:border-emerald-400 dark:hover:border-emerald-600 shadow-lg hover:shadow-xl transition-all text-right"
                        >
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center shadow-md group-hover:scale-110 transition-transform">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            </div>
                            <div>
                                <p className="font-bold text-gray-900 dark:text-white mb-1">{translations.system.restore}</p>
                                <p className="text-sm text-gray-600 dark:text-gray-400">{translations.system.restoreDesc}</p>
                            </div>
                        </motion.button>
                        <div className="flex flex-col gap-3">
                            <motion.button
                                type="button"
                                onClick={handleCheckForUpdates}
                                disabled={checkingUpdate}
                                whileHover={{ y: -4, scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                className="group flex flex-col items-start gap-3 p-5 rounded-2xl bg-white dark:bg-gray-800 border-2 border-blue-200 dark:border-blue-800/50 hover:border-blue-400 dark:hover:border-blue-600 shadow-lg hover:shadow-xl transition-all text-right disabled:opacity-60 disabled:pointer-events-none"
                            >
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-md group-hover:scale-110 transition-transform">
                                    {checkingUpdate ? (
                                        <motion.div
                                            animate={{ rotate: 360 }}
                                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                            className="w-6 h-6 border-2 border-white border-t-transparent rounded-full"
                                        />
                                    ) : (
                                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                    )}
                                </div>
                                <div>
                                    <p className="font-bold text-gray-900 dark:text-white mb-1">{translations.system.checkUpdate}</p>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">{translations.system.updateDesc}</p>
                                </div>
                            </motion.button>
                            {updateInfo?.available && (
                                <motion.button
                                    type="button"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    onClick={handleInstallUpdate}
                                    className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l4-4m-4 4v12" />
                                    </svg>
                                    {translations.system.installNow} (v{updateInfo.version})
                                </motion.button>
                            )}
                        </div>
                    </div>
                    {backupsDir != null && (
                        <div className="mt-4 p-4 rounded-xl bg-gray-100 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700">
                            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                                پوشه پیش‌فرض (وقتی مسیر انتخاب نشده)
                            </p>
                            <p className="text-sm text-gray-600 dark:text-gray-400 break-all font-mono dir-ltr" title={backupsDir}>
                                {backupsDir}
                            </p>
                        </div>
                    )}
                </motion.div>

                <form onSubmit={handleSubmit}>
                    {/* Company Information Section */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-3xl shadow-xl p-8 mb-6 border border-purple-100/50 dark:border-purple-900/30"
                    >
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                </svg>
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{translations.companyInfo}</h2>
                                <p className="text-gray-600 dark:text-gray-400 text-sm">اطلاعات پایه شرکت را تنظیم کنید</p>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                    {translations.companyName} <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                        </svg>
                                    </div>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        required
                                        className="w-full pr-11 pl-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                        placeholder={translations.placeholders.companyName}
                                        dir="rtl"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                    {translations.logo}
                                </label>
                                <div className="space-y-3">
                                    <div className="relative">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={handleSelectImage}
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-600 file:text-white hover:file:bg-purple-700 file:cursor-pointer cursor-pointer"
                                            dir="rtl"
                                        />
                                    </div>
                                    {formData.logo && (
                                        <div className="mt-3">
                                            <div className="flex items-center justify-between mb-2">
                                                <p className="text-sm text-gray-600 dark:text-gray-400">پیش‌نمایش لوگو:</p>
                                                <button
                                                    type="button"
                                                    onClick={handleRemoveImage}
                                                    className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-semibold flex items-center gap-1"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                    حذف تصویر
                                                </button>
                                            </div>
                                            <div className="w-32 h-32 border-2 border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden bg-gray-50 dark:bg-gray-700 flex items-center justify-center">
                                                <img
                                                    src={formData.logo}
                                                    alt="Logo preview"
                                                    className="w-full h-full object-contain"
                                                    onError={(e) => {
                                                        const target = e.target as HTMLImageElement;
                                                        target.style.display = "none";
                                                        const parent = target.parentElement;
                                                        if (parent) {
                                                            parent.innerHTML = '<p class="text-gray-400 text-sm">خطا در بارگذاری تصویر</p>';
                                                        }
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                    {translations.phone}
                                </label>
                                <div className="relative">
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                        </svg>
                                    </div>
                                    <input
                                        type="tel"
                                        value={formData.phone}
                                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                        className="w-full pr-11 pl-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                        placeholder={translations.placeholders.phone}
                                        dir="ltr"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                    {translations.address}
                                </label>
                                <div className="relative">
                                    <div className="absolute right-3 top-3 pointer-events-none">
                                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    </div>
                                    <textarea
                                        value={formData.address}
                                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                        rows={4}
                                        className="w-full pr-11 pl-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200 resize-none"
                                        placeholder={translations.placeholders.address}
                                        dir="rtl"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                    {translations.font}
                                </label>
                                <div className="relative">
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                        </svg>
                                    </div>
                                    <select
                                        value={formData.font}
                                        onChange={(e) => setFormData({ ...formData, font: e.target.value })}
                                        className="w-full pr-11 pl-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200 appearance-none cursor-pointer"
                                        dir="rtl"
                                        style={{ 
                                            fontFamily: formData.font && formData.font !== "system" && !formData.font.includes('/') 
                                                ? formData.font 
                                                : (formData.font && formData.font.includes('IRANSans') ? 'IRANSans' : undefined)
                                        }}
                                    >
                                        {availableFonts.map((font, index) => {
                                            // Use file path as value if available, otherwise use name
                                            const value = font.name === "system" 
                                                ? "" 
                                                : (font.file ? font.file : font.name);
                                            return (
                                                <option key={`${font.name}-${index}`} value={value}>
                                                    {font.displayName}
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                    فونت‌های سفارشی را در پوشه public/fonts قرار دهید (فرمت‌های .ttf, .otf, .woff, .woff2)
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                    {translations.system.autoBackupDirLabel}
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={formData.auto_backup_dir}
                                        onChange={(e) => setFormData({ ...formData, auto_backup_dir: e.target.value })}
                                        placeholder={translations.system.autoBackupDirHint}
                                        className="flex-1 px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 font-mono text-sm dir-ltr"
                                    />
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            try {
                                                const path = await open({ directory: true, title: "انتخاب پوشه پشتیبان خودکار" });
                                                if (path && typeof path === "string") {
                                                    setFormData((prev) => ({ ...prev, auto_backup_dir: path }));
                                                }
                                            } catch (e) {
                                                if (String(e).includes("cancelled") === false) {
                                                    toast.error("خطا در انتخاب پوشه");
                                                }
                                            }
                                        }}
                                        className="px-4 py-3 rounded-xl border-2 border-purple-300 dark:border-purple-600 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 font-semibold whitespace-nowrap transition-colors"
                                    >
                                        {translations.system.chooseFolder}
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                    {translations.system.autoBackupDirHint}
                                </p>
                                {backupsDir != null && (
                                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 font-mono dir-ltr break-all">
                                        پوشه پیش‌فرض: {backupsDir}
                                    </p>
                                )}
                            </div>
                        </div>
                    </motion.div>

                    {/* Submit Button */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="flex gap-4"
                    >
                        <motion.button
                            type="button"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={onBack}
                            className="flex-1 py-4 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-bold rounded-xl transition-colors shadow-lg"
                        >
                            {translations.cancel}
                        </motion.button>
                        <motion.button
                            type="submit"
                            disabled={loading}
                            whileHover={{ scale: loading ? 1 : 1.02 }}
                            whileTap={{ scale: loading ? 1 : 0.98 }}
                            className="flex-1 py-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <motion.div
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                        className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                                    />
                                    <span>در حال ذخیره...</span>
                                </>
                            ) : (
                                <>
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                    <span>{translations.save}</span>
                                </>
                            )}
                        </motion.button>
                    </motion.div>
                </form>
                <Footer />
            </div>
        </div>
    );
}

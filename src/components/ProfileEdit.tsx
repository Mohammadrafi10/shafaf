import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { getUserById, updateUserProfile, type User } from "../utils/user";
import Footer from "./Footer";
import { User as UserIcon } from "lucide-react";

// Dari translations
const translations = {
    title: "ویرایش پروفایل",
    subtitle: "اطلاعات شخصی خود را ویرایش کنید",
    save: "ذخیره تغییرات",
    cancel: "لغو",
    username: "نام کاربری",
    email: "ایمیل",
    fullName: "نام کامل",
    phone: "شماره تماس",
    currentPassword: "رمز عبور فعلی",
    newPassword: "رمز عبور جدید",
    confirmPassword: "تأیید رمز عبور جدید",
    changePassword: "تغییر رمز عبور",
    personalInfo: "اطلاعات شخصی",
    securityInfo: "امنیت حساب",
    accountInfo: "اطلاعات حساب",
    role: "نقش",
    joinDate: "تاریخ عضویت",
    lastUpdate: "آخرین بروزرسانی",
    roles: {
        admin: "مدیر",
        user: "کاربر",
        editor: "ویرایشگر",
    },
    success: {
        updated: "پروفایل با موفقیت بروزرسانی شد",
        passwordChanged: "رمز عبور با موفقیت تغییر کرد",
    },
    errors: {
        update: "خطا در بروزرسانی پروفایل",
        fetch: "خطا در دریافت اطلاعات کاربر",
        currentPasswordRequired: "رمز عبور فعلی الزامی است",
        newPasswordRequired: "رمز عبور جدید الزامی است",
        passwordMismatch: "رمزهای عبور مطابقت ندارند",
        passwordTooShort: "رمز عبور باید حداقل ۶ کاراکتر باشد",
        incorrectPassword: "رمز عبور فعلی اشتباه است",
    },
    placeholders: {
        username: "نام کاربری را وارد کنید",
        email: "ایمیل را وارد کنید",
        fullName: "نام کامل خود را وارد کنید",
        phone: "شماره تماس خود را وارد کنید",
        currentPassword: "رمز عبور فعلی را وارد کنید",
        newPassword: "رمز عبور جدید را وارد کنید",
        confirmPassword: "رمز عبور جدید را تأیید کنید",
    },
    profilePicture: "تصویر پروفایل",
    selectProfilePicture: "انتخاب تصویر",
    removeProfilePicture: "حذف تصویر",
};

interface ProfileEditProps {
    userId: number;
    onBack: () => void;
    onProfileUpdate?: (user: User) => void;
}

export default function ProfileEdit({ userId, onBack, onProfileUpdate }: ProfileEditProps) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(false);
    const [fetchLoading, setFetchLoading] = useState(true);
    const [showPasswordSection, setShowPasswordSection] = useState(false);
    const [formData, setFormData] = useState({
        username: "",
        email: "",
        full_name: "",
        phone: "",
        profile_picture: null as string | null,
    });
    const [profilePreview, setProfilePreview] = useState<string | null>(null);
    const [passwordData, setPasswordData] = useState({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
    });

    useEffect(() => {
        loadUserData();
    }, [userId]);

    const loadUserData = async () => {
        try {
            setFetchLoading(true);
            const userData = await getUserById(userId);
            if (userData) {
                setUser(userData);
                setFormData({
                    username: userData.username,
                    email: userData.email,
                    full_name: userData.full_name || "",
                    phone: userData.phone || "",
                    profile_picture: userData.profile_picture ?? null,
                });
                setProfilePreview(userData.profile_picture ?? null);
            }
        } catch (error: any) {
            toast.error(translations.errors.fetch);
            console.error("Error loading user:", error);
        } finally {
            setFetchLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validate password if changing
        if (showPasswordSection && (passwordData.newPassword || passwordData.currentPassword)) {
            if (!passwordData.currentPassword) {
                toast.error(translations.errors.currentPasswordRequired);
                return;
            }
            if (!passwordData.newPassword) {
                toast.error(translations.errors.newPasswordRequired);
                return;
            }
            if (passwordData.newPassword.length < 6) {
                toast.error(translations.errors.passwordTooShort);
                return;
            }
            if (passwordData.newPassword !== passwordData.confirmPassword) {
                toast.error(translations.errors.passwordMismatch);
                return;
            }
        }

        try {
            setLoading(true);
            const updatedUser = await updateUserProfile(userId, {
                username: formData.username,
                email: formData.email,
                full_name: formData.full_name || undefined,
                phone: formData.phone || undefined,
                profile_picture: formData.profile_picture ?? undefined,
                currentPassword: showPasswordSection ? passwordData.currentPassword : undefined,
                newPassword: showPasswordSection ? passwordData.newPassword : undefined,
            });

            if (updatedUser) {
                setUser(updatedUser);
                if (onProfileUpdate) {
                    onProfileUpdate(updatedUser);
                }
                toast.success(translations.success.updated);
                setPasswordData({
                    currentPassword: "",
                    newPassword: "",
                    confirmPassword: "",
                });
                setShowPasswordSection(false);
            }
        } catch (error: any) {
            if (error.message === "Current password is incorrect") {
                toast.error(translations.errors.incorrectPassword);
            } else {
                toast.error(translations.errors.update);
            }
            console.error("Error updating profile:", error);
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

    if (!user) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center p-4">
                <div className="text-center">
                    <p className="text-gray-600 dark:text-gray-400 text-xl">کاربر یافت نشد</p>
                    <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={onBack}
                        className="mt-4 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-bold rounded-xl"
                    >
                        بازگشت
                    </motion.button>
                </div>
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

                {/* Profile Header Card */}
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
                            className="w-28 h-28 rounded-2xl flex items-center justify-center shadow-lg border-2 border-white/30 overflow-hidden bg-white/20 backdrop-blur-sm"
                        >
                            {(profilePreview ?? user.profile_picture) ? (
                                <img
                                    src={profilePreview ?? user.profile_picture ?? ""}
                                    alt={user.username}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <span className="text-white font-bold text-5xl">
                                    {user.username.charAt(0).toUpperCase()}
                                </span>
                            )}
                        </motion.div>
                        <div className="text-center md:text-right">
                            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
                                {user.full_name || user.username}
                            </h1>
                            <p className="text-purple-100 text-lg mb-3">@{user.username}</p>
                            <div className="flex flex-wrap justify-center md:justify-start gap-3">
                                <span className="px-4 py-2 bg-white/20 backdrop-blur-sm rounded-xl text-white text-sm font-medium border border-white/30">
                                    {translations.roles[user.role as keyof typeof translations.roles] || user.role}
                                </span>
                                <span className="px-4 py-2 bg-white/20 backdrop-blur-sm rounded-xl text-white text-sm font-medium border border-white/30 flex items-center gap-2">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    عضویت: {new Date(user.created_at).toLocaleDateString('fa-IR')}
                                </span>
                            </div>
                        </div>
                    </div>
                </motion.div>

                <form onSubmit={handleSubmit}>
                    {/* Personal Information Section */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-3xl shadow-xl p-8 mb-6 border border-purple-100/50 dark:border-purple-900/30"
                    >
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{translations.personalInfo}</h2>
                                <p className="text-gray-600 dark:text-gray-400 text-sm">اطلاعات پایه خود را تنظیم کنید</p>
                            </div>
                        </div>

                        <div className="mb-6">
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                {translations.profilePicture}
                            </label>
                            <div className="flex items-center gap-4">
                                {profilePreview ? (
                                    <div className="relative inline-block">
                                        <img src={profilePreview} alt="پروفایل" className="w-20 h-20 rounded-xl object-cover border-2 border-gray-200 dark:border-gray-600 shadow" />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setProfilePreview(null);
                                                setFormData((prev) => ({ ...prev, profile_picture: null }));
                                            }}
                                            className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center text-xs"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ) : (
                                    <label className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer hover:border-purple-500 dark:hover:border-purple-400 transition-colors bg-gray-50 dark:bg-gray-700/50">
                                        <UserIcon className="w-8 h-8 text-gray-400" />
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    if (!file.type.startsWith("image/")) {
                                                        toast.error("لطفاً یک فایل تصویری انتخاب کنید");
                                                        return;
                                                    }
                                                    if (file.size > 5 * 1024 * 1024) {
                                                        toast.error("حجم فایل نباید بیشتر از 5 مگابایت باشد");
                                                        return;
                                                    }
                                                    const reader = new FileReader();
                                                    reader.onloadend = () => {
                                                        const result = reader.result as string;
                                                        setProfilePreview(result);
                                                        setFormData((prev) => ({ ...prev, profile_picture: result }));
                                                    };
                                                    reader.readAsDataURL(file);
                                                }
                                            }}
                                        />
                                    </label>
                                )}
                                {!profilePreview && (
                                    <span className="text-sm text-gray-500 dark:text-gray-400">{translations.selectProfilePicture}</span>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                    {translations.username}
                                </label>
                                <div className="relative">
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                        </svg>
                                    </div>
                                    <input
                                        type="text"
                                        value={formData.username}
                                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                        required
                                        className="w-full pr-11 pl-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                        placeholder={translations.placeholders.username}
                                        dir="ltr"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                    {translations.email}
                                </label>
                                <div className="relative">
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                        </svg>
                                    </div>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        required
                                        className="w-full pr-11 pl-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                        placeholder={translations.placeholders.email}
                                        dir="ltr"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                    {translations.fullName}
                                </label>
                                <div className="relative">
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <input
                                        type="text"
                                        value={formData.full_name}
                                        onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                        className="w-full pr-11 pl-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                        placeholder={translations.placeholders.fullName}
                                        dir="rtl"
                                    />
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
                        </div>
                    </motion.div>

                    {/* Security Section */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-3xl shadow-xl p-8 mb-6 border border-purple-100/50 dark:border-purple-900/30"
                    >
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl flex items-center justify-center shadow-lg">
                                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                    </svg>
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">{translations.securityInfo}</h2>
                                    <p className="text-gray-600 dark:text-gray-400 text-sm">رمز عبور خود را تغییر دهید</p>
                                </div>
                            </div>
                            <motion.button
                                type="button"
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => setShowPasswordSection(!showPasswordSection)}
                                className={`px-4 py-2 rounded-xl font-semibold transition-all duration-200 ${showPasswordSection
                                        ? "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                                        : "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg"
                                    }`}
                            >
                                {showPasswordSection ? translations.cancel : translations.changePassword}
                            </motion.button>
                        </div>

                        <AnimatePresence>
                            {showPasswordSection && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="space-y-4 overflow-hidden"
                                >
                                    <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-700/30">
                                        <div className="flex items-start gap-3">
                                            <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            <p className="text-amber-800 dark:text-amber-200 text-sm">
                                                برای تغییر رمز عبور، ابتدا رمز عبور فعلی خود را وارد کنید
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.currentPassword}
                                            </label>
                                            <input
                                                type="password"
                                                value={passwordData.currentPassword}
                                                onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder={translations.placeholders.currentPassword}
                                                dir="ltr"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.newPassword}
                                            </label>
                                            <input
                                                type="password"
                                                value={passwordData.newPassword}
                                                onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder={translations.placeholders.newPassword}
                                                dir="ltr"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.confirmPassword}
                                            </label>
                                            <input
                                                type="password"
                                                value={passwordData.confirmPassword}
                                                onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder={translations.placeholders.confirmPassword}
                                                dir="ltr"
                                            />
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
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

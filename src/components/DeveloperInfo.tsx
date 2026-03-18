import { motion } from "framer-motion";
import { useState } from "react";
import PageHeader from "./common/PageHeader";
import { User, Phone, Mail, FileText } from "lucide-react";

const DEVELOPER = {
    name: "Sulaiman Qasimi",
    phone: "765993446",
    emails: ["farzadqasimy@gmail.com", "Sulaiman.qasimi@galaxytechology.com"],
    /** Optional: place developer photo at public/developer.jpg to show it */
    imagePath: "/developer.jpg",
};

const TERMS_PERSIAN = [
    "۱. استفاده از نرم‌افزار شفاف به منزله پذیرش این شرایط و ضوابط است.",
    "۲. نرم‌افزار «به همان شکل موجود» ارائه می‌شود و توسعه‌دهنده در قبال خسارات مستقیم یا غیرمستقیم ناشی از استفاده یا عدم امکان استفاده از نرم‌افزار مسئولیتی ندارد.",
    "۳. کاربر موظف است از نرم‌افزار تنها در چارچوب قوانین جاری کشور استفاده کند و از آن برای فعالیت‌های غیرقانونی استفاده نکند.",
    "۴. تمامی داده‌های وارد شده توسط کاربر در محیط نرم‌افزار ذخیره می‌شود؛ کاربر مسئول پشتیبان‌گیری و حفظ امنیت داده‌های خود است.",
    "۵. پشتیبانی فنی در حد امکان و بر اساس توافق جداگانه ارائه می‌شود. برای تماس از اطلاعات توسعه‌دهنده در همین صفحه استفاده کنید.",
    "۶. توسعه‌دهنده حق به‌روزرسانی، تغییر یا توقف موقت سرویس‌های مرتبط با نرم‌افزار را محفوظ می‌دارد.",
    "۷. هرگونه کپی، توزیع یا استفاده تجاری از نرم‌افزار بدون اجازه کتبی توسعه‌دهنده ممنوع است.",
];

interface DeveloperInfoProps {
    onBack?: () => void;
}

export default function DeveloperInfo({ onBack }: DeveloperInfoProps) {
    const [imageError, setImageError] = useState(false);
    const showImage = !imageError;

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4 md:p-6 pb-12" dir="rtl">
            <PageHeader
                title="اطلاعات توسعه‌دهنده"
                onBack={onBack}
                backLabel="بازگشت"
            />
            <div className="w-full max-w-full mt-6 grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
                {/* Left side: Developer image + contact */}
                <div className="flex flex-col gap-6 w-full max-w-[420px]">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-xl border border-purple-100/60 dark:border-purple-900/40 p-4 flex justify-center"
                    >
                        {showImage ? (
                            <img
                                src={DEVELOPER.imagePath}
                                alt={DEVELOPER.name}
                                className="w-32 h-32 md:w-40 md:h-40 rounded-2xl object-cover border-2 border-purple-200 dark:border-purple-800"
                                onError={() => setImageError(true)}
                            />
                        ) : (
                            <div className="w-32 h-32 md:w-40 md:h-40 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center border-2 border-purple-200 dark:border-purple-800">
                                <span className="text-4xl md:text-5xl font-bold text-white">
                                    {DEVELOPER.name.split(" ").map((n) => n[0]).join("")}
                                </span>
                            </div>
                        )}
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.05 }}
                        className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-xl border border-purple-100/60 dark:border-purple-900/40 p-4 md:p-5 flex-1"
                    >
                        <div className="flex flex-col gap-4">
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800/40">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0">
                                    <User className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">نام</p>
                                    <p className="text-base font-bold text-gray-900 dark:text-white">{DEVELOPER.name}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shrink-0">
                                    <Phone className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">شماره تماس</p>
                                    <a
                                        href={`tel:${DEVELOPER.phone}`}
                                        className="text-base font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                                    >
                                        {DEVELOPER.phone}
                                    </a>
                                </div>
                            </div>
                            {DEVELOPER.emails.map((email) => (
                                <div key={email} className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/40">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shrink-0">
                                        <Mail className="w-5 h-5 text-white" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs text-gray-500 dark:text-gray-400">ایمیل</p>
                                        <a
                                            href={`mailto:${email}`}
                                            className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:underline break-all"
                                        >
                                            {email}
                                        </a>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                </div>

                {/* Right side: Terms and conditions */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.1 }}
                    className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-xl border border-purple-100/60 dark:border-purple-900/40 p-6 md:p-8 flex flex-col"
                >
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        <FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        شرایط و ضوابط
                    </h3>
                    <ul className="space-y-3 pr-1 text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                        {TERMS_PERSIAN.map((paragraph, index) => (
                            <li key={index} className="leading-relaxed break-words">
                                {paragraph}
                            </li>
                        ))}
                    </ul>
                </motion.div>
            </div>
        </div>
    );
}

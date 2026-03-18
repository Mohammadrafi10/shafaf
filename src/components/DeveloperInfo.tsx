import { motion } from "framer-motion";
import { useState } from "react";
import PageHeader from "./common/PageHeader";
import { Building2, MapPin, Phone, Mail, Users, FileText } from "lucide-react";
import companyLogo from "../assets/white_logo-2025-12-19-09-04-55-9891.png";
import sulaimanImage from "../assets/sulaiman.webp";

const COMPANY = {
    name: "گلکسی تکنالوژی",
    tagline: "راه‌حل‌های نرم‌افزاری واطلاعات",
    address: "مزار شریف، مارکیت مظفر",
    phone: "+93797548234",
    emails: ["info@galaxytechology.com"],
    officeHours: "شنبه تا پنج‌شنبه: ۰۸:۰۰ صبح – ۰۵:۰۰ عصر",
};

const TEAM = [
    { name: "سلیمان قاسمی", role: "انجینر", phone: "765993446", image: sulaimanImage },
];

const TERMS_PERSIAN = [
    "۱. استفاده از خدمات و محصولات شرکت گلکسی به منزله پذیرش این شرایط و ضوابط است.",
    "۲. خدمات «به همان شکل موجود» ارائه می‌شود و شرکت در قبال خسارات مستقیم یا غیرمستقیم ناشی از استفاده یا عدم امکان استفاده از خدمات مسئولیتی ندارد مگر طبق قرارداد کتبی.",
    "۳. مشتری موظف است از خدمات تنها در چارچوب قوانین جاری کشور استفاده کند و از آن برای فعالیت‌های غیرقانونی استفاده نکند.",
    "۴. امنیت و پشتیبان‌گیری از داده‌ها بر اساس نوع پروژه و توافق قراردادی انجام می‌شود؛ در صورت نبود قرارداد مشخص، مسئولیت نهایی حفظ نسخه پشتیبان با مشتری است.",
    "۵. زمان‌بندی، هزینه‌ها، و محدوده کار بر اساس پیشنهاد/قرارداد مشخص می‌شود و هر تغییر خارج از محدوده به توافق جداگانه نیاز دارد.",
    "۶. شرکت حق به‌روزرسانی، تغییر یا توقف موقت سرویس‌های مرتبط را برای بهبود کیفیت یا مسائل فنی محفوظ می‌دارد.",
    "۷. هرگونه کپی، توزیع یا استفاده تجاری از محتوا/کد/طراحی بدون اجازه کتبی شرکت ممنوع است.",
];

interface DeveloperInfoProps {
    onBack?: () => void;
}

export default function DeveloperInfo({ onBack }: DeveloperInfoProps) {
    const [logoError, setLogoError] = useState(false);
    const showLogo = !logoError;

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4 md:p-6 pb-12" dir="rtl">
            <PageHeader
                title="اطلاعات شرکت"
                onBack={onBack}
                backLabel="بازگشت"
            />
            <div className="w-full max-w-full mt-6 grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
                {/* Left side: Company summary + contact */}
                <div className="flex flex-col gap-6 w-full max-w-[420px]">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-xl border border-purple-100/60 dark:border-purple-900/40 p-4"
                    >
                        <div className="flex flex-col items-center gap-3">
                            {showLogo ? (
                                <img
                                    src={companyLogo}
                                    alt={COMPANY.name}
                                    className="w-full max-w-[280px] h-16 rounded-xl object-contain bg-black border border-purple-200 dark:border-purple-800 px-3 py-2"
                                    onError={() => setLogoError(true)}
                                />
                            ) : (
                                <div className="w-full max-w-[280px] h-16 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center border border-purple-200 dark:border-purple-800">
                                    <Building2 className="w-8 h-8 text-white" />
                                </div>
                            )}
                            <div className="text-center">
                                <p className="text-lg font-extrabold text-gray-900 dark:text-white truncate">
                                    {COMPANY.name}
                                </p>
                                <p className="text-sm text-gray-600 dark:text-gray-300 truncate">{COMPANY.tagline}</p>
                            </div>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.05 }}
                        className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-xl border border-purple-100/60 dark:border-purple-900/40 p-4 md:p-5 flex-1"
                    >
                        <div className="flex flex-col gap-4">
                            <div className="flex items-start gap-3 p-3 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800/40">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0">
                                    <MapPin className="w-5 h-5 text-white" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs text-gray-500 dark:text-gray-400">آدرس</p>
                                    <p className="text-sm font-semibold text-gray-900 dark:text-white break-words">
                                        {COMPANY.address}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shrink-0">
                                    <Phone className="w-5 h-5 text-white" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs text-gray-500 dark:text-gray-400">تماس</p>
                                    <a
                                        href={`tel:${COMPANY.phone}`}
                                        className="text-base font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                                        dir="ltr"
                                    >
                                        {COMPANY.phone}
                                    </a>
                                </div>
                            </div>
                            {COMPANY.emails.map((email) => (
                                <div
                                    key={email}
                                    className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/40"
                                >
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
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/30 border border-slate-200/60 dark:border-slate-700/50">
                                <p className="text-xs text-gray-500 dark:text-gray-400">ساعات کاری</p>
                                <p className="text-sm font-semibold text-gray-900 dark:text-white break-words">
                                    {COMPANY.officeHours}
                                </p>
                            </div>

                            <div className="p-3 rounded-xl bg-white/60 dark:bg-gray-900/25 border border-gray-200/60 dark:border-gray-700">
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2">
                                    <Users className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                                    انجینر
                                </p>
                                <div className="grid grid-cols-1 gap-3">
                                    {TEAM.map((m) => (
                                        <div
                                            key={m.name}
                                            className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40"
                                        >
                                            {m.image ? (
                                                <img
                                                    src={m.image}
                                                    alt={m.name}
                                                    className="w-10 h-10 rounded-xl object-cover border border-purple-200 dark:border-purple-800"
                                                />
                                            ) : (
                                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold">
                                                    {m.name
                                                        .split(" ")
                                                        .filter(Boolean)
                                                        .slice(0, 2)
                                                        .map((x) => x[0])
                                                        .join("")}
                                                </div>
                                            )}
                                            <div className="min-w-0">
                                                <p className="font-bold text-gray-900 dark:text-white break-words">
                                                    {m.name}
                                                </p>
                                                <p className="text-xs text-gray-600 dark:text-gray-400 break-words">
                                                    {m.role}
                                                </p>
                                                {m.phone && (
                                                    <a
                                                        href={`tel:${m.phone}`}
                                                        className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                                                        dir="ltr"
                                                    >
                                                        {m.phone}
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>

                {/* Right side: Company content */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.1 }}
                    className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-xl border border-purple-100/60 dark:border-purple-900/40 p-6 md:p-8 flex flex-col gap-6"
                >
                    <div className="p-4 rounded-2xl border border-gray-200/60 dark:border-gray-700 bg-white/50 dark:bg-gray-900/30">
                        <h4 className="font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
                            <FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                            شرایط و ضوابط
                        </h4>
                        <ul className="space-y-3 pr-1 text-base text-gray-700 dark:text-gray-300 leading-relaxed">
                            {TERMS_PERSIAN.map((paragraph, index) => (
                                <li key={index} className="leading-relaxed break-words">
                                    {paragraph}
                                </li>
                            ))}
                        </ul>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}

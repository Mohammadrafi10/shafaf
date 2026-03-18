import { motion } from "framer-motion";
import PageHeader from "./common/PageHeader";
import { User, Phone, Mail } from "lucide-react";

const DEVELOPER = {
    name: "Sulaiman Qasimi",
    phone: "765993446",
    email: "farzadqasimy@gmail.com",
};

interface DeveloperInfoProps {
    onBack?: () => void;
}

export default function DeveloperInfo({ onBack }: DeveloperInfoProps) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 p-4 md:p-6" dir="rtl">
            <PageHeader
                title="اطلاعات توسعه‌دهنده"
                onBack={onBack}
                backLabel="بازگشت"
            />
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="max-w-md mx-auto mt-8 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-xl border border-purple-100/60 dark:border-purple-900/40 p-6 md:p-8"
            >
                <div className="flex flex-col gap-6">
                    <div className="flex items-center gap-4 p-4 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800/40">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
                            <User className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">نام</p>
                            <p className="text-lg font-bold text-gray-900 dark:text-white">{DEVELOPER.name}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                            <Phone className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">شماره تماس</p>
                            <a
                                href={`tel:${DEVELOPER.phone}`}
                                className="text-lg font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                            >
                                {DEVELOPER.phone}
                            </a>
                        </div>
                    </div>
                    <div className="flex items-center gap-4 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/40">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
                            <Mail className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">ایمیل</p>
                            <a
                                href={`mailto:${DEVELOPER.email}`}
                                className="text-lg font-semibold text-emerald-600 dark:text-emerald-400 hover:underline break-all"
                            >
                                {DEVELOPER.email}
                            </a>
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

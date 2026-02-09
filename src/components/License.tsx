import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { getMachineId, validateLicenseKey, storeLicenseKey, registerLicenseOnServer, checkLicenseKeyWithServer, refreshLicenseExpiryFromServer, getLicenseExpiry } from "../utils/license";
import Footer from "./Footer";

interface LicenseProps {
  reason?: "expired" | "invalid" | null;
  onLicenseValid: () => void;
  onLicenseInvalid?: (reason: "expired" | "invalid") => void;
}

// Persian/Dari translations
const translations = {
  title: "فعال‌سازی نرم‌افزار",
  subtitle: "برای استفاده از نرم‌افزار، لطفاً کلید فعال‌سازی را وارد کنید",
  machineIdLabel: "شناسه دستگاه",
  machineIdDescription: "این شناسه را برای دریافت کلید فعال‌سازی ارسال کنید",
  copyButton: "کپی",
  copied: "کپی شد!",
  licenseKeyLabel: "کلید فعال‌سازی",
  licenseKeyPlaceholder: "کلید فعال‌سازی دریافتی را وارد کنید",
  activateButton: "فعال‌سازی",
  processing: "در حال پردازش...",
  instructions: {
    title: "راهنمای فعال‌سازی",
    step1: "شناسه دستگاه بالا را کپی کنید",
    step2: "شناسه را برای توسعه‌دهنده ارسال کنید",
    step3: "کلید فعال‌سازی دریافتی را در فیلد زیر وارد کنید",
    step4: "دکمه فعال‌سازی را کلیک کنید",
  },
  errors: {
    invalidKey: "کلید فعال‌سازی نامعتبر است",
    expired: "اعتبار لایسنس به پایان رسیده است. لطفاً با پشتیبانی تماس بگیرید.",
    generalError: "خطایی در فعال‌سازی رخ داد",
    machineIdError: "خطا در دریافت شناسه دستگاه",
  },
  success: {
    activated: "نرم‌افزار با موفقیت فعال شد",
  },
  contact: {
    forActivation: "برای فعال‌سازی لایسنس با این شماره تماس بگیرید",
    callNumber: "+93 79 754 8234",
  },
};

export default function License({ reason, onLicenseValid, onLicenseInvalid }: LicenseProps) {
  const [machineId, setMachineId] = useState<string>("");
  const [licenseKey, setLicenseKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMachineId, setLoadingMachineId] = useState(true);
  const [copied, setCopied] = useState(false);

  // Load machine ID on mount
  useEffect(() => {
    const loadMachineId = async () => {
      try {
        const id = await getMachineId();
        setMachineId(id);
      } catch (error) {
        console.error("Error loading machine ID:", error);
        toast.error(translations.errors.machineIdError);
      } finally {
        setLoadingMachineId(false);
      }
    };
    loadMachineId();
  }, []);

  const handleCopyMachineId = async () => {
    try {
      await navigator.clipboard.writeText(machineId);
      setCopied(true);
      toast.success(translations.copied);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Error copying to clipboard:", error);
      toast.error("خطا در کپی کردن شناسه");
    }
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!licenseKey.trim()) {
      toast.error("لطفاً کلید فعال‌سازی را وارد کنید");
      return;
    }

    setLoading(true);

    try {
      // Validate the license key
      const isValid = await validateLicenseKey(licenseKey.trim());
      
      if (isValid) {
        const trimmedKey = licenseKey.trim();
        await registerLicenseOnServer(trimmedKey);
        const serverResult = await checkLicenseKeyWithServer(trimmedKey);
        if (!serverResult.valid) {
          const invalidReason = serverResult.reason === "expired" ? "expired" : "invalid";
          onLicenseInvalid?.(invalidReason);
          toast.error(
            invalidReason === "expired"
              ? translations.errors.expired
              : translations.errors.invalidKey
          );
          setLoading(false);
          return;
        }
        await storeLicenseKey(trimmedKey);
        await refreshLicenseExpiryFromServer();
        // Also check the timer: ensure stored expiry is in the future before proceeding.
        const expiryIso = await getLicenseExpiry().catch(() => null);
        const expiryInPast = expiryIso ? (new Date(expiryIso).getTime() <= Date.now()) : true;
        if (expiryInPast) {
          onLicenseInvalid?.("expired");
          toast.error(translations.errors.expired);
          setLoading(false);
          return;
        }
        toast.success(translations.success.activated);
        setTimeout(() => {
          onLicenseValid();
        }, 500);
      } else {
        toast.error(translations.errors.invalidKey);
      }
    } catch (error: any) {
      console.error("Error validating license:", error);
      toast.error(error.toString() || translations.errors.generalError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            rotate: [0, 90, 0],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "linear"
          }}
          className="absolute -top-1/4 -right-1/4 w-96 h-96 bg-purple-300/20 dark:bg-purple-600/10 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            scale: [1, 1.3, 1],
            rotate: [0, -90, 0],
          }}
          transition={{
            duration: 25,
            repeat: Infinity,
            ease: "linear"
          }}
          className="absolute -bottom-1/4 -left-1/4 w-96 h-96 bg-blue-300/20 dark:bg-blue-600/10 rounded-full blur-3xl"
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-2xl relative z-10"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-3xl shadow-2xl p-8 border border-purple-100/50 dark:border-purple-900/30"
        >
          {/* Galaxy Logo & App Name Section */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
            className="flex flex-col items-center justify-center mb-6"
          >
            <motion.div
              whileHover={{ scale: 1.05, rotate: 5 }}
              transition={{ duration: 0.3 }}
              className="w-24 h-24 rounded-2xl flex items-center justify-center shadow-lg overflow-hidden bg-white mb-4"
            >
              <img 
                src="/Galaxy%20LOGO.jpeg"
                alt="Galaxy Technology Logo" 
                className="w-full h-full object-contain"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = "none";
                }}
              />
            </motion.div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-1">
              شفاف
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Galaxy Technology</p>
          </motion.div>

          {/* Title */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-center mb-8"
          >
            <h2
              className="text-3xl font-bold text-gray-900 dark:text-white mb-2"
              dir="rtl"
            >
              {translations.title}
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-base" dir="rtl">
              {translations.subtitle}
            </p>
          </motion.div>

          {reason === "expired" && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-xl bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-sm text-center"
              dir="rtl"
            >
              {translations.errors.expired}
            </motion.div>
          )}

          <form onSubmit={handleActivate} className="space-y-6" dir="rtl">
            {/* Machine ID Section */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {translations.machineIdLabel}
              </label>
              <div className="relative">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={loadingMachineId ? "در حال بارگذاری..." : machineId}
                    readOnly
                    className="flex-1 pr-4 pl-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
                    dir="ltr"
                  />
                  <motion.button
                    type="button"
                    onClick={handleCopyMachineId}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    disabled={loadingMachineId || !machineId}
                    className="px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-semibold rounded-xl transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {copied ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </motion.button>
                </div>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400" dir="rtl">
                  {translations.machineIdDescription}
                </p>
              </div>
            </motion.div>

            {/* Instructions */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-4 border border-purple-200 dark:border-purple-800"
            >
              <h3 className="text-sm font-semibold text-purple-900 dark:text-purple-300 mb-2" dir="rtl">
                {translations.instructions.title}
              </h3>
              <ul className="space-y-1 text-xs text-purple-700 dark:text-purple-400" dir="rtl">
                <li>• {translations.instructions.step1}</li>
                <li>• {translations.instructions.step2}</li>
                <li>• {translations.instructions.step3}</li>
                <li>• {translations.instructions.step4}</li>
              </ul>
            </motion.div>

            {/* Contact for activation */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
              className="flex flex-col items-center gap-2 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800"
              dir="rtl"
            >
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                {translations.contact.forActivation}
              </p>
              <a
                href="tel:+93797548234"
                dir="ltr"
                className="inline-flex items-center gap-2 text-lg font-bold text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {translations.contact.callNumber}
              </a>
            </motion.div>

            {/* License Key Input */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
            >
              <label
                htmlFor="licenseKey"
                className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
              >
                {translations.licenseKeyLabel}
              </label>
              <div className="relative">
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                </div>
                <motion.input
                  whileFocus={{ scale: 1.01 }}
                  id="licenseKey"
                  type="text"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  required
                  className="w-full pr-11 pl-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-200 dark:focus:ring-purple-900/30 transition-all duration-200 font-mono text-sm"
                  placeholder={translations.licenseKeyPlaceholder}
                  dir="ltr"
                />
              </div>
            </motion.div>

            {/* Activate Button: disabled when license is expired and no new key entered (user must enter a new key to try again) */}
            <motion.button
              type="submit"
              disabled={loading || loadingMachineId || (reason === "expired" && !licenseKey.trim())}
              whileHover={{ scale: loading || (reason === "expired" && !licenseKey.trim()) ? 1 : 1.02 }}
              whileTap={{ scale: loading || (reason === "expired" && !licenseKey.trim()) ? 1 : 0.98 }}
              className="w-full py-4 px-6 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-6"
            >
              {loading ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                  />
                  <span>{translations.processing}</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{translations.activateButton}</span>
                </>
              )}
            </motion.button>
          </form>
        </motion.div>

        {/* Footer */}
        <Footer className="mt-6" />
      </motion.div>
    </div>
  );
}

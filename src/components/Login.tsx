import { useState } from "react";
// framer-motion only used minimally now; heavy animations removed for low-spec support
import { AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { loginUser, registerUser, initUsersTable, type LoginResult } from "../utils/auth";
import { openDatabase, isDatabaseOpen } from "../utils/db";
import Footer from "./Footer";

interface LoginProps {
  onLoginSuccess: (user: { id: number; username: string; email: string }) => void;
}

// Dari translations
const translations = {
  login: {
    title: "خوش آمدید",
    subtitle: "به حساب کاربری خود وارد شوید",
    username: "نام کاربری",
    password: "رمز عبور",
    submit: "ورود",
    processing: "در حال پردازش...",
    switchText: "حساب کاربری ندارید؟ ثبت نام کنید",
  },
  signup: {
    title: "ایجاد حساب کاربری",
    subtitle: "برای شروع ثبت نام کنید",
    username: "نام کاربری",
    email: "ایمیل",
    password: "رمز عبور",
    confirmPassword: "تأیید رمز عبور",
    submit: "ثبت نام",
    processing: "در حال پردازش...",
    switchText: "قبلاً حساب کاربری دارید؟ وارد شوید",
  },
  errors: {
    passwordMismatch: "رمزهای عبور مطابقت ندارند",
    passwordTooShort: "رمز عبور باید حداقل ۶ کاراکتر باشد",
    invalidCredentials: "نام کاربری یا رمز عبور نامعتبر است",
    registrationFailed: "ثبت نام با خطا مواجه شد",
    loginFailed: "ورود با خطا مواجه شد",
    generalError: "خطایی رخ داد",
  },
  success: {
    loginSuccess: "با موفقیت وارد شدید",
    registrationSuccess: "حساب کاربری با موفقیت ایجاد شد",
  },
  placeholders: {
    username: "نام کاربری خود را وارد کنید",
    email: "ایمیل خود را وارد کنید",
    password: "رمز عبور خود را وارد کنید",
    confirmPassword: "رمز عبور را تأیید کنید",
  },
};

export default function Login({ onLoginSuccess }: LoginProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Ensure database is open (uses configured MYSQL_DATABASE / defaults)
      const dbOpen = await isDatabaseOpen();
      if (!dbOpen) {
        await openDatabase("");
      }

      // Initialize users table if needed
      try {
        await initUsersTable();
      } catch (err) {
        console.log("Table initialization:", err);
      }

      if (isLogin) {
        // Login
        const result: LoginResult = await loginUser(username, password);
        if (result.success && result.user) {
          toast.success(translations.success.loginSuccess);
          setTimeout(() => {
            onLoginSuccess(result.user!);
          }, 500);
        } else {
          toast.error(result.message || translations.errors.invalidCredentials);
        }
      } else {
        // Register
        if (password !== confirmPassword) {
          toast.error(translations.errors.passwordMismatch);
          setLoading(false);
          return;
        }

        if (password.length < 6) {
          toast.error(translations.errors.passwordTooShort);
          setLoading(false);
          return;
        }

        const result: LoginResult = await registerUser(username, email, password);
        if (result.success && result.user) {
          toast.success(translations.success.registrationSuccess);
          setTimeout(() => {
            onLoginSuccess(result.user!);
          }, 1000);
        } else {
          toast.error(result.message || translations.errors.registrationFailed);
        }
      }
    } catch (err: any) {
      toast.error(err.toString() || translations.errors.generalError);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleMode = () => {
    setIsLogin(!isLogin);
    setPassword("");
    setConfirmPassword("");
  };

  const currentTranslations = isLogin ? translations.login : translations.signup;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative Background Elements */}
      {/* Reduced background for low-spec machines (no animated blobs) */}

      <div className="w-full max-w-md relative z-10">
        <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-3xl shadow-2xl p-8 border border-purple-100/50 dark:border-purple-900/30">
          {/* Logo/Icon Section */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-blue-500 rounded-2xl flex items-center justify-center shadow-lg">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>

          <div className="text-center mb-8">
              <h1
                className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-2"
                dir="rtl"
              >
                {currentTranslations.title}
              </h1>
              <p
                className="text-gray-600 dark:text-gray-400 text-base"
                dir="rtl"
              >
                {currentTranslations.subtitle}
              </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" dir="rtl">
            {/* Username Field */}
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
              >
                {currentTranslations.username}
              </label>
              <div className="relative">
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="w-full pr-11 pl-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-200 dark:focus:ring-purple-900/30 transition-all duration-200"
                  placeholder={translations.placeholders.username}
                  dir="rtl"
                />
              </div>
            </motion.div>

            {/* Email Field (Signup only) */}
            {!isLogin && (
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
                >
                  {translations.signup.email}
                </label>
                <div className="relative">
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full pr-11 pl-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-200 dark:focus:ring-purple-900/30 transition-all duration-200"
                    placeholder={translations.placeholders.email}
                    dir="rtl"
                  />
                </div>
              </div>
            )}

            {/* Password Field */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
              >
                {currentTranslations.password}
              </label>
              <div className="relative">
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full pr-11 pl-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-200 dark:focus:ring-purple-900/30 transition-all duration-200"
                  placeholder={translations.placeholders.password}
                  dir="rtl"
                />
              </div>
            </div>

            {/* Confirm Password Field (Signup only) */}
            {!isLogin && (
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2"
                >
                  {translations.signup.confirmPassword}
                </label>
                <div className="relative">
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full pr-11 pl-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-200 dark:focus:ring-purple-900/30 transition-all duration-200"
                    placeholder={translations.placeholders.confirmPassword}
                    dir="rtl"
                  />
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 px-6 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-6"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>{currentTranslations.processing}</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {isLogin ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    )}
                  </svg>
                  <span>{currentTranslations.submit}</span>
                </>
              )}
            </button>
          </form>

          {/* Toggle Mode Button */}
          <div className="mt-6 text-center">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-white/90 dark:bg-gray-800/90 text-gray-500 dark:text-gray-400">
                  یا
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleToggleMode}
              className="mt-4 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 font-semibold transition-colors duration-200 flex items-center justify-center gap-2 mx-auto"
              dir="rtl"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              {currentTranslations.switchText}
            </button>
          </div>
        </div>

        {/* Footer */}
        <Footer className="mt-6" />
      </div>
    </div>
  );
}

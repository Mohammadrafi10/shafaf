import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  openDatabase,
  isDatabaseOpen,
  createDatabase,
  saveBackupToPath,
  restoreDatabase,
  createDailyBackup,
} from "./utils/db";
import { save, open } from "@tauri-apps/plugin-dialog";
import toast from "react-hot-toast";
import { getDashboardStats, formatPersianNumber, formatLargeNumber } from "./utils/dashboard";
import { playClickSound } from "./utils/sound";
import { getCompanySettings, initCompanySettingsTable, type CompanySettings as CompanySettingsType } from "./utils/company";
import { applyFont } from "./utils/fonts";
import { isLicenseValid } from "./utils/license";
import { checkForUpdatesOnStartup, checkForUpdates, installUpdate } from "./utils/updater";
import { startCredentialSync } from "./utils/puter";
import Login from "./components/Login";
import License from "./components/License";
import CurrencyManagement from "./components/Currency";
import SupplierManagement from "./components/Supplier";
import ProductManagement from "./components/Product";
import PurchaseManagement from "./components/Purchase";
import SalesManagement from "./components/Sales";
import UnitManagement from "./components/Unit";
import CustomerManagement from "./components/Customer";
import ExpenseManagement from "./components/Expense";
import EmployeeManagement from "./components/Employee";
import SalaryManagement from "./components/Salary";
import DeductionManagement from "./components/Deduction";
import UserManagement from "./components/UserManagement";
import ProfileEdit from "./components/ProfileEdit";
import CompanySettings from "./components/CompanySettings";
import SaleInvoice from "./components/SaleInvoice";
import AccountManagement from "./components/Account";
import PurchasePaymentManagement from "./components/PurchasePayment";
import SalesPaymentManagement from "./components/SalesPayment";
import ServicesManagement from "./components/Services";
import AiReport from "./components/AiReport";
import Report from "./components/Report";
import AiCreateUpdateModal from "./components/AiCreateUpdateModal";
import Footer from "./components/Footer";
import "./App.css";
import { SaleWithItems, SalePayment } from "./utils/sales";
import { Customer } from "./utils/customer";
import { Product } from "./utils/product";
import { Unit } from "./utils/unit";

interface User {
  id: number;
  username: string;
  email: string;
}

type Page = "dashboard" | "currency" | "supplier" | "product" | "purchase" | "sales" | "unit" | "customer" | "expense" | "employee" | "salary" | "deduction" | "users" | "profile" | "invoice" | "company" | "account" | "purchasePayment" | "salesPayment" | "services" | "servicePayment" | "aiReport" | "report";

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [licenseValid, setLicenseValid] = useState<boolean | null>(null);
  const [dbReady, setDbReady] = useState<boolean | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<Page>("dashboard");
  const [dashboardStats, setDashboardStats] = useState({
    productsCount: 0,
    suppliersCount: 0,
    purchasesCount: 0,
    monthlyIncome: 0,
    deductionsCount: 0,
    totalDeductions: 0,
  });
  const [loadingStats, setLoadingStats] = useState(false);
  const [companySettings, setCompanySettings] = useState<CompanySettingsType | null>(null);
  const [invoiceData, setInvoiceData] = useState<{
    saleData: SaleWithItems;
    customer: Customer;
    products: Product[];
    units: Unit[];
    payments: SalePayment[];
    currencyName?: string;
  } | null>(null);
  const [aiCreateUpdateOpen, setAiCreateUpdateOpen] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{
    available: boolean;
    version?: string;
    date?: string;
    body?: string;
  } | null>(null);

  // Theme state - initialize from localStorage or system preference
  const [isDark, setIsDark] = useState(() => {
    try {
      const saved = localStorage.getItem('theme');
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
      // No saved preference, use system
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });

  // Apply theme to document on mount and whenever it changes
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  const toggleTheme = () => {
    setIsDark(prev => {
      const newValue = !prev;
      // Apply immediately for instant visual feedback
      const root = document.documentElement;
      if (newValue) {
        root.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      } else {
        root.classList.remove('dark');
        localStorage.setItem('theme', 'light');
      }
      return newValue;
    });
  };

  // Check for updates on mount
  useEffect(() => {
    // Check for updates silently in the background
    checkForUpdatesOnStartup().catch((error) => {
      // Silently fail - updates are optional
      console.log("Update check:", error);
    });
  }, []);

  // Sync Puter credentials from ai.html
  useEffect(() => {
    const cleanup = startCredentialSync(5000); // Check every 5 seconds
    return cleanup;
  }, []);

  // Daily database backup: start when user logs in, run once after delay then every 24 hours
  useEffect(() => {
    if (!user) return;

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const INITIAL_DELAY_MS = 60 * 1000; // 1 minute after login so DB is open

    const runBackup = async () => {
      try {
        const path = await createDailyBackup();
        console.log("Daily backup completed:", path);
      } catch (err) {
        console.error("Daily backup failed:", err);
      }
    };

    const initialTimer = window.setTimeout(runBackup, INITIAL_DELAY_MS);
    const intervalId = window.setInterval(runBackup, ONE_DAY_MS);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
    };
  }, [user]);

  // Check license validity on mount
  useEffect(() => {
    const checkLicense = async () => {
      try {
        const valid = await isLicenseValid();
        setLicenseValid(valid);
      } catch (error) {
        console.error("Error checking license:", error);
        setLicenseValid(false);
      }
    };
    checkLicense();
  }, []);

  // Ensure database exists and is open before showing login.
  // If DB/tables exist, open; else create DB from env and run schema (db.sql).
  const ensureDatabase = async () => {
    setDbError(null);
    setDbReady(null);
    try {
      const alreadyOpen = await isDatabaseOpen();
      if (alreadyOpen) {
        setDbReady(true);
        return;
      }
      try {
        await openDatabase("");
        setDbReady(true);
        return;
      } catch (openErr: any) {
        // e.g. "Unknown database" or connection error — try creating DB and running schema
        const msg = openErr?.message ?? String(openErr);
        console.warn("Database open failed, will try create:", msg);
      }
      try {
        await createDatabase("");
        setDbReady(true);
      } catch (createErr: any) {
        const msg = createErr?.message ?? String(createErr);
        setDbError(msg);
        setDbReady(false);
      }
    } catch (err: any) {
      setDbError(err?.message ?? "Database check failed");
      setDbReady(false);
    }
  };

  // Run database check when license is valid (before we might show login).
  useEffect(() => {
    if (licenseValid !== true) return;
    ensureDatabase();
  }, [licenseValid]);

  // Add global click sound handler
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      // Only play sound for interactive elements (buttons, links, etc.)
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'BUTTON' ||
        target.tagName === 'A' ||
        target.closest('button') ||
        target.closest('a') ||
        target.getAttribute('role') === 'button' ||
        target.onclick !== null
      ) {
        playClickSound();
      }
    };

    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('click', handleClick);
    };
  }, []);

  // Load company settings and apply font
  useEffect(() => {
    const loadCompanySettings = async () => {
      try {
        await initCompanySettingsTable();
        const settings = await getCompanySettings();
        setCompanySettings(settings);
        
        // Apply font from settings
        if (settings.font) {
          await applyFont(settings.font);
        } else {
          await applyFont(null); // Use system default
        }
      } catch (error) {
        console.error("Error loading company settings:", error);
      }
    };
    if (user) {
      loadCompanySettings();
    }
  }, [user]);

  // Load dashboard stats when on dashboard page
  useEffect(() => {
    const loadStats = async () => {
      if (currentPage === "dashboard" && user) {
        try {
          setLoadingStats(true);
          const stats = await getDashboardStats();
          setDashboardStats(stats);
        } catch (error) {
          console.error("Error loading dashboard stats:", error);
        } finally {
          setLoadingStats(false);
        }
      }
    };
    loadStats();
  }, [currentPage, user]);

  // Show license screen if license is not valid
  if (licenseValid === null) {
    // Still checking license, show loading or nothing
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!licenseValid) {
    return <License onLicenseValid={() => setLicenseValid(true)} />;
  }

  // Before login: ensure database exists and tables exist (open or create + import db.sql)
  if (!user) {
    if (dbReady === null) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full"
            />
            <p className="text-gray-600 dark:text-gray-400">در حال بررسی پایگاه داده...</p>
          </div>
        </div>
      );
    }
    if (dbReady === false) {
      const isSha256Auth = dbError != null && dbError.includes("sha256_password");
      return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 max-w-md w-full text-center">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">خطا در اتصال به پایگاه داده</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 break-all">{dbError ?? "پایگاه داده در دسترس نیست."}</p>
            {isSha256Auth && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mb-4 text-right">
                این برنامه فقط با کاربران MySQL با پلاگین mysql_native_password یا caching_sha2_password کار می‌کند. روی سرور MySQL اجرا کنید: ALTER USER &apos;user&apos;@&apos;host&apos; IDENTIFIED WITH mysql_native_password BY &apos;password&apos;; FLUSH PRIVILEGES;
              </p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-4">از صحت تنظیمات MySQL در فایل .env اطمینان حاصل کنید.</p>
            <button
              type="button"
              onClick={() => ensureDatabase()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              تلاش مجدد
            </button>
          </div>
        </div>
      );
    }
    return <Login onLoginSuccess={(user) => setUser(user)} />;
  }

  const handleLogout = () => {
    setUser(null);
    setCurrentPage("dashboard");
  };

  const handleBackupDatabase = async () => {
    try {
      // Open save dialog first so user picks where to save
      const filePath = await save({
        defaultPath: `db-backup-${new Date().toISOString().split('T')[0]}.sql`,
        filters: [{
          name: 'MySQL Dump',
          extensions: ['sql']
        }]
      });

      if (filePath) {
        // Backend copies the database to the selected path (avoids fs plugin scope limits)
        await saveBackupToPath(filePath);
        toast.success("پشتیبان‌گیری با موفقیت انجام شد");
      }
    } catch (error: any) {
      console.error("Error backing up database:", error);
      if (error.message && !error.message.includes("cancelled")) {
        toast.error("خطا در پشتیبان‌گیری از پایگاه داده");
      }
    }
  };

  const handleRestoreDatabase = async () => {
    try {
      // Open file dialog to select backup file
      const filePath = await open({
        filters: [{
          name: 'MySQL Dump',
          extensions: ['sql']
        }],
        title: 'انتخاب فایل پشتیبان'
      });

      if (filePath && typeof filePath === 'string') {
        // Confirm with user
        const confirmed = window.confirm(
          "آیا مطمئن هستید که می‌خواهید پایگاه داده را بازگردانی کنید؟ این عمل تمام داده‌های فعلی را جایگزین می‌کند."
        );

        if (confirmed) {
          await restoreDatabase(filePath);
          toast.success("بازگردانی پایگاه داده با موفقیت انجام شد");
          
          // Reload the page to refresh all data
          window.location.reload();
        }
      }
    } catch (error: any) {
      console.error("Error restoring database:", error);
      if (error.message && !error.message.includes("cancelled")) {
        toast.error("خطا در بازگردانی پایگاه داده");
      }
    }
  };

  const handleCheckForUpdates = async () => {
    try {
      setCheckingUpdate(true);
      const updateInfo = await checkForUpdates();
      
      if (updateInfo?.available) {
        setUpdateInfo(updateInfo);
        toast.success(
          `بروزرسانی جدید موجود است! نسخه ${updateInfo.version}`,
          {
            duration: 5000,
          }
        );
        // Show install button separately
        setTimeout(() => {
          if (window.confirm(`بروزرسانی نسخه ${updateInfo.version} موجود است. آیا می‌خواهید نصب کنید؟`)) {
            handleInstallUpdate();
          }
        }, 100);
      } else {
        setUpdateInfo(null);
        toast.success("شما از آخرین نسخه استفاده می‌کنید");
      }
    } catch (error: any) {
      console.error("Error checking for updates:", error);
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
    } catch (error: any) {
      console.error("Error installing update:", error);
      toast.error("خطا در نصب بروزرسانی", { id: "update-install" });
    }
  };

  // Show currency page if selected
  if (currentPage === "currency") {
    return (
      <CurrencyManagement onBack={() => setCurrentPage("dashboard")} />
    );
  }

  // Show supplier page if selected
  if (currentPage === "supplier") {
    return (
      <SupplierManagement
        onBack={() => setCurrentPage("dashboard")}
        onNavigateToBalancePage={() => setCurrentPage("purchasePayment")}
      />
    );
  }

  // Show unit page if selected
  if (currentPage === "unit") {
    return (
      <UnitManagement onBack={() => setCurrentPage("dashboard")} />
    );
  }

  if (currentPage === "purchase") {
    return (
      <PurchaseManagement onBack={() => setCurrentPage("dashboard")} />
    );
  }

  // Show sales page if selected
  if (currentPage === "sales") {
    return (
      <SalesManagement 
        onBack={() => setCurrentPage("dashboard")}
        onOpenInvoice={(data) => {
          setInvoiceData(data);
          setCurrentPage("invoice");
        }}
      />
    );
  }

  // Show product page if selected
  if (currentPage === "product") {
    return (
      <ProductManagement onBack={() => setCurrentPage("dashboard")} />
    );
  }

  // Show customer page if selected
  if (currentPage === "customer") {
    return (
      <CustomerManagement
        onBack={() => setCurrentPage("dashboard")}
        onNavigateToBalancePage={() => setCurrentPage("salesPayment")}
      />
    );
  }

  // Show expense page if selected
  if (currentPage === "expense") {
    return (
      <ExpenseManagement onBack={() => setCurrentPage("dashboard")} />
    );
  }

  // Show employee page if selected
  if (currentPage === "employee") {
    return (
      <EmployeeManagement 
        onBack={() => setCurrentPage("dashboard")}
        onNavigateToSalary={() => setCurrentPage("salary")}
      />
    );
  }

  // Show salary page if selected
  if (currentPage === "salary") {
    return (
      <SalaryManagement 
        onBack={() => setCurrentPage("dashboard")}
        onNavigateToDeduction={() => setCurrentPage("deduction")}
      />
    );
  }

  // Show deduction page if selected
  if (currentPage === "deduction") {
    return (
      <DeductionManagement onBack={() => setCurrentPage("dashboard")} />
    );
  }

  // Show users management page if selected
  if (currentPage === "users") {
    return (
      <UserManagement
        onBack={() => setCurrentPage("dashboard")}
        currentUser={user}
      />
    );
  }

  // Show profile edit page if selected
  if (currentPage === "profile") {
    return (
      <ProfileEdit
        userId={user.id}
        onBack={() => setCurrentPage("dashboard")}
        onProfileUpdate={(updatedUser) => {
          setUser({
            id: updatedUser.id,
            username: updatedUser.username,
            email: updatedUser.email,
          });
        }}
      />
    );
  }

  // Show invoice page if selected
  if (currentPage === "invoice" && invoiceData) {
    return (
      <SaleInvoice
        saleData={invoiceData.saleData}
        customer={invoiceData.customer}
        products={invoiceData.products}
        units={invoiceData.units}
        payments={invoiceData.payments}
        companySettings={companySettings}
        currencyName={invoiceData.currencyName}
        onClose={() => setCurrentPage("sales")}
      />
    );
  }

  // Show company settings page if selected
  if (currentPage === "company") {
    return (
      <CompanySettings
        onBack={() => setCurrentPage("dashboard")}
        onNavigate={(page) => setCurrentPage(page)}
      />
    );
  }

  // Show account page if selected
  if (currentPage === "account") {
    return (
      <AccountManagement onBack={() => setCurrentPage("dashboard")} />
    );
  }

  // Show purchase payment page if selected
  if (currentPage === "purchasePayment") {
    return (
      <PurchasePaymentManagement onBack={() => setCurrentPage("dashboard")} />
    );
  }

  // Show sales payment page if selected
  if (currentPage === "salesPayment") {
    return (
      <SalesPaymentManagement onBack={() => setCurrentPage("dashboard")} />
    );
  }

  // Show services page if selected
  if (currentPage === "services") {
    return (
      <ServicesManagement onBack={() => setCurrentPage("dashboard")} />
    );
  }

  // Show AI report page if selected
  if (currentPage === "aiReport") {
    return (
      <AiReport onBack={() => setCurrentPage("dashboard")} />
    );
  }

  // Show report page if selected
  if (currentPage === "report") {
    return (
      <Report onBack={() => setCurrentPage("dashboard")} />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 relative overflow-hidden" dir="rtl">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-300 dark:bg-purple-900 rounded-full mix-blend-multiply dark:mix-blend-soft-light filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-300 dark:bg-blue-900 rounded-full mix-blend-multiply dark:mix-blend-soft-light filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-indigo-300 dark:bg-indigo-900 rounded-full mix-blend-multiply dark:mix-blend-soft-light filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>
      {/* Header */}
      <motion.header
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl border-b border-purple-100 dark:border-purple-900/30 sticky top-0 z-50"
      >
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            {/* Logo & Brand */}
            <div className="flex items-center gap-4">
              <motion.div
                whileHover={{ scale: 1.05, rotate: 5 }}
                transition={{ duration: 0.3 }}
                className="w-12 h-12 rounded-xl flex items-center justify-center shadow-lg overflow-hidden bg-white"
              >
                <img 
                  src="/logo.jpeg" 
                  alt="شفاف Logo" 
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                  }}
                />
              </motion.div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                  شفاف
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">{companySettings?.name || "سیستم مدیریت مالی"}</p>
              </div>
            </div>

            {/* User Profile */}
            <div className="flex items-center gap-4">
              <div className="text-left">
                <p className="font-semibold text-gray-900 dark:text-white">{user.username}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
              </div>
              
              {/* Theme Toggle */}
              <motion.button
                whileHover={{ scale: 1.1, rotate: 15 }}
                whileTap={{ scale: 0.95 }}
                onClick={toggleTheme}
                className="w-12 h-12 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-full flex items-center justify-center shadow-lg cursor-pointer hover:shadow-xl transition-all duration-200 group relative overflow-hidden"
                title={isDark ? "روشن کردن تم" : "تاریک کردن تم"}
              >
                <motion.div
                  initial={false}
                  animate={{ rotate: isDark ? 180 : 0 }}
                  transition={{ duration: 0.3 }}
                  className="relative z-10"
                >
                  {isDark ? (
                    <svg className="w-6 h-6 text-yellow-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6 text-slate-800" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                  )}
                </motion.div>
                <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
              </motion.button>
              
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleBackupDatabase}
                className="w-12 h-12 bg-gradient-to-br from-amber-500 to-orange-500 rounded-full flex items-center justify-center shadow-lg cursor-pointer hover:shadow-xl transition-all duration-200 group relative"
                title="پشتیبان‌گیری از پایگاه داده"
              >
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4 4m4-4V12" />
                </svg>
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleRestoreDatabase}
                className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center shadow-lg cursor-pointer hover:shadow-xl transition-all duration-200 group relative"
                title="بازگردانی پایگاه داده"
              >
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleCheckForUpdates}
                disabled={checkingUpdate}
                className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center shadow-lg cursor-pointer hover:shadow-xl transition-all duration-200 group relative disabled:opacity-50 disabled:cursor-not-allowed"
                title="بررسی بروزرسانی"
              >
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
                {updateInfo?.available && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-xs font-bold">!</span>
                  </div>
                )}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setCurrentPage("profile")}
                className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center shadow-lg cursor-pointer hover:shadow-xl transition-all duration-200 group relative"
                title="ویرایش پروفایل"
              >
                <span className="text-white font-bold text-lg group-hover:scale-110 transition-transform">
                  {user.username.charAt(0).toUpperCase()}
                </span>
                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center shadow-md border-2 border-white dark:border-gray-800">
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </div>
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleLogout}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white font-semibold rounded-xl shadow-md hover:shadow-lg transition-all duration-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                خروج
              </motion.button>
            </div>
          </div>
        </div>
      </motion.header>

      <main className="relative max-w-7xl mx-auto px-6 py-8 z-10">
        {/* Welcome Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mb-12 relative"
        >
          <div className="relative inline-block">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="absolute -inset-4 bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 rounded-3xl blur-2xl opacity-20 dark:opacity-30"
            ></motion.div>
            <div className="relative bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-3xl p-8 border border-purple-200/50 dark:border-purple-800/30 shadow-2xl">
              <motion.h2 
                className="text-5xl font-extrabold bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 bg-clip-text text-transparent mb-3"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
              >
                خوش آمدید، {user.username}! 👋
              </motion.h2>
              <motion.p 
                className="text-gray-700 dark:text-gray-300 text-xl font-medium"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
              >
                به پنل مدیریت مالی شفاف خوش آمدید. از منوی زیر بخش مورد نظر را انتخاب کنید.
              </motion.p>
            </div>
          </div>
        </motion.div>

        {/* Quick Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6 mb-12"
        >
          {[
            { 
              label: "اجناس", 
              value: loadingStats ? "..." : formatPersianNumber(dashboardStats.productsCount), 
              icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4", 
              color: "from-purple-500 to-indigo-500",
              bgGradient: "from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20"
            },
            { 
              label: "تمویل کنندگان", 
              value: loadingStats ? "..." : formatPersianNumber(dashboardStats.suppliersCount), 
              icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z", 
              color: "from-green-500 to-emerald-500",
              bgGradient: "from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20"
            },
            { 
              label: "خریداری ها", 
              value: loadingStats ? "..." : formatPersianNumber(dashboardStats.purchasesCount), 
              icon: "M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z", 
              color: "from-blue-500 to-cyan-500",
              bgGradient: "from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20"
            },
            { 
              label: "درآمد ماهانه", 
              value: loadingStats ? "..." : formatLargeNumber(dashboardStats.monthlyIncome), 
              icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z", 
              color: "from-amber-500 to-orange-500",
              bgGradient: "from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20"
            },
            { 
              label: "کسرها", 
              value: loadingStats ? "..." : formatPersianNumber(dashboardStats.deductionsCount), 
              icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z", 
              color: "from-red-500 to-pink-500",
              bgGradient: "from-red-50 to-pink-50 dark:from-red-900/20 dark:to-pink-900/20"
            },
          ].map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.3 + index * 0.1, type: "spring", stiffness: 200 }}
              whileHover={{ y: -8, scale: 1.02, transition: { duration: 0.2 } }}
              className={`relative bg-gradient-to-br ${stat.bgGradient} backdrop-blur-xl rounded-3xl shadow-xl hover:shadow-2xl p-6 border border-white/50 dark:border-gray-700/30 transition-all duration-300 overflow-hidden group`}
            >
              {/* Animated background glow */}
              <div className={`absolute inset-0 bg-gradient-to-br ${stat.color} opacity-0 group-hover:opacity-10 transition-opacity duration-300`}></div>
              
              <div className="relative flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wide">{stat.label}</p>
                  <p className="text-3xl font-extrabold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
                    {stat.value}
                  </p>
                </div>
                <motion.div 
                  className={`w-16 h-16 bg-gradient-to-br ${stat.color} rounded-2xl flex items-center justify-center shadow-lg group-hover:shadow-xl group-hover:scale-110 transition-all duration-300`}
                  whileHover={{ rotate: [0, -10, 10, -10, 0] }}
                  transition={{ duration: 0.5 }}
                >
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={stat.icon} />
                  </svg>
                </motion.div>
              </div>
              
              {/* Shine effect */}
              <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
            </motion.div>
          ))}
        </motion.div>

        {/* Navigation Cards */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-3">
            <svg className="w-7 h-7 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            بخش های سیستم
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                title: "مدیریت اجناس",
                description: "افزودن، ویرایش و مدیریت اجناس و محصولات",
                icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
                color: "from-indigo-500 to-violet-500",
                page: "product" as Page,
              },
              {
                title: "مدیریت خریداری",
                description: "ثبت و پیگیری خریداری ها از تمویل کننده ها",
                icon: "M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z",
                color: "from-purple-500 to-blue-500",
                page: "purchase" as Page,
              },
              {
                title: "مدیریت فروشات",
                description: "ثبت و مدیریت فروشات، صدور فاکتور و کنترل موجودی",
                icon: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z",
                color: "from-emerald-500 to-teal-500",
                page: "sales" as Page,
              },
              {
                title: "خدمات",
                description: "ثبت و مدیریت خدمات با آیتم‌های آزاد (نام و قیمت)",
                icon: "M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
                color: "from-teal-500 to-cyan-500",
                page: "services" as Page,
              },
              {
                title: "تمویل کننده ها",
                description: "مدیریت اطلاعات تمویل کننده ها و توزیع کننده ها",
                icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
                color: "from-green-500 to-teal-500",
                page: "supplier" as Page,
              },
              {
                title: "مدیریت مشتری ها",
                description: "افزودن، ویرایش و مدیریت اطلاعات مشتریان",
                icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
                color: "from-indigo-500 to-blue-500",
                page: "customer" as Page,
              },
              {
                title: "مدیریت مصارف",
                description: "ثبت و مدیریت مصارف و هزینه‌ها",
                icon: "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z",
                color: "from-red-500 to-pink-500",
                page: "expense" as Page,
              },
              {
                title: "مدیریت کارمندان",
                description: "افزودن، ویرایش و مدیریت اطلاعات کارمندان",
                icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
                color: "from-violet-500 to-purple-500",
                page: "employee" as Page,
              },
              {
                title: "مدیریت کاربران",
                description: "ایجاد، ویرایش و مدیریت کاربران سیستم",
                icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m9 5.197v-1a6 6 0 00-9-5.197",
                color: "from-cyan-500 to-blue-500",
                page: "users" as Page,
              },
              {
                title: "تنظیمات شرکت",
                description: "ویرایش اطلاعات و تنظیمات شرکت",
                icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
                color: "from-emerald-500 to-teal-500",
                page: "company" as Page,
              },
              {
                title: "گزارش‌ها",
                description: "تولید و خروجی گزارش‌های مختلف با فیلتر تاریخ",
                icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
                color: "from-indigo-500 to-purple-500",
                page: "report" as Page,
              },
              {
                title: "گزارش هوشمند (AI)",
                description: "تولید گزارش جدول و چارت بر اساس درخواست متنی",
                icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
                color: "from-violet-500 to-fuchsia-500",
                page: "aiReport" as Page,
              },
            ].map((item, index) => (
              <motion.button
                key={item.title}
                onClick={() => setCurrentPage(item.page)}
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.5 + index * 0.05, type: "spring", stiffness: 200 }}
                whileHover={{
                  y: -10,
                  scale: 1.02,
                  transition: { duration: 0.2 }
                }}
                whileTap={{ scale: 0.98 }}
                className="group relative bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl rounded-2xl shadow-lg hover:shadow-2xl p-5 border border-purple-200/50 dark:border-purple-800/30 transition-all duration-300 text-right overflow-hidden"
              >
                {/* Gradient overlay on hover */}
                <div className={`absolute inset-0 bg-gradient-to-br ${item.color} opacity-0 group-hover:opacity-10 transition-opacity duration-300`}></div>
                
                <div className="relative flex items-center gap-4">
                  <motion.div 
                    className={`w-14 h-14 bg-gradient-to-br ${item.color} rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all duration-300 relative overflow-hidden`}
                    whileHover={{ rotate: [0, -5, 5, -5, 0] }}
                    transition={{ duration: 0.5 }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <svg className="w-7 h-7 text-white relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                    </svg>
                  </motion.div>
                  <div className="flex-1">
                    <h4 className="text-lg font-bold text-gray-900 dark:text-white group-hover:bg-gradient-to-r group-hover:from-purple-600 group-hover:to-blue-600 group-hover:bg-clip-text group-hover:text-transparent transition-all duration-300">
                      {item.title}
                    </h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-1">
                      {item.description}
                    </p>
                  </div>
                  <motion.svg
                    className="w-6 h-6 text-gray-400 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-all duration-300"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    whileHover={{ x: -5 }}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </motion.svg>
                </div>
                
                {/* Shine effect */}
                <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/30 to-transparent"></div>
              </motion.button>
            ))}
          </div>
        </motion.div>

        {/* Footer */}
        <Footer className="mt-16" />
      </main>

      {/* AI Create/Update FAB - dashboard only */}
      <motion.button
        onClick={() => setAiCreateUpdateOpen(true)}
        className="fixed bottom-6 left-6 z-40 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white font-medium hover:shadow-2xl hover:scale-105 transition-all"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.98 }}
        title="ایجاد و بروزرسانی با AI"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <span>ایجاد/بروزرسانی AI</span>
      </motion.button>

      <AiCreateUpdateModal
        open={aiCreateUpdateOpen}
        onClose={() => setAiCreateUpdateOpen(false)}
        onSuccess={() => {
          setAiCreateUpdateOpen(false);
          getDashboardStats().then(setDashboardStats);
        }}
      />
    </div>
  );
}

export default App;

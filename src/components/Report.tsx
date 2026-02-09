import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import moment from "moment-jalaali";
import PersianDatePicker from "./PersianDatePicker";
import {
  generateSalesReport,
  generateServicesReport,
  generatePurchaseReport,
  generateExpenseReport,
  generateAccountReport,
  generateProductReport,
  generateCustomerReport,
  generateSupplierReport,
  generateReceivablesReport,
  generatePayablesReport,
  generateProfitReport,
  type ReportData,
} from "../utils/report";
import { exportReportToExcel } from "../utils/reportExport";
import { georgianToPersian } from "../utils/date";
import { getCustomers, type Customer } from "../utils/customer";
import { getSuppliers, type Supplier } from "../utils/supplier";
import { getCompanySettings, type CompanySettings } from "../utils/company";

interface ReportProps {
  onBack: () => void;
}

type ReportType =
  | "sales"
  | "services"
  | "purchases"
  | "expenses"
  | "accounts"
  | "products"
  | "customers"
  | "suppliers"
  | "receivables"
  | "payables"
  | "profit";

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: "sales", label: "گزارش فروشات" },
  { value: "services", label: "گزارش خدمات" },
  { value: "purchases", label: "گزارش خریداری‌ها" },
  { value: "expenses", label: "گزارش مصارف" },
  { value: "accounts", label: "گزارش حساب‌ها" },
  { value: "products", label: "گزارش محصولات" },
  { value: "customers", label: "گزارش مشتریان" },
  { value: "suppliers", label: "گزارش تمویل‌کنندگان" },
  { value: "receivables", label: "لیست مطالبات (مشتریان)" },
  { value: "payables", label: "لیست بدهی‌ها (تمویل‌کنندگان)" },
  { value: "profit", label: "گزارش سود" },
];

const DATE_PRESETS: { id: string; label: string; getRange: () => { from: string; to: string } }[] = [
  {
    id: "today",
    label: "امروز",
    getRange: () => {
      const d = moment().format("YYYY-MM-DD");
      return { from: d, to: d };
    },
  },
  {
    id: "week",
    label: "این هفته",
    getRange: () => ({
      from: moment().subtract(6, "days").format("YYYY-MM-DD"),
      to: moment().format("YYYY-MM-DD"),
    }),
  },
  {
    id: "month",
    label: "این ماه",
    getRange: () => ({
      from: moment().startOf("month").format("YYYY-MM-DD"),
      to: moment().format("YYYY-MM-DD"),
    }),
  },
  {
    id: "3m",
    label: "۳ ماه",
    getRange: () => ({
      from: moment().subtract(3, "months").format("YYYY-MM-DD"),
      to: moment().format("YYYY-MM-DD"),
    }),
  },
  {
    id: "6m",
    label: "۶ ماه",
    getRange: () => ({
      from: moment().subtract(6, "months").format("YYYY-MM-DD"),
      to: moment().format("YYYY-MM-DD"),
    }),
  },
  {
    id: "year",
    label: "امسال",
    getRange: () => ({
      from: moment().startOf("year").format("YYYY-MM-DD"),
      to: moment().format("YYYY-MM-DD"),
    }),
  },
];

type ProfitGroupBy = "none" | "product" | "month";

export default function Report({ onBack }: ReportProps) {
  const [reportType, setReportType] = useState<ReportType>("sales");
  const [fromDate, setFromDate] = useState<string>(moment().subtract(30, "days").format("YYYY-MM-DD"));
  const [toDate, setToDate] = useState<string>(moment().format("YYYY-MM-DD"));
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [includeExpenses, setIncludeExpenses] = useState(true);
  const [profitGroupBy, setProfitGroupBy] = useState<ProfitGroupBy>("none");
  
  // Customer/Supplier search
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [loadingEntities, setLoadingEntities] = useState(false);
  
  // Company settings
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);

  const reportRef = useRef<HTMLDivElement>(null);

  // Load company settings on mount
  useEffect(() => {
    const loadCompanySettings = async () => {
      try {
        const settings = await getCompanySettings();
        setCompanySettings(settings);
      } catch (error) {
        console.error("Error loading company settings:", error);
      }
    };
    loadCompanySettings();
  }, []);

  // Load customers/suppliers when report type changes
  useEffect(() => {
    const loadEntities = async () => {
      if (reportType === "customers" || reportType === "receivables") {
        setLoadingEntities(true);
        try {
          const customersData = await getCustomers(1, 10000);
          setCustomers(customersData.items);
        } catch (error) {
          console.error("Error loading customers:", error);
        } finally {
          setLoadingEntities(false);
        }
      } else if (reportType === "suppliers" || reportType === "payables") {
        setLoadingEntities(true);
        try {
          const suppliersData = await getSuppliers(1, 10000);
          setSuppliers(suppliersData.items);
        } catch (error) {
          console.error("Error loading suppliers:", error);
        } finally {
          setLoadingEntities(false);
        }
      }
    };
    loadEntities();
    // Reset selections when report type changes
    setSelectedCustomerId("");
    setSelectedSupplierId("");
  }, [reportType]);

  const handleGenerate = async () => {
    if (!fromDate || !toDate) {
      toast.error("لطفاً تاریخ شروع و پایان را انتخاب کنید");
      return;
    }

    // Dates are already in Georgian format (YYYY-MM-DD) from PersianDatePicker
    const from = fromDate;
    const to = toDate;

    if (from > to) {
      toast.error("تاریخ شروع باید قبل از تاریخ پایان باشد");
      return;
    }

    setLoading(true);
    setReportData(null);

    try {
      let data: ReportData;
      switch (reportType) {
        case "sales":
          data = await generateSalesReport(from, to);
          break;
        case "services":
          data = await generateServicesReport(from, to);
          break;
        case "purchases":
          data = await generatePurchaseReport(from, to);
          break;
        case "expenses":
          data = await generateExpenseReport(from, to);
          break;
        case "accounts":
          data = await generateAccountReport(from, to);
          break;
        case "products":
          data = await generateProductReport(from, to);
          break;
        case "customers":
          data = await generateCustomerReport(from, to, selectedCustomerId ? parseInt(selectedCustomerId) : null);
          break;
        case "suppliers":
          data = await generateSupplierReport(from, to, selectedSupplierId ? parseInt(selectedSupplierId) : null);
          break;
        case "receivables":
          data = await generateReceivablesReport(from, to, selectedCustomerId ? parseInt(selectedCustomerId) : null);
          break;
        case "payables":
          data = await generatePayablesReport(from, to, selectedSupplierId ? parseInt(selectedSupplierId) : null);
          break;
        case "profit":
          data = await generateProfitReport(from, to, {
            includeExpenses,
            groupBy: profitGroupBy,
          });
          break;
        default:
          throw new Error("نوع گزارش نامعتبر است");
      }
      setReportData(data);
      toast.success("گزارش با موفقیت تولید شد");
    } catch (error: any) {
      console.error("Error generating report:", error);
      toast.error(`خطا در تولید گزارش: ${error.message || "خطای نامشخص"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyPreset = (presetId: string) => {
    const preset = DATE_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      const { from, to } = preset.getRange();
      setFromDate(from);
      setToDate(to);
    }
  };

  const handlePrint = () => {
    if (!reportData) {
      toast.error("ابتدا گزارش را تولید کنید");
      return;
    }
    window.print();
  };

  const handleExportExcel = async () => {
    if (!reportData) {
      toast.error("ابتدا گزارش را تولید کنید");
      return;
    }

    setIsExportingExcel(true);
    try {
      await exportReportToExcel(reportData);
      toast.success("فایل Excel دانلود شد");
    } catch (error: any) {
      console.error("Error exporting Excel:", error);
      toast.error(`خطا در ذخیره Excel: ${error.message || "خطای نامشخص"}`);
    } finally {
      setIsExportingExcel(false);
    }
  };

  return (
    <div
      className="report-page-wrapper min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950"
      dir="rtl"
    >
      <style>{`
        @media print {
          .report-page-wrapper { background: white !important; }
          .report-page-wrapper .no-print { display: none !important; }
          .report-page-wrapper [data-pdf-root] {
            box-shadow: none !important;
            border: 1px solid #e5e7eb !important;
            background: white !important;
            width: 100% !important;
            max-width: 100% !important;
          }
          .company-header-print {
            display: flex !important;
            flex-wrap: wrap !important;
            align-items: flex-start !important;
            justify-content: space-between !important;
            gap: 1.5rem !important;
            margin-bottom: 2rem !important;
            padding-bottom: 1rem !important;
            border-bottom: 2px solid #e5e7eb !important;
          }
          .company-logo-print {
            width: 80px !important;
            height: 80px !important;
            object-fit: contain !important;
          }
          .company-info-print h2 {
            font-size: 1.5rem !important;
            font-weight: bold !important;
            margin: 0 0 0.5rem 0 !important;
            color: #111827 !important;
          }
          .company-info-print p {
            margin: 0.25rem 0 !important;
            color: #4b5563 !important;
            font-size: 0.875rem !important;
          }
          .company-report-title h2 {
            font-size: 1.5rem !important;
            font-weight: bold !important;
            margin: 0 !important;
            color: #111827 !important;
          }
          .company-report-title p {
            margin: 0.25rem 0 0 0 !important;
            color: #4b5563 !important;
            font-size: 0.875rem !important;
          }
        }
      `}</style>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <motion.button
          onClick={onBack}
          className="no-print flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 mb-6"
          whileHover={{ x: 4 }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          بازگشت
        </motion.button>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="no-print bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl rounded-3xl border border-purple-200/50 dark:border-purple-800/30 shadow-xl p-6 mb-8"
        >
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-6">
            سیستم گزارش‌گیری
          </h1>

          <div className="space-y-6">
            {/* Report Type Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                نوع گزارش
              </label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {REPORT_TYPES.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => setReportType(type.value)}
                    className={`px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                      reportType === type.value
                        ? "bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date Range Selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  از تاریخ
                </label>
                <PersianDatePicker
                  value={fromDate}
                  onChange={(date) => setFromDate(date)}
                  placeholder="انتخاب تاریخ شروع"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  تا تاریخ
                </label>
                <PersianDatePicker
                  value={toDate}
                  onChange={(date) => setToDate(date)}
                  placeholder="انتخاب تاریخ پایان"
                />
              </div>
            </div>

            {/* Customer/Supplier Search - Show only for customer/supplier reports */}
            {(reportType === "customers" || reportType === "receivables") && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  جستجوی مشتری (اختیاری)
                </label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                  dir="rtl"
                  disabled={loadingEntities}
                >
                  <option value="">همه مشتریان</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.full_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(reportType === "suppliers" || reportType === "payables") && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  جستجوی تمویل‌کننده (اختیاری)
                </label>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                  dir="rtl"
                  disabled={loadingEntities}
                >
                  <option value="">همه تمویل‌کنندگان</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.full_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Date Presets */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                بازه‌های زمانی پیش‌فرض
              </label>
              <div className="flex flex-wrap gap-2">
                {DATE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handleApplyPreset(preset.id)}
                    className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Profit report: advanced options */}
            {reportType === "profit" && (
              <div className="space-y-4 p-4 rounded-xl bg-purple-50/50 dark:bg-purple-900/20 border border-purple-200/50 dark:border-purple-700/30">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  گزینه‌های پیشرفته
                </label>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeExpenses}
                      onChange={(e) => setIncludeExpenses(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">شامل مصارف</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700 dark:text-gray-300">نمایش تفکیکی:</span>
                    <select
                      value={profitGroupBy}
                      onChange={(e) => setProfitGroupBy(e.target.value as ProfitGroupBy)}
                      className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-purple-500"
                    >
                      <option value="none">بدون تفکیک</option>
                      <option value="product">بر اساس محصول</option>
                      <option value="month">بر اساس ماه</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Generate Button */}
            <motion.button
              onClick={handleGenerate}
              disabled={loading || !fromDate || !toDate}
              className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {loading ? "در حال تولید گزارش..." : "تولید گزارش"}
            </motion.button>
          </div>
        </motion.div>

        {/* Loading State */}
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="no-print flex flex-col items-center justify-center py-16"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full"
            />
            <p className="mt-4 text-gray-600 dark:text-gray-400">لطفاً صبر کنید...</p>
          </motion.div>
        )}

        {/* Report Display */}
        {reportData && !loading && (
          <>
            <div className="no-print flex flex-wrap gap-2 mb-4">
              <motion.button
                onClick={handlePrint}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                چاپ
              </motion.button>
              <motion.button
                onClick={handleExportExcel}
                disabled={isExportingExcel}
                className="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {isExportingExcel ? "در حال آماده‌سازی…" : "خروجی Excel"}
              </motion.button>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              ref={reportRef}
              className="space-y-8 bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl rounded-3xl border border-purple-200/50 dark:border-purple-800/30 shadow-xl p-6"
              data-pdf-root
            >
              {/* Merged Report Header: Company + Report title & date range */}
              <div className="flex flex-wrap items-start justify-between gap-6 mb-6 pb-4 border-b-2 border-gray-200 dark:border-gray-700 company-header-print">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  {companySettings?.logo && (
                    <img
                      src={companySettings.logo}
                      alt="Company Logo"
                      className="w-20 h-20 object-contain shrink-0 company-logo-print"
                    />
                  )}
                  <div className="company-info-print min-w-0">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
                      {companySettings?.name || "شرکت"}
                    </h2>
                    {companySettings?.phone && (
                      <p className="text-gray-600 dark:text-gray-400 text-sm mb-0.5">
                        تلفن: {companySettings.phone}
                      </p>
                    )}
                    {companySettings?.address && (
                      <p className="text-gray-600 dark:text-gray-400 text-sm">
                        آدرس: {companySettings.address}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-end company-report-title shrink-0">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{reportData.title}</h2>
                  <p className="mt-1 text-gray-600 dark:text-gray-400 text-sm">
                    از تاریخ: {georgianToPersian(reportData.dateRange.from)} تا تاریخ:{" "}
                    {georgianToPersian(reportData.dateRange.to)}
                  </p>
                </div>
              </div>

              {reportData.sections.map((section, index) => (
                <section key={index} className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                    {section.title}
                  </h3>

                  {section.type === "summary" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {section.data.map((item: any, idx: number) => (
                        <div
                          key={idx}
                          className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-xl p-4 border border-purple-200 dark:border-purple-800"
                        >
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{item.label}</p>
                          <p className="text-xl font-bold text-gray-900 dark:text-white">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {section.type === "table" && section.columns && (
                    <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 shadow-lg">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                            {section.columns.map((col) => (
                              <th
                                key={col.key}
                                className="px-4 py-3 text-right text-sm font-semibold text-gray-700 dark:text-gray-300"
                              >
                                {col.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                          {section.data.length === 0 ? (
                            <tr>
                              <td
                                colSpan={section.columns.length}
                                className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
                              >
                                داده‌ای یافت نشد
                              </td>
                            </tr>
                          ) : (
                            section.data.map((row: any, rowIdx: number) => (
                              <tr
                                key={rowIdx}
                                className="hover:bg-purple-50/50 dark:hover:bg-gray-700/30"
                              >
                                {section.columns!.map((col) => (
                                  <td
                                    key={col.key}
                                    className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300"
                                  >
                                    {row[col.key] ?? "-"}
                                  </td>
                                ))}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ))}
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}

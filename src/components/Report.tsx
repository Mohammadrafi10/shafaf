import { useState, useRef } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import moment from "moment-jalaali";
import PersianDatePicker from "./PersianDatePicker";
import {
  generateSalesReport,
  generatePurchaseReport,
  generateExpenseReport,
  generateAccountReport,
  generateProductReport,
  generateCustomerReport,
  generateSupplierReport,
  generateProfitReport,
  type ReportData,
} from "../utils/report";
import { exportReportToExcel } from "../utils/reportExport";
import { georgianToPersian } from "../utils/date";

interface ReportProps {
  onBack: () => void;
}

type ReportType =
  | "sales"
  | "purchases"
  | "expenses"
  | "accounts"
  | "products"
  | "customers"
  | "suppliers"
  | "profit";

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: "sales", label: "گزارش فروشات" },
  { value: "purchases", label: "گزارش خریداری‌ها" },
  { value: "expenses", label: "گزارش مصارف" },
  { value: "accounts", label: "گزارش حساب‌ها" },
  { value: "products", label: "گزارش محصولات" },
  { value: "customers", label: "گزارش مشتریان" },
  { value: "suppliers", label: "گزارش تمویل‌کنندگان" },
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

  const reportRef = useRef<HTMLDivElement>(null);

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
          data = await generateCustomerReport(from, to);
          break;
        case "suppliers":
          data = await generateSupplierReport(from, to);
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
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{reportData.title}</h2>
                <p className="mt-2 text-gray-600 dark:text-gray-400">
                  از تاریخ: {georgianToPersian(reportData.dateRange.from)} تا تاریخ:{" "}
                  {georgianToPersian(reportData.dateRange.to)}
                </p>
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

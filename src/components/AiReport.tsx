import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";
import moment from "moment-jalaali";
import { generateReport, type ReportJson, type ReportSection } from "../utils/puterReport";
import { formatPersianNumber } from "../utils/dashboard";
import { sanitizeFilename, sanitizeSheetName, formatCellForExcel } from "../utils/exportHelpers";
import { loadPuter, isPuterAvailable, LS_PUTER_APP_ID, LS_PUTER_TOKEN, LS_PUTER_MODEL } from "../utils/puter";
import { getCompanySettings, type CompanySettings } from "../utils/company";

interface AiReportProps {
  onBack: () => void;
}

const LS_HISTORY = "shafaf_ai_report_history";
const HISTORY_MAX = 5;

const QUICK_PROMPTS: { label: string; prompt: string }[] = [
  { label: "درآمد ماهانه ۶ ماه گذشته", prompt: "درآمد ماهانه ۶ ماه گذشته به تفکیک ماه" },
  { label: "فروش به تفکیک محصول", prompt: "تعداد و مبلغ فروش به تفکیک محصول" },
  { label: "مقایسه خرید و فروش هر ماه", prompt: "مقایسه مجموع خرید و فروش هر ماه" },
  { label: "ده محصول پرفروش", prompt: "ده محصول پرفروش بر اساس تعداد یا مبلغ" },
  { label: "هزینه‌های هر ماه", prompt: "مجموع هزینه‌ها (expenses) به تفکیک ماه" },
  { label: "وضعیت موجودی انبار", prompt: "وضعیت موجودی انبار (محصولات و تعداد)" },
];

const DATE_PRESETS: { id: string; label: string; getRange: () => { from: string; to: string } }[] = [
  { id: "today", label: "امروز", getRange: () => { const d = moment().format("YYYY-MM-DD"); return { from: d, to: d }; } },
  { id: "week", label: "این هفته", getRange: () => ({ from: moment().subtract(6, "days").format("YYYY-MM-DD"), to: moment().format("YYYY-MM-DD") }) },
  { id: "month", label: "این ماه", getRange: () => ({ from: moment().startOf("month").format("YYYY-MM-DD"), to: moment().format("YYYY-MM-DD") }) },
  { id: "3m", label: "۳ ماه", getRange: () => ({ from: moment().subtract(3, "months").format("YYYY-MM-DD"), to: moment().format("YYYY-MM-DD") }) },
  { id: "6m", label: "۶ ماه", getRange: () => ({ from: moment().subtract(6, "months").format("YYYY-MM-DD"), to: moment().format("YYYY-MM-DD") }) },
  { id: "year", label: "امسال", getRange: () => ({ from: moment().startOf("year").format("YYYY-MM-DD"), to: moment().format("YYYY-MM-DD") }) },
];

interface HistoryItem {
  id: number;
  prompt: string;
  title: string;
  timestamp: number;
  report: ReportJson;
}

function formatCellValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return formatPersianNumber(v);
  return String(v);
}

function applyDatePreset(prompt: string, presetId: string): string {
  const p = DATE_PRESETS.find((x) => x.id === presetId);
  if (!p) return prompt;
  const { from, to } = p.getRange();
  return `${prompt} [بازهٔ زمانی: از ${from} تا ${to}]`;
}

function TableSection({ section }: { section: ReportSection }) {
  const t = section.table;
  if (!t?.columns?.length || !t?.rows) return null;
  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 shadow-lg">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
            {t.columns.map((c) => (
              <th key={c.key} className="px-4 py-3 text-right text-sm font-semibold text-gray-700 dark:text-gray-300">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {t.rows.map((row, i) => (
            <tr key={i} className="hover:bg-purple-50/50 dark:hover:bg-gray-700/30">
              {t.columns.map((col) => (
                <td key={col.key} className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                  {formatCellValue(row[col.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartSection({ section, index }: { section: ReportSection; index: number }) {
  const c = section.chart;
  if (!c?.type || !c?.series?.length) return null;

  // Chart validation: align series/labels/categories lengths
  let categories = c.categories ?? [];
  let labels = c.labels ?? [];
  let series = c.series.map((s) => ({ ...s, data: [...(s.data || [])] }));

  if (c.type === "pie" || c.type === "donut") {
    const vals = series[0]?.data ?? [];
    const n = Math.min(vals.length, labels.length || vals.length);
    if (n === 0) return null;
    series = [{ ...series[0], data: vals.slice(0, n) }];
    labels = (labels.length ? labels : categories).slice(0, n);
  } else {
    const cats = categories.length ? categories : labels;
    const n = Math.min(...[cats.length, ...series.map((s) => s.data.length)].filter(Boolean)) || 0;
    if (n === 0) return null;
    categories = cats.slice(0, n);
    series = series.map((s) => ({ ...s, data: s.data.slice(0, n) }));
  }

  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  const baseOptions: ApexOptions = {
    chart: { id: `report-chart-${index}`, type: c.type as "line" | "bar" | "area" | "pie" | "donut", toolbar: { show: true } },
    theme: { mode: isDark ? "dark" : "light" },
    labels: c.type === "pie" || c.type === "donut" ? labels : undefined,
  };

  let options: ApexOptions = { ...baseOptions };
  let chartSeries: ApexOptions["series"];

  if (c.type === "pie" || c.type === "donut") {
    chartSeries = series[0]?.data ?? [];
    if (c.type === "donut") {
      options.plotOptions = { pie: { donut: { size: "60%" } } };
    }
  } else {
    chartSeries = series.map((s) => ({ name: s.name, data: s.data }));
    options.xaxis = { categories };
  }

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 p-4 shadow-lg">
      <ReactApexChart
        type={c.type as "line" | "bar" | "area" | "pie" | "donut"}
        options={options}
        series={chartSeries}
        height={320}
      />
    </div>
  );
}

export default function AiReport({ onBack }: AiReportProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportJson | null>(null);
  const [lastMessages, setLastMessages] = useState<{ role: string; content: string }[] | null>(null);
  const [refinementText, setRefinementText] = useState("");
  const [puterLoaded, setPuterLoaded] = useState(false);
  const [appId, setAppId] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [model, setModel] = useState("");
  const [datePreset, setDatePreset] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);

  const reportRef = useRef<HTMLDivElement>(null);

  const puter = typeof window !== "undefined" ? (window as Window & { puter?: { ai?: { chat: unknown } } }).puter : undefined;
  const puterOk = puterLoaded && !!puter?.ai?.chat;

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const savedId = localStorage.getItem(LS_PUTER_APP_ID);
      const savedToken = localStorage.getItem(LS_PUTER_TOKEN);
      const savedModel = localStorage.getItem(LS_PUTER_MODEL);
      const savedHistory = localStorage.getItem(LS_HISTORY);
      if (savedId) setAppId(savedId);
      if (savedToken) setAuthToken(savedToken);
      if (savedModel) setModel(savedModel);
      if (savedHistory) {
        const arr = JSON.parse(savedHistory) as HistoryItem[];
        setHistory(Array.isArray(arr) ? arr.slice(0, HISTORY_MAX) : []);
      }
    } catch (_) {}
  }, []);

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

  const handleApply = async () => {
    const id = appId.trim();
    const token = authToken.trim();
    if (!id || !token) {
      setError("هر دو فیلد «شناسه اپ Puter» و «توکن احراز هویت Puter» را وارد کنید.");
      return;
    }
    setError(null);
    setApplying(true);
    setPuterLoaded(false);
    const ok = await loadPuter(id, token);
    setApplying(false);
    if (ok) {
      setPuterLoaded(true);
    } else {
      setError("بارگذاری Puter ناموفق بود یا ai.chat در دسترس نیست. اتصال شبکه و مقدارهای وارد شده را بررسی کنید.");
    }
  };

  useEffect(() => {
    if (puterLoaded) return;
    if (isPuterAvailable()) setPuterLoaded(true);
  }, [puterLoaded]);

  const persistHistory = useCallback((next: HistoryItem[]) => {
    setHistory(next);
    try {
      localStorage.setItem(LS_HISTORY, JSON.stringify(next));
    } catch (_) {}
  }, []);

  const runReport = useCallback(
    async (effectivePrompt: string, opts: { isRefinement?: boolean; skipDatePreset?: boolean } = {}) => {
      setLoading(true);
      setError(null);
      setReport(null);
      try {
        const res = opts.isRefinement
          ? await generateReport("", {
              previousMessages: lastMessages ?? undefined,
              refinementText: effectivePrompt,
              model: model || undefined,
            })
          : await generateReport(effectivePrompt, { model: model || undefined });

        setReport(res.report);
        setLastMessages(res.messages);

        const toAdd: HistoryItem = {
          id: Date.now(),
          prompt: effectivePrompt,
          title: res.report.title,
          timestamp: Date.now(),
          report: res.report,
        };
        persistHistory([toAdd, ...history].slice(0, HISTORY_MAX));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [lastMessages, model, history, persistHistory]
  );

  const handleSubmit = (overridePrompt?: string, skipDatePreset?: boolean) => {
    const q = (overridePrompt !== undefined ? overridePrompt : prompt).trim();
    if (!q) return;
    const effective = !skipDatePreset && datePreset ? applyDatePreset(q, datePreset) : q;
    runReport(effective);
  };

  const handleRefine = () => {
    const t = refinementText.trim();
    if (!t || !lastMessages?.length) return;
    setRefinementText("");
    runReport(t, { isRefinement: true });
  };

  const handlePrint = () => {
    if (!report) {
      toast.error("ابتدا گزارش را تولید کنید");
      return;
    }
    window.print();
  };

  const handleExportExcel = () => {
    if (!report) return;
    const tableSections = report.sections.filter(
      (s) => s.type === "table" && s.table?.columns?.length && s.table?.rows
    );
    const chartSections = report.sections.filter((s) => s.type === "chart" && s.chart?.series?.length);
    if (tableSections.length === 0 && chartSections.length === 0) {
      toast.error("این گزارش جدول یا نموداری برای خروجی ندارد.");
      return;
    }
    setIsExportingExcel(true);
    try {
      const wb = XLSX.utils.book_new();

      tableSections.forEach((section, i) => {
        const cols = section.table!.columns;
        const rows = section.table!.rows;
        const headerRow = cols.map((c) => c.label);
        const dataRows = rows.map((row) => cols.map((c) => formatCellForExcel(row[c.key])));
        const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
        const base = sanitizeSheetName(section.title);
        XLSX.utils.book_append_sheet(wb, ws, base || `جدول ${i + 1}`);
      });

      chartSections.forEach((section, i) => {
        const c = section.chart!;
        const labels = (c.labels && c.labels.length ? c.labels : c.categories) || [];
        const vals = c.series[0]?.data ?? [];
        const n = Math.min(labels.length, vals.length) || Math.max(labels.length, vals.length);
        const header = ["دسته", ...c.series.map((s) => s.name)];
        const rows: unknown[][] = [header];
        for (let j = 0; j < n; j++) {
          const row: unknown[] = [labels[j] ?? ""];
          c.series.forEach((s) => row.push(s.data[j] ?? ""));
          rows.push(row);
        }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(section.title) || `نمودار ${i + 1}`);
      });

      const dateStr = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `گزارش-${sanitizeFilename(report.title)}-${dateStr}.xlsx`);
      toast.success("فایل Excel دانلود شد");
    } catch (e) {
      toast.error("خطا در ذخیره Excel.");
    } finally {
      setIsExportingExcel(false);
    }
  };

  return (
    <div className="ai-report-page-wrapper min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950" dir="rtl">
      <style>{`
        @media print {
          .ai-report-page-wrapper { background: white !important; }
          .ai-report-page-wrapper .no-print { display: none !important; }
          .ai-report-page-wrapper [data-pdf-root] {
            box-shadow: none !important;
            border: none !important;
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
      <div className="max-w-4xl mx-auto px-6 py-8">
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
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-4">
            گزارش هوشمند (AI)
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            درخواست گزارش خود را به زبان طبیعی بنویسید یا یکی از پیشنهادها را انتخاب کنید.
          </p>

          {!puterOk && (
            <div className="mb-4 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
              <p className="mb-3 text-sm font-medium">برای استفاده از گزارش هوشمند، شناسه اپ و توکن احراز هویت Puter را وارد کنید.</p>
              <div className="grid gap-3">
                <label className="block">
                  <span className="text-xs text-blue-700 dark:text-blue-300">شناسه اپ Puter (puter.app.id / appId)</span>
                  <input
                    type="text"
                    value={appId}
                    onChange={(e) => { setAppId(e.target.value); setError(null); }}
                    placeholder="مثال: my-app-id"
                    className="mt-1 w-full px-4 py-2 rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-500"
                    disabled={applying}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-blue-700 dark:text-blue-300">توکن احراز هویت Puter (puter.auth.token / authToken)</span>
                  <input
                    type="password"
                    value={authToken}
                    onChange={(e) => { setAuthToken(e.target.value); setError(null); }}
                    placeholder="توکن خود را وارد کنید"
                    className="mt-1 w-full px-4 py-2 rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-500"
                    disabled={applying}
                  />
                </label>
                <motion.button
                  onClick={handleApply}
                  disabled={applying || !appId.trim() || !authToken.trim()}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-xl"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {applying ? "در حال اعمال…" : "اعمال"}
                </motion.button>
              </div>
            </div>
          )}

          {puterOk && (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                {QUICK_PROMPTS.map((p) => (
                  <motion.button
                    key={p.label}
                    onClick={() => handleSubmit(p.prompt)}
                    disabled={loading}
                    className="px-3 py-1.5 text-sm rounded-xl bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-200 hover:bg-purple-200 dark:hover:bg-purple-800/50 disabled:opacity-50"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {p.label}
                  </motion.button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 mb-3">
                <span className="text-sm text-gray-500 dark:text-gray-400 self-center">بازهٔ زمانی:</span>
                {DATE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setDatePreset(datePreset === p.id ? null : p.id)}
                    className={`px-3 py-1 rounded-lg text-sm ${datePreset === p.id ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="mb-3">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">مدل (اختیاری)</label>
                <select
                  value={model}
                  onChange={(e) => {
                    const v = e.target.value;
                    setModel(v);
                    try { localStorage.setItem(LS_PUTER_MODEL, v); } catch (_) {}
                  }}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm"
                >
                  <option value="">پیش‌فرض</option>
                </select>
              </div>

              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="مثال: درآمد ماهانه ۶ ماه گذشته به تفکیک ماه"
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                disabled={loading}
              />
              <motion.button
                onClick={() => handleSubmit()}
                disabled={loading || !prompt.trim()}
                className="mt-4 px-6 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {loading ? "در حال تولید..." : "تولید گزارش"}
              </motion.button>
            </>
          )}
        </motion.div>

        {history.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="no-print mb-6 p-4 rounded-2xl bg-white/60 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700"
          >
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">تاریخچه</h3>
            <ul className="space-y-1.5">
              {history.slice(0, 5).map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-gray-600 dark:text-gray-400 truncate flex-1" title={h.prompt}>{h.title}</span>
                  <span className="text-gray-400 dark:text-gray-500 shrink-0">{new Date(h.timestamp).toLocaleDateString("fa-IR")}</span>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => handleSubmit(h.prompt, true)}
                      disabled={loading}
                      className="px-2 py-1 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800/40 text-xs"
                    >
                      دوباره
                    </button>
                    <button
                      onClick={() => setPrompt(h.prompt)}
                      className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 text-xs"
                    >
                      ویرایش
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </motion.div>
        )}

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
            <p className="mt-4 text-gray-600 dark:text-gray-400 mt-2">لطفاً صبر کنید...</p>
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="no-print p-4 rounded-2xl bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800"
          >
            {error}
          </motion.div>
        )}

        {report && !loading && (
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
                {isExportingExcel ? "در حال آماده‌سازی…" : "Excel (جداول و نمودارها)"}
              </motion.button>
            </div>

            {lastMessages?.length && (
              <div className="no-print mb-4 p-3 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
                <label className="block text-sm font-medium text-purple-800 dark:text-purple-200 mb-2">اصلاح گزارش</label>
                <div className="flex gap-2">
                  <input
                    value={refinementText}
                    onChange={(e) => setRefinementText(e.target.value)}
                    placeholder="مثال: فقط ۳ ماه اخیر، یا فقط فروش را نشان بده"
                    className="flex-1 px-4 py-2 rounded-xl border border-purple-200 dark:border-purple-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-500 text-sm"
                  />
                  <motion.button
                    onClick={handleRefine}
                    disabled={loading || !refinementText.trim()}
                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium text-sm"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    اعمال
                  </motion.button>
                </div>
              </div>
            )}

            <motion.article
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div ref={reportRef} className="space-y-8" data-pdf-root>
                {/* Merged Report Header: Company + Report title & summary */}
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
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{report.title}</h2>
                    {report.summary && (
                      <p className="mt-1 text-gray-600 dark:text-gray-400 text-sm">
                        {report.summary}
                      </p>
                    )}
                  </div>
                </div>
                {report.sections.map((sec, i) => (
                  <section key={i}>
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3">{sec.title}</h3>
                    {sec.type === "table" && <TableSection section={sec} />}
                    {sec.type === "chart" && <ChartSection section={sec} index={i} />}
                  </section>
                ))}
              </div>
            </motion.article>
          </>
        )}
      </div>
    </div>
  );
}

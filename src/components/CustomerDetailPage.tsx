import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { getCustomers, type Customer } from "../utils/customer";
import {
  getSales,
  getSalePayments,
  getSale,
  getSaleAdditionalCosts,
  type Sale,
  type SalePayment,
  type SaleWithItems,
  type SaleAdditionalCost,
} from "../utils/sales";
import { getProducts, type Product } from "../utils/product";
import { getUnits, type Unit } from "../utils/unit";
import { formatPersianDate } from "../utils/date";
import { exportReportToPDF, exportReportToExcel } from "../utils/reportExport";
import type { ReportData } from "../utils/report";

const translations = {
  title: "بیلانس مشتری",
  back: "بازگشت",
  totalSales: "مجموع فروش‌ها",
  totalPaid: "مجموع پرداخت شده",
  totalRemaining: "مجموع باقیمانده",
  sale: "فروش",
  sales: "فروش‌ها",
  payments: "پرداخت‌ها",
  items: "آیتم‌های فروش",
  product: "محصول",
  unit: "واحد",
  quantity: "مقدار",
  unitPrice: "قیمت واحد",
  rowTotal: "جمع",
  serviceItems: "خدمات",
  additionalCosts: "هزینه‌های اضافی",
  phone: "شماره تماس",
  address: "آدرس",
  saleId: "شماره فروش",
  date: "تاریخ",
  total: "مبلغ کل",
  paid: "پرداخت شده",
  remaining: "باقیمانده",
  amount: "مبلغ",
  print: "چاپ",
  exportPdf: "خروجی PDF",
  exportExcel: "خروجی Excel",
  noSales: "هیچ فروشی ثبت نشده است",
  notFound: "مشتری یافت نشد",
  loading: "در حال بارگذاری...",
};

interface CustomerDetailPageProps {
  customerId: number;
  onBack: () => void;
}

export default function CustomerDetailPage({ customerId, onBack }: CustomerDetailPageProps) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [salePaymentsMap, setSalePaymentsMap] = useState<Record<number, SalePayment[]>>({});
  const [saleDetailsMap, setSaleDetailsMap] = useState<Record<number, SaleWithItems>>({});
  const [saleAdditionalCostsMap, setSaleAdditionalCostsMap] = useState<Record<number, SaleAdditionalCost[]>>({});
  const [products, setProducts] = useState<Product[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [expandedSaleIds, setExpandedSaleIds] = useState<Set<number>>(new Set());
  const printRef = useRef<HTMLDivElement>(null);

  const getProductName = (id: number) => products.find((p) => p.id === id)?.name ?? "-";
  const getUnitName = (id: number) => units.find((u) => u.id === id)?.name ?? "-";

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setNotFound(false);
      const [customersRes, salesRes, productsRes, unitsData] = await Promise.all([
        getCustomers(1, 10000, "", "id", "asc"),
        getSales(1, 10000, "", "date", "desc"),
        getProducts(1, 10000, "", "id", "asc"),
        getUnits(),
      ]);
      setProducts(productsRes.items);
      setUnits(unitsData);
      const c = customersRes.items.find((x) => x.id === customerId) ?? null;
      setCustomer(c);
      if (!c) {
        setNotFound(true);
        setSales([]);
        setSalePaymentsMap({});
        setSaleDetailsMap({});
        setSaleAdditionalCostsMap({});
        return;
      }
      const customerSalesList = salesRes.items.filter((s) => s.customer_id === customerId);
      setSales(customerSalesList);

      const paymentsMap: Record<number, SalePayment[]> = {};
      const detailsMap: Record<number, SaleWithItems> = {};
      const additionalCostsMap: Record<number, SaleAdditionalCost[]> = {};
      await Promise.all(
        customerSalesList.map(async (sale) => {
          try {
            const [payments, saleDetail, additionalCosts] = await Promise.all([
              getSalePayments(sale.id),
              getSale(sale.id),
              getSaleAdditionalCosts(sale.id),
            ]);
            paymentsMap[sale.id] = payments;
            detailsMap[sale.id] = saleDetail;
            additionalCostsMap[sale.id] = additionalCosts;
          } catch {
            paymentsMap[sale.id] = [];
            additionalCostsMap[sale.id] = [];
          }
        })
      );
      setSalePaymentsMap(paymentsMap);
      setSaleDetailsMap(detailsMap);
      setSaleAdditionalCostsMap(additionalCostsMap);
    } catch (err) {
      console.error(err);
      toast.error("خطا در بارگذاری اطلاعات");
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const calculatePaidAmount = (saleId: number): number => {
    const payments = salePaymentsMap[saleId] || [];
    return payments.reduce((sum, p) => sum + p.amount, 0);
  };

  const totalSales = sales.reduce((sum, s) => sum + s.total_amount, 0);
  const totalPaid = sales.reduce((sum, s) => sum + calculatePaidAmount(s.id), 0);
  const totalRemaining = totalSales - totalPaid;

  const toggleSaleExpanded = (saleId: number) => {
    setExpandedSaleIds((prev) => {
      const next = new Set(prev);
      if (next.has(saleId)) next.delete(saleId);
      else next.add(saleId);
      return next;
    });
  };

  const buildReportData = (): ReportData => {
    const from = sales.length ? sales[sales.length - 1].date : new Date().toISOString().slice(0, 10);
    const to = sales.length ? sales[0].date : new Date().toISOString().slice(0, 10);
    return {
      title: `${translations.title}: ${customer?.full_name ?? ""}`,
      type: "customerDetail",
      dateRange: { from, to },
      summary: {
        totalSales,
        totalPaid,
        totalRemaining,
      },
      sections: [
        {
          title: translations.sales,
          type: "table",
          columns: [
            { key: "sale_id", label: translations.saleId },
            { key: "date", label: translations.date },
            { key: "total", label: translations.total },
            { key: "paid", label: translations.paid },
            { key: "remaining", label: translations.remaining },
          ],
          data: sales.map((s) => {
            const paid = calculatePaidAmount(s.id);
            const remaining = s.total_amount - paid;
            return {
              sale_id: s.id,
              date: formatPersianDate(s.date),
              total: s.total_amount.toLocaleString("en-US"),
              paid: paid.toLocaleString("en-US"),
              remaining: remaining.toLocaleString("en-US"),
            };
          }),
        },
      ],
    };
  };

  const handlePrint = () => {
    if (!printRef.current) return;
    window.print();
  };

  const handleExportPdf = async () => {
    if (!customer || !printRef.current) return;
    try {
      const reportData = buildReportData();
      const el = printRef.current;
      el.classList.remove("print-only");
      await exportReportToPDF(reportData, el);
      el.classList.add("print-only");
      toast.success("PDF ذخیره شد");
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "خطا در ساخت PDF");
    }
  };

  const handleExportExcel = async () => {
    if (!customer) return;
    try {
      const reportData = buildReportData();
      await exportReportToExcel(reportData);
      toast.success("فایل Excel دانلود شد");
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message ?? "خطا در ساخت Excel");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex items-center justify-center" dir="rtl">
        <div className="flex flex-col items-center gap-4">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full"
          />
          <p className="text-gray-600 dark:text-gray-400">{translations.loading}</p>
        </div>
      </div>
    );
  }

  if (notFound || !customer) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 flex items-center justify-center p-6" dir="rtl">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 max-w-md text-center">
          <p className="text-gray-700 dark:text-gray-300 mb-6">{translations.notFound}</p>
          <motion.button
            onClick={onBack}
            className="px-6 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl font-medium"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {translations.back}
          </motion.button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950" dir="rtl">
      <style>{`
        .detail-print-area.print-only { display: none !important; }
        @media print {
          body * { visibility: hidden; }
          .detail-print-area, .detail-print-area * { visibility: visible; }
          .detail-print-area { position: absolute; left: 0; top: 0; width: 100%; display: block !important; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="no-print flex flex-wrap items-center justify-between gap-4 mb-6">
          <motion.button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400"
            whileHover={{ x: 4 }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {translations.back}
          </motion.button>
          <div className="flex flex-wrap gap-2">
            <motion.button
              onClick={handlePrint}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {translations.print}
            </motion.button>
            <motion.button
              onClick={handleExportPdf}
              className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-medium"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {translations.exportPdf}
            </motion.button>
            <motion.button
              onClick={handleExportExcel}
              className="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white font-medium"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {translations.exportExcel}
            </motion.button>
          </div>
        </div>

        {/* Screen: header + summary + accordion */}
        <div className="no-print space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 border border-purple-200/50 dark:border-purple-800/30">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{customer.full_name}</h1>
            {customer.phone && (
              <p className="text-gray-600 dark:text-gray-300 mt-1" dir="ltr">
                {translations.phone}: {customer.phone}
              </p>
            )}
            {customer.address && (
              <p className="text-gray-600 dark:text-gray-300 mt-0.5">{translations.address}: {customer.address}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <motion.div
              className="p-5 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-2xl border border-purple-200/50 dark:border-purple-700/30"
              whileHover={{ scale: 1.02 }}
            >
              <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">{translations.totalSales}</div>
              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {totalSales.toLocaleString("en-US")} افغانی
              </div>
            </motion.div>
            <motion.div
              className="p-5 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-2xl border border-green-200/50 dark:border-green-700/30"
              whileHover={{ scale: 1.02 }}
            >
              <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">{translations.totalPaid}</div>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {totalPaid.toLocaleString("en-US")} افغانی
              </div>
            </motion.div>
            <motion.div
              className="p-5 bg-gradient-to-br from-red-50 to-pink-50 dark:from-red-900/20 dark:to-pink-900/20 rounded-2xl border border-red-200/50 dark:border-red-700/30"
              whileHover={{ scale: 1.02 }}
            >
              <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">{translations.totalRemaining}</div>
              <div
                className={`text-2xl font-bold ${totalRemaining > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
              >
                {totalRemaining.toLocaleString("en-US")} افغانی
              </div>
            </motion.div>
          </div>

          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">{translations.sales}</h2>
            {sales.length > 0 ? (
              <div className="space-y-2">
                <AnimatePresence>
                  {sales.map((sale) => {
                    const paid = calculatePaidAmount(sale.id);
                    const remaining = sale.total_amount - paid;
                    const payments = salePaymentsMap[sale.id] || [];
                    const isExpanded = expandedSaleIds.has(sale.id);
                    return (
                      <motion.div
                        key={sale.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-600 overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => toggleSaleExpanded(sale.id)}
                          className="w-full flex justify-between items-center p-4 text-right hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                        >
                          <div>
                            <span className="font-bold text-gray-900 dark:text-white">
                              فروش #{sale.id} - {formatPersianDate(sale.date)}
                            </span>
                            <div className="flex gap-4 mt-1 text-sm text-gray-600 dark:text-gray-400">
                              <span>{translations.total}: {sale.total_amount.toLocaleString("en-US")}</span>
                              <span>{translations.paid}: {paid.toLocaleString("en-US")}</span>
                              <span>{translations.remaining}: {remaining.toLocaleString("en-US")}</span>
                            </div>
                          </div>
                          <svg
                            className={`w-5 h-5 text-gray-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="border-t border-gray-200 dark:border-gray-600"
                            >
                              <div className="p-4 bg-gray-50 dark:bg-gray-700/30 space-y-4">
                                {(() => {
                                  const detail = saleDetailsMap[sale.id];
                                  const additionalCosts = saleAdditionalCostsMap[sale.id] ?? [];
                                  const items = detail?.items ?? [];
                                  const serviceItems = detail?.service_items ?? [];
                                  return (
                                    <>
                                      {items.length > 0 && (
                                        <div>
                                          <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">{translations.items}</div>
                                          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-600">
                                            <table className="w-full text-sm">
                                              <thead>
                                                <tr className="bg-gray-100 dark:bg-gray-700">
                                                  <th className="p-2 text-right">{translations.product}</th>
                                                  <th className="p-2 text-right">{translations.unit}</th>
                                                  <th className="p-2 text-right">{translations.quantity}</th>
                                                  <th className="p-2 text-right">{translations.unitPrice}</th>
                                                  <th className="p-2 text-right">{translations.rowTotal}</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {items.map((item) => (
                                                  <tr key={item.id} className="border-t border-gray-200 dark:border-gray-600">
                                                    <td className="p-2">{getProductName(item.product_id)}</td>
                                                    <td className="p-2">{getUnitName(item.unit_id)}</td>
                                                    <td className="p-2">{item.amount.toLocaleString("en-US")}</td>
                                                    <td className="p-2">{item.per_price.toLocaleString("en-US")}</td>
                                                    <td className="p-2">{item.total.toLocaleString("en-US")}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}
                                      {serviceItems.length > 0 && (
                                        <div>
                                          <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">{translations.serviceItems}</div>
                                          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-600">
                                            <table className="w-full text-sm">
                                              <thead>
                                                <tr className="bg-gray-100 dark:bg-gray-700">
                                                  <th className="p-2 text-right">{translations.product}</th>
                                                  <th className="p-2 text-right">{translations.quantity}</th>
                                                  <th className="p-2 text-right">{translations.unitPrice}</th>
                                                  <th className="p-2 text-right">{translations.rowTotal}</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {serviceItems.map((si) => (
                                                  <tr key={si.id} className="border-t border-gray-200 dark:border-gray-600">
                                                    <td className="p-2">{si.name}</td>
                                                    <td className="p-2">{si.quantity.toLocaleString("en-US")}</td>
                                                    <td className="p-2">{si.price.toLocaleString("en-US")}</td>
                                                    <td className="p-2">{si.total.toLocaleString("en-US")}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}
                                      {additionalCosts.length > 0 && (
                                        <div>
                                          <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">{translations.additionalCosts}</div>
                                          <div className="space-y-1">
                                            {additionalCosts.map((ac) => (
                                              <div key={ac.id} className="flex justify-between items-center p-2 bg-white dark:bg-gray-800 rounded-lg">
                                                <span>{ac.name}</span>
                                                <span className="font-semibold">{ac.amount.toLocaleString("en-US")} افغانی</span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {payments.length > 0 && (
                                        <div>
                                          <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">{translations.payments}</div>
                                          <div className="space-y-2">
                                            {payments.map((p) => (
                                              <div
                                                key={p.id}
                                                className="flex justify-between items-center p-2 bg-white dark:bg-gray-800 rounded-lg"
                                              >
                                                <span className="font-semibold">{p.amount.toLocaleString("en-US")} افغانی</span>
                                                <span className="text-xs text-gray-500">{formatPersianDate(p.date)}</span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            ) : (
              <p className="text-center py-8 text-gray-500 dark:text-gray-400">{translations.noSales}</p>
            )}
          </div>
        </div>

        {/* Print/PDF area: summary + full table (hidden on screen, shown in print) */}
        <div
          ref={printRef}
          className="detail-print-area print-only bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 border border-gray-200 dark:border-gray-700 mt-8"
          data-pdf-root
        >
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            {translations.title}: {customer.full_name}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {translations.phone}: {customer.phone || "-"} | {translations.address}: {customer.address || "-"}
          </p>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <div className="text-xs font-bold text-gray-600 dark:text-gray-400">{translations.totalSales}</div>
              <div className="text-lg font-bold">{totalSales.toLocaleString("en-US")} افغانی</div>
            </div>
            <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <div className="text-xs font-bold text-gray-600 dark:text-gray-400">{translations.totalPaid}</div>
              <div className="text-lg font-bold">{totalPaid.toLocaleString("en-US")} افغانی</div>
            </div>
            <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <div className="text-xs font-bold text-gray-600 dark:text-gray-400">{translations.totalRemaining}</div>
              <div className="text-lg font-bold">{totalRemaining.toLocaleString("en-US")} افغانی</div>
            </div>
          </div>
          <table className="w-full border-collapse border border-gray-300 dark:border-gray-600 text-sm">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-700">
                <th className="border border-gray-300 dark:border-gray-600 p-2 text-right">{translations.saleId}</th>
                <th className="border border-gray-300 dark:border-gray-600 p-2 text-right">{translations.date}</th>
                <th className="border border-gray-300 dark:border-gray-600 p-2 text-right">{translations.total}</th>
                <th className="border border-gray-300 dark:border-gray-600 p-2 text-right">{translations.paid}</th>
                <th className="border border-gray-300 dark:border-gray-600 p-2 text-right">{translations.remaining}</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => {
                const paid = calculatePaidAmount(sale.id);
                const remaining = sale.total_amount - paid;
                return (
                  <tr key={sale.id} className="border-b border-gray-200 dark:border-gray-600">
                    <td className="border border-gray-300 dark:border-gray-600 p-2">{sale.id}</td>
                    <td className="border border-gray-300 dark:border-gray-600 p-2">{formatPersianDate(sale.date)}</td>
                    <td className="border border-gray-300 dark:border-gray-600 p-2">{sale.total_amount.toLocaleString("en-US")}</td>
                    <td className="border border-gray-300 dark:border-gray-600 p-2">{paid.toLocaleString("en-US")}</td>
                    <td className="border border-gray-300 dark:border-gray-600 p-2">{remaining.toLocaleString("en-US")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

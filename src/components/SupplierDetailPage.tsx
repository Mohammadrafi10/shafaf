import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { getSuppliers, type Supplier } from "../utils/supplier";
import {
  getPurchases,
  getPurchase,
  getPurchaseAdditionalCosts,
  type Purchase,
  type PurchaseWithItems,
  type PurchaseAdditionalCost,
} from "../utils/purchase";
import {
  getPurchasePaymentsByPurchase,
  type PurchasePayment,
} from "../utils/purchase_payment";
import { getProducts, type Product } from "../utils/product";
import { getUnits, type Unit } from "../utils/unit";
import { formatPersianDate } from "../utils/date";
import { exportReportToPDF, exportReportToExcel } from "../utils/reportExport";
import type { ReportData } from "../utils/report";

const translations = {
  title: "بیلانس تمویل کننده",
  back: "بازگشت",
  totalPurchases: "مجموع خریداری‌ها",
  totalPaid: "مجموع پرداخت شده",
  totalRemaining: "مجموع باقیمانده",
  purchase: "خریداری",
  purchases: "خریداری‌ها",
  payments: "پرداخت‌ها",
  items: "آیتم‌های خریداری",
  product: "محصول",
  unit: "واحد",
  quantity: "مقدار",
  unitPrice: "قیمت واحد",
  rowTotal: "جمع",
  additionalCosts: "هزینه‌های اضافی",
  phone: "شماره تماس",
  address: "آدرس",
  purchaseId: "شماره خریداری",
  date: "تاریخ",
  total: "مبلغ کل",
  paid: "پرداخت شده",
  remaining: "باقیمانده",
  amount: "مبلغ",
  print: "چاپ",
  exportPdf: "خروجی PDF",
  exportExcel: "خروجی Excel",
  noPurchases: "هیچ خریداری ثبت نشده است",
  notFound: "تمویل کننده یافت نشد",
  loading: "در حال بارگذاری...",
};

interface SupplierDetailPageProps {
  supplierId: number;
  onBack: () => void;
}

export default function SupplierDetailPage({ supplierId, onBack }: SupplierDetailPageProps) {
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchasePaymentsMap, setPurchasePaymentsMap] = useState<Record<number, PurchasePayment[]>>({});
  const [purchaseDetailsMap, setPurchaseDetailsMap] = useState<Record<number, PurchaseWithItems>>({});
  const [purchaseAdditionalCostsMap, setPurchaseAdditionalCostsMap] = useState<Record<number, PurchaseAdditionalCost[]>>({});
  const [products, setProducts] = useState<Product[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [expandedPurchaseIds, setExpandedPurchaseIds] = useState<Set<number>>(new Set());
  const printRef = useRef<HTMLDivElement>(null);

  const getProductName = (id: number) => products.find((p) => p.id === id)?.name ?? "-";
  const getUnitName = (id: number) => units.find((u) => u.id === id)?.name ?? "-";

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setNotFound(false);
      const [suppliersRes, purchasesRes, productsRes, unitsData] = await Promise.all([
        getSuppliers(1, 10000, "", "id", "asc"),
        getPurchases(1, 10000, "", "date", "desc"),
        getProducts(1, 10000, "", "id", "asc"),
        getUnits(),
      ]);
      setProducts(productsRes.items);
      setUnits(unitsData);
      const s = suppliersRes.items.find((x) => x.id === supplierId) ?? null;
      setSupplier(s);
      if (!s) {
        setNotFound(true);
        setPurchases([]);
        setPurchasePaymentsMap({});
        setPurchaseDetailsMap({});
        setPurchaseAdditionalCostsMap({});
        return;
      }
      const supplierPurchasesList = purchasesRes.items.filter((p) => p.supplier_id === supplierId);
      setPurchases(supplierPurchasesList);

      const paymentsMap: Record<number, PurchasePayment[]> = {};
      const detailsMap: Record<number, PurchaseWithItems> = {};
      const additionalCostsMap: Record<number, PurchaseAdditionalCost[]> = {};
      await Promise.all(
        supplierPurchasesList.map(async (purchase) => {
          try {
            const [payments, purchaseDetail, additionalCosts] = await Promise.all([
              getPurchasePaymentsByPurchase(purchase.id),
              getPurchase(purchase.id),
              getPurchaseAdditionalCosts(purchase.id),
            ]);
            paymentsMap[purchase.id] = payments;
            detailsMap[purchase.id] = purchaseDetail;
            additionalCostsMap[purchase.id] = additionalCosts;
          } catch {
            paymentsMap[purchase.id] = [];
            additionalCostsMap[purchase.id] = [];
          }
        })
      );
      setPurchasePaymentsMap(paymentsMap);
      setPurchaseDetailsMap(detailsMap);
      setPurchaseAdditionalCostsMap(additionalCostsMap);
    } catch (err) {
      console.error(err);
      toast.error("خطا در بارگذاری اطلاعات");
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [supplierId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const calculatePaidAmount = (purchaseId: number): number => {
    const payments = purchasePaymentsMap[purchaseId] || [];
    return payments.reduce((sum, p) => sum + p.total, 0);
  };

  const totalPurchases = purchases.reduce((sum, p) => sum + p.total_amount, 0);
  const totalPaid = purchases.reduce((sum, p) => sum + calculatePaidAmount(p.id), 0);
  const totalRemaining = totalPurchases - totalPaid;

  const togglePurchaseExpanded = (purchaseId: number) => {
    setExpandedPurchaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(purchaseId)) next.delete(purchaseId);
      else next.add(purchaseId);
      return next;
    });
  };

  const buildReportData = (): ReportData => {
    const from = purchases.length ? purchases[purchases.length - 1].date : new Date().toISOString().slice(0, 10);
    const to = purchases.length ? purchases[0].date : new Date().toISOString().slice(0, 10);
    return {
      title: `${translations.title}: ${supplier?.full_name ?? ""}`,
      type: "supplierDetail",
      dateRange: { from, to },
      summary: {
        totalPurchases,
        totalPaid,
        totalRemaining,
      },
      sections: [
        {
          title: translations.purchases,
          type: "table",
          columns: [
            { key: "purchase_id", label: translations.purchaseId },
            { key: "date", label: translations.date },
            { key: "total", label: translations.total },
            { key: "paid", label: translations.paid },
            { key: "remaining", label: translations.remaining },
          ],
          data: purchases.map((p) => {
            const paid = calculatePaidAmount(p.id);
            const remaining = p.total_amount - paid;
            return {
              purchase_id: p.id,
              date: formatPersianDate(p.date),
              total: p.total_amount.toLocaleString("en-US"),
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
    if (!supplier || !printRef.current) return;
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
    if (!supplier) return;
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

  if (notFound || !supplier) {
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
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{supplier.full_name}</h1>
            {supplier.phone && (
              <p className="text-gray-600 dark:text-gray-300 mt-1" dir="ltr">
                {translations.phone}: {supplier.phone}
              </p>
            )}
            {supplier.address && (
              <p className="text-gray-600 dark:text-gray-300 mt-0.5">{translations.address}: {supplier.address}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <motion.div
              className="p-5 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-2xl border border-purple-200/50 dark:border-purple-700/30"
              whileHover={{ scale: 1.02 }}
            >
              <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">{translations.totalPurchases}</div>
              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {totalPurchases.toLocaleString("en-US")} افغانی
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
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">{translations.purchases}</h2>
            {purchases.length > 0 ? (
              <div className="space-y-2">
                <AnimatePresence>
                  {purchases.map((purchase) => {
                    const paid = calculatePaidAmount(purchase.id);
                    const remaining = purchase.total_amount - paid;
                    const payments = purchasePaymentsMap[purchase.id] || [];
                    const isExpanded = expandedPurchaseIds.has(purchase.id);
                    return (
                      <motion.div
                        key={purchase.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-600 overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => togglePurchaseExpanded(purchase.id)}
                          className="w-full flex justify-between items-center p-4 text-right hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                        >
                          <div>
                            <span className="font-bold text-gray-900 dark:text-white">
                              خریداری #{purchase.id} - {formatPersianDate(purchase.date)}
                            </span>
                            <div className="flex gap-4 mt-1 text-sm text-gray-600 dark:text-gray-400">
                              <span>{translations.total}: {purchase.total_amount.toLocaleString("en-US")}</span>
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
                                  const detail = purchaseDetailsMap[purchase.id];
                                  const additionalCosts = purchaseAdditionalCostsMap[purchase.id] ?? [];
                                  const items = detail?.items ?? [];
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
                                                <span className="font-semibold">{p.total.toLocaleString("en-US")} ({p.currency})</span>
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
              <p className="text-center py-8 text-gray-500 dark:text-gray-400">{translations.noPurchases}</p>
            )}
          </div>
        </div>

        {/* Print/PDF area */}
        <div
          ref={printRef}
          className="detail-print-area print-only bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 border border-gray-200 dark:border-gray-700 mt-8"
          data-pdf-root
        >
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            {translations.title}: {supplier.full_name}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {translations.phone}: {supplier.phone || "-"} | {translations.address}: {supplier.address || "-"}
          </p>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <div className="text-xs font-bold text-gray-600 dark:text-gray-400">{translations.totalPurchases}</div>
              <div className="text-lg font-bold">{totalPurchases.toLocaleString("en-US")} افغانی</div>
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
                <th className="border border-gray-300 dark:border-gray-600 p-2 text-right">{translations.purchaseId}</th>
                <th className="border border-gray-300 dark:border-gray-600 p-2 text-right">{translations.date}</th>
                <th className="border border-gray-300 dark:border-gray-600 p-2 text-right">{translations.total}</th>
                <th className="border border-gray-300 dark:border-gray-600 p-2 text-right">{translations.paid}</th>
                <th className="border border-gray-300 dark:border-gray-600 p-2 text-right">{translations.remaining}</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase) => {
                const paid = calculatePaidAmount(purchase.id);
                const remaining = purchase.total_amount - paid;
                return (
                  <tr key={purchase.id} className="border-b border-gray-200 dark:border-gray-600">
                    <td className="border border-gray-300 dark:border-gray-600 p-2">{purchase.id}</td>
                    <td className="border border-gray-300 dark:border-gray-600 p-2">{formatPersianDate(purchase.date)}</td>
                    <td className="border border-gray-300 dark:border-gray-600 p-2">{purchase.total_amount.toLocaleString("en-US")}</td>
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

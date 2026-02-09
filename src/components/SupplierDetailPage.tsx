import { Fragment, useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
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


  const handlePrint = () => {
    if (!printRef.current) return;
    window.print();
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950" dir="rtl">
      <style>{`
        .detail-print-area.print-only { display: none !important; }
        @media print {
          @page { margin: 1cm; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body { background: white !important; margin: 0; padding: 0; }
          .no-print { display: none !important; }
          .detail-print-area.print-only { display: block !important; visibility: visible !important; }
          .detail-print-area { background: white !important; color: black !important; position: relative !important; page-break-inside: avoid; }
          .detail-print-area * { color: black !important; }
        }
      `}</style>

      <header className="no-print sticky top-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <motion.button onClick={onBack} className="flex-shrink-0 p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 dark:hover:text-gray-300 transition-colors" whileHover={{ x: 4 }} aria-label={translations.back}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </motion.button>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold text-gray-900 dark:text-white truncate">{translations.title}</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{supplier.full_name}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <motion.button onClick={handlePrint} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors" whileTap={{ scale: 0.98 }}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h2z" /></svg>
                {translations.print}
              </motion.button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="no-print space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
                <div className="p-5">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center flex-shrink-0">
                      <span className="text-xl font-bold text-teal-600 dark:text-teal-400">{supplier.full_name.charAt(0)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">{supplier.full_name}</h2>
                      {supplier.phone && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5" dir="ltr">{supplier.phone}</p>}
                    </div>
                  </div>
                  {supplier.address && (
                    <dl className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                      <dt className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">{translations.address}</dt>
                      <dd className="mt-1 text-sm text-gray-700 dark:text-gray-300">{supplier.address}</dd>
                    </dl>
                  )}
                </div>
              </div>
            </section>
            <section className="lg:col-span-8">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 h-full">
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{translations.totalPurchases}</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{totalPurchases.toLocaleString("en-US")}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">افغانی</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{translations.totalPaid}</p>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{totalPaid.toLocaleString("en-US")}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">افغانی</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{translations.totalRemaining}</p>
                  <p className={`text-2xl font-bold tabular-nums ${totalRemaining > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>{totalRemaining.toLocaleString("en-US")}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">افغانی</p>
                </div>
              </div>
            </section>
          </div>

          <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">{translations.purchases}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{purchases.length} {translations.purchase}</p>
            </div>
            {purchases.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700">
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-10" />
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{translations.purchaseId}</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{translations.date}</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{translations.total}</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{translations.paid}</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{translations.remaining}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {purchases.map((purchase) => {
                      const paid = calculatePaidAmount(purchase.id);
                      const remaining = purchase.total_amount - paid;
                      const payments = purchasePaymentsMap[purchase.id] || [];
                      const isExpanded = expandedPurchaseIds.has(purchase.id);
                      return (
                        <Fragment key={purchase.id}>
                          <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                            <td className="px-4 py-3 w-10">
                              <button type="button" onClick={() => togglePurchaseExpanded(purchase.id)} className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" aria-expanded={isExpanded}>
                                <svg className={`w-5 h-5 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                              </button>
                            </td>
                            <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">#{purchase.id}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{formatPersianDate(purchase.date)}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-white tabular-nums">{purchase.total_amount.toLocaleString("en-US")}</td>
                            <td className="px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400 tabular-nums">{paid.toLocaleString("en-US")}</td>
                            <td className="px-4 py-3 text-sm tabular-nums">
                              <span className={remaining > 0 ? "text-red-600 dark:text-red-400 font-medium" : "text-gray-600 dark:text-gray-400"}>{remaining.toLocaleString("en-US")}</span>
                            </td>
                          </motion.tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={6} className="p-0 bg-gray-50 dark:bg-gray-800/60">
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="px-5 py-4 border-t border-gray-200 dark:border-gray-700">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {(() => {
                                      const detail = purchaseDetailsMap[purchase.id];
                                      const additionalCosts = purchaseAdditionalCostsMap[purchase.id] ?? [];
                                      const items = detail?.items ?? [];
                                      return (
                                        <>
                                          {items.length > 0 && (
                                            <div>
                                              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{translations.items}</h3>
                                              <div className="rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
                                                <table className="w-full text-sm">
                                                  <thead><tr className="bg-gray-100 dark:bg-gray-700"><th className="px-3 py-2 text-right text-xs font-medium text-gray-500">{translations.product}</th><th className="px-3 py-2 text-right text-xs font-medium text-gray-500">{translations.unit}</th><th className="px-3 py-2 text-right text-xs font-medium text-gray-500">{translations.quantity}</th><th className="px-3 py-2 text-right text-xs font-medium text-gray-500">{translations.unitPrice}</th><th className="px-3 py-2 text-right text-xs font-medium text-gray-500">{translations.rowTotal}</th></tr></thead>
                                                  <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                                                    {items.map((item) => (
                                                      <tr key={item.id}><td className="px-3 py-2">{getProductName(item.product_id)}</td><td className="px-3 py-2">{getUnitName(item.unit_id)}</td><td className="px-3 py-2 tabular-nums">{item.amount.toLocaleString("en-US")}</td><td className="px-3 py-2 tabular-nums">{item.per_price.toLocaleString("en-US")}</td><td className="px-3 py-2 tabular-nums">{item.total.toLocaleString("en-US")}</td></tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              </div>
                                            </div>
                                          )}
                                          {(additionalCosts.length > 0 || payments.length > 0) && (
                                            <div className="md:col-span-2 space-y-4">
                                              {additionalCosts.length > 0 && (
                                                <div>
                                                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{translations.additionalCosts}</h3>
                                                  <ul className="rounded-lg border border-gray-200 dark:border-gray-600 divide-y divide-gray-200 dark:divide-gray-600">
                                                    {additionalCosts.map((ac) => (
                                                      <li key={ac.id} className="flex justify-between items-center px-3 py-2 bg-white dark:bg-gray-800 text-sm"><span>{ac.name}</span><span className="font-medium tabular-nums">{ac.amount.toLocaleString("en-US")} افغانی</span></li>
                                                    ))}
                                                  </ul>
                                                </div>
                                              )}
                                              {payments.length > 0 && (
                                                <div>
                                                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{translations.payments}</h3>
                                                  <ul className="rounded-lg border border-gray-200 dark:border-gray-600 divide-y divide-gray-200 dark:divide-gray-600">
                                                    {payments.map((p) => (
                                                      <li key={p.id} className="flex justify-between items-center px-3 py-2 bg-white dark:bg-gray-800 text-sm"><span className="font-medium tabular-nums">{p.total.toLocaleString("en-US")} ({p.currency})</span><span className="text-gray-500 text-xs">{formatPersianDate(p.date)}</span></li>
                                                    ))}
                                                  </ul>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>
                                </motion.div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-5 py-12 text-center">
                <p className="text-gray-500 dark:text-gray-400">{translations.noPurchases}</p>
              </div>
            )}
          </section>
        </div>

        {/* Print area: summary + full table with details (hidden on screen, shown in print) */}
        <div
          ref={printRef}
          className="detail-print-area print-only bg-white rounded-xl shadow-sm p-6 border border-gray-300 mt-8"
        >
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            {translations.title}: {supplier.full_name}
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            {translations.phone}: {supplier.phone || "-"} | {translations.address}: {supplier.address || "-"}
          </p>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-3 bg-gray-100 rounded-lg">
              <div className="text-xs font-bold text-gray-600">{translations.totalPurchases}</div>
              <div className="text-lg font-bold">{totalPurchases.toLocaleString("en-US")} افغانی</div>
            </div>
            <div className="p-3 bg-gray-100 rounded-lg">
              <div className="text-xs font-bold text-gray-600">{translations.totalPaid}</div>
              <div className="text-lg font-bold">{totalPaid.toLocaleString("en-US")} افغانی</div>
            </div>
            <div className="p-3 bg-gray-100 rounded-lg">
              <div className="text-xs font-bold text-gray-600">{translations.totalRemaining}</div>
              <div className="text-lg font-bold">{totalRemaining.toLocaleString("en-US")} افغانی</div>
            </div>
          </div>
          <div className="space-y-6">
            {purchases.map((purchase) => {
              const paid = calculatePaidAmount(purchase.id);
              const remaining = purchase.total_amount - paid;
              const detail = purchaseDetailsMap[purchase.id];
              const additionalCosts = purchaseAdditionalCostsMap[purchase.id] ?? [];
              const payments = purchasePaymentsMap[purchase.id] || [];
              const items = detail?.items ?? [];
              return (
                <div key={purchase.id} className="border border-gray-300 rounded-lg p-4">
                  <div className="grid grid-cols-5 gap-2 mb-4 pb-3 border-b border-gray-300">
                    <div><strong>{translations.purchaseId}:</strong> #{purchase.id}</div>
                    <div><strong>{translations.date}:</strong> {formatPersianDate(purchase.date)}</div>
                    <div><strong>{translations.total}:</strong> {purchase.total_amount.toLocaleString("en-US")}</div>
                    <div><strong>{translations.paid}:</strong> {paid.toLocaleString("en-US")}</div>
                    <div><strong>{translations.remaining}:</strong> {remaining.toLocaleString("en-US")}</div>
                  </div>
                  {items.length > 0 && (
                    <div className="mb-4">
                      <h3 className="text-sm font-bold mb-2">{translations.items}</h3>
                      <table className="w-full border-collapse border border-gray-300 text-sm">
                        <thead>
                          <tr className="bg-gray-100">
                            <th className="border border-gray-300 p-2 text-right">{translations.product}</th>
                            <th className="border border-gray-300 p-2 text-right">{translations.unit}</th>
                            <th className="border border-gray-300 p-2 text-right">{translations.quantity}</th>
                            <th className="border border-gray-300 p-2 text-right">{translations.unitPrice}</th>
                            <th className="border border-gray-300 p-2 text-right">{translations.rowTotal}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item) => (
                            <tr key={item.id}>
                              <td className="border border-gray-300 p-2">{getProductName(item.product_id)}</td>
                              <td className="border border-gray-300 p-2">{getUnitName(item.unit_id)}</td>
                              <td className="border border-gray-300 p-2">{item.amount.toLocaleString("en-US")}</td>
                              <td className="border border-gray-300 p-2">{item.per_price.toLocaleString("en-US")}</td>
                              <td className="border border-gray-300 p-2">{item.total.toLocaleString("en-US")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {additionalCosts.length > 0 && (
                    <div className="mb-4">
                      <h3 className="text-sm font-bold mb-2">{translations.additionalCosts}</h3>
                      <ul className="border border-gray-300 rounded divide-y divide-gray-300">
                        {additionalCosts.map((ac) => (
                          <li key={ac.id} className="flex justify-between items-center p-2">
                            <span>{ac.name}</span>
                            <span className="font-medium">{ac.amount.toLocaleString("en-US")} افغانی</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {payments.length > 0 && (
                    <div>
                      <h3 className="text-sm font-bold mb-2">{translations.payments}</h3>
                      <ul className="border border-gray-300 rounded divide-y divide-gray-300">
                        {payments.map((p) => (
                          <li key={p.id} className="flex justify-between items-center p-2">
                            <span className="font-medium">{p.total.toLocaleString("en-US")} ({p.currency})</span>
                            <span className="text-gray-600 text-xs">{formatPersianDate(p.date)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}

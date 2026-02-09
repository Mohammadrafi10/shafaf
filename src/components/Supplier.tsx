import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
  initSuppliersTable,
  createSupplier,
  getSuppliers,
  updateSupplier,
  deleteSupplier,
  type Supplier,
} from "../utils/supplier";
import { getPurchases, type Purchase } from "../utils/purchase";
import {
  initPurchasePaymentsTable,
  getPurchasePaymentsByPurchase,
  createPurchasePayment,
  deletePurchasePayment,
  type PurchasePayment,
} from "../utils/purchase_payment";
import { getCurrencies, type Currency } from "../utils/currency";
import { getAccounts, type Account } from "../utils/account";
import { formatPersianDate, getCurrentPersianDate, persianToGeorgian } from "../utils/date";
import PersianDatePicker from "./PersianDatePicker";
import { isDatabaseOpen, openDatabase } from "../utils/db";
import Footer from "./Footer";
import Table from "./common/Table";
import PageHeader from "./common/PageHeader";
import ViewModeToggle, { type ViewMode } from "./common/ViewModeToggle";
import ThumbnailGrid from "./common/ThumbnailGrid";
import { Search } from "lucide-react";

// Dari translations
const translations = {
  title: "تمویل کننده ها",
  addNew: "افزودن تمویل کننده جدید",
  edit: "ویرایش",
  delete: "حذف",
  cancel: "لغو",
  save: "ذخیره",
  fullName: "نام کامل",
  phone: "شماره تماس",
  address: "آدرس",
  email: "ایمیل",
  notes: "یادداشت",
  actions: "عملیات",
  createdAt: "تاریخ ایجاد",
  updatedAt: "آخرین بروزرسانی",
  totalPurchases: "مجموع خریداری‌ها",
  totalPaid: "مجموع پرداخت شده",
  totalRemaining: "مجموع باقیمانده",
  viewBalance: "مشاهده بیلانس",
  viewDetailPage: "صفحه تمویل کننده",
  balance: "بیلانس",
  purchase: "خریداری",
  purchaseDate: "تاریخ خریداری",
  purchaseTotal: "مبلغ کل",
  paidAmount: "پرداخت شده",
  remainingAmount: "باقیمانده",
  addPayment: "افزودن پرداخت",
  paymentAmount: "مبلغ پرداخت",
  paymentCurrency: "ارز",
  paymentRate: "نرخ",
  paymentTotal: "مجموع",
  paymentDate: "تاریخ پرداخت",
  paymentNotes: "یادداشت",
  noPayments: "هیچ پرداختی ثبت نشده است",
  noPurchases: "هیچ خریداری ثبت نشده است",
  noSuppliers: "هیچ تمویل کننده‌ای ثبت نشده است",
  confirmDelete: "آیا از حذف این تمویل کننده اطمینان دارید؟",
  backToDashboard: "بازگشت به داشبورد",
  success: {
    created: "تمویل کننده با موفقیت ایجاد شد",
    updated: "تمویل کننده با موفقیت بروزرسانی شد",
    deleted: "تمویل کننده با موفقیت حذف شد",
    tableInit: "جدول تمویل کننده‌ها با موفقیت ایجاد شد",
  },
  errors: {
    create: "خطا در ایجاد تمویل کننده",
    update: "خطا در بروزرسانی تمویل کننده",
    delete: "خطا در حذف تمویل کننده",
    fetch: "خطا در دریافت تمویل کننده‌ها",
    nameRequired: "نام کامل الزامی است",
    phoneRequired: "شماره تماس الزامی است",
    addressRequired: "آدرس الزامی است",
  },
  placeholders: {
    fullName: "نام کامل تمویل کننده را وارد کنید",
    phone: "شماره تماس را وارد کنید",
    address: "آدرس را وارد کنید",
    email: "ایمیل را وارد کنید (اختیاری)",
    notes: "یادداشت‌ها را وارد کنید (اختیاری)",
  },
};

interface SupplierManagementProps {
  onBack?: () => void;
  onNavigateToBalancePage?: () => void;
  onNavigateToDetail?: (supplierId: number) => void;
}

export default function SupplierManagement({ onBack, onNavigateToBalancePage, onNavigateToDetail }: SupplierManagementProps) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierBalances, setSupplierBalances] = useState<Record<number, { totalPurchases: number; totalPaid: number; totalRemaining: number }>>({});
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBalanceModalOpen, setIsBalanceModalOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [supplierPurchases, setSupplierPurchases] = useState<Purchase[]>([]);
  const [purchasePaymentsMap, setPurchasePaymentsMap] = useState<Record<number, PurchasePayment[]>>({});
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [paymentFormData, setPaymentFormData] = useState({
    purchase_id: "",
    account_id: "",
    amount: "",
    currency: "",
    rate: "1",
    total: "",
    date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
    notes: "",
  });
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedPurchaseForPayment, setSelectedPurchaseForPayment] = useState<Purchase | null>(null);
  const [formData, setFormData] = useState({
    full_name: "",
    phone: "",
    address: "",
    email: "",
    notes: "",
  });
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // Pagination & Search
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // View mode: table or thumbnail
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem("supplierViewMode");
      return (saved === "thumbnail" ? "thumbnail" : "table") as ViewMode;
    } catch { return "table"; }
  });
  useEffect(() => {
    try { localStorage.setItem("supplierViewMode", viewMode); } catch { /* ignore */ }
  }, [viewMode]);

  useEffect(() => {
    loadSuppliers();
  }, [page, perPage, search, sortBy, sortOrder]);

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      const dbOpen = await isDatabaseOpen();
      if (!dbOpen) {
        await openDatabase("db");
      }

      try {
        await initSuppliersTable();
        await initPurchasePaymentsTable();
      } catch (err) {
        console.log("Table initialization:", err);
      }

      const response = await getSuppliers(page, perPage, search, sortBy, sortOrder);
      setSuppliers(response.items);
      setTotalItems(response.total);

      // Load all purchases to calculate balances
      const allPurchases = await getPurchases(1, 10000, "", "date", "desc");
      
      // Calculate balances for each supplier
      const balances: Record<number, { totalPurchases: number; totalPaid: number; totalRemaining: number }> = {};
      
      await Promise.all(
        response.items.map(async (supplier) => {
          const supplierPurchases = allPurchases.items.filter(p => p.supplier_id === supplier.id);
          let totalPurchases = 0;
          let totalPaid = 0;

          for (const purchase of supplierPurchases) {
            totalPurchases += purchase.total_amount;
            try {
              const payments = await getPurchasePaymentsByPurchase(purchase.id);
              const paid = payments.reduce((sum, payment) => sum + payment.total, 0);
              totalPaid += paid;
            } catch (error) {
              console.error(`Error loading payments for purchase ${purchase.id}:`, error);
            }
          }

          balances[supplier.id] = {
            totalPurchases,
            totalPaid,
            totalRemaining: totalPurchases - totalPaid,
          };
        })
      );

      setSupplierBalances(balances);
    } catch (error: any) {
      toast.error(translations.errors.fetch);
      console.error("Error loading suppliers:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenBalanceModal = async (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setIsBalanceModalOpen(true);
    
    try {
      setLoading(true);
      // Load all purchases for this supplier
      const allPurchases = await getPurchases(1, 10000, "", "date", "desc");
      const supplierPurchasesList = allPurchases.items.filter(p => p.supplier_id === supplier.id);
      setSupplierPurchases(supplierPurchasesList);

      // Load currencies and accounts
      const [currenciesData, accountsData] = await Promise.all([
        getCurrencies(),
        getAccounts(),
      ]);
      setCurrencies(currenciesData);
      setAccounts(accountsData);

      // Load payments for each purchase
      const paymentsMap: Record<number, PurchasePayment[]> = {};
      await Promise.all(
        supplierPurchasesList.map(async (purchase) => {
          try {
            const payments = await getPurchasePaymentsByPurchase(purchase.id);
            paymentsMap[purchase.id] = payments;
          } catch (error) {
            paymentsMap[purchase.id] = [];
          }
        })
      );
      setPurchasePaymentsMap(paymentsMap);
    } catch (error: any) {
      toast.error("خطا در بارگذاری اطلاعات بیلانس");
      console.error("Error loading balance:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCloseBalanceModal = () => {
    setIsBalanceModalOpen(false);
    setSelectedSupplier(null);
    setSupplierPurchases([]);
    setPurchasePaymentsMap({});
  };

  const calculatePaidAmount = (purchaseId: number): number => {
    const payments = purchasePaymentsMap[purchaseId] || [];
    return payments.reduce((sum, payment) => sum + payment.total, 0);
  };

  const calculateRemainingAmount = (purchase: Purchase): number => {
    const paid = calculatePaidAmount(purchase.id);
    return purchase.total_amount - paid;
  };

  const handleOpenPaymentModal = (purchase: Purchase) => {
    setSelectedPurchaseForPayment(purchase);
    setPaymentFormData({
      purchase_id: purchase.id.toString(),
      account_id: "",
      amount: "",
      currency: currencies[0]?.name || "",
      rate: "1",
      total: "",
      date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
      notes: "",
    });
    setIsPaymentModalOpen(true);
  };

  const handleClosePaymentModal = () => {
    setIsPaymentModalOpen(false);
    setSelectedPurchaseForPayment(null);
    setPaymentFormData({
      purchase_id: "",
      account_id: "",
      amount: "",
      currency: "",
      rate: "1",
      total: "",
      date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
      notes: "",
    });
  };

  const calculatePaymentTotal = () => {
    const amount = parseFloat(paymentFormData.amount) || 0;
    const rate = parseFloat(paymentFormData.rate) || 1;
    return amount * rate;
  };

  useEffect(() => {
    if (isPaymentModalOpen) {
      const total = calculatePaymentTotal();
      setPaymentFormData(prev => ({ ...prev, total: total.toFixed(2) }));
    }
  }, [paymentFormData.amount, paymentFormData.rate, isPaymentModalOpen]);

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPurchaseForPayment) return;

    if (!paymentFormData.amount || parseFloat(paymentFormData.amount) <= 0) {
      toast.error("مبلغ پرداخت باید بیشتر از صفر باشد");
      return;
    }

    if (!paymentFormData.currency) {
      toast.error("انتخاب ارز الزامی است");
      return;
    }

    try {
      setLoading(true);
      const amount = parseFloat(paymentFormData.amount);
      const rate = parseFloat(paymentFormData.rate) || 1;
      const account_id = paymentFormData.account_id ? parseInt(paymentFormData.account_id) : null;
      await createPurchasePayment(
        selectedPurchaseForPayment.id,
        account_id,
        amount,
        paymentFormData.currency,
        rate,
        paymentFormData.date,
        paymentFormData.notes || null
      );
      toast.success("پرداخت با موفقیت ثبت شد");
      handleClosePaymentModal();
      // Reload balance data
      if (selectedSupplier) {
        await handleOpenBalanceModal(selectedSupplier);
      }
      await loadSuppliers();
    } catch (error: any) {
      toast.error("خطا در ثبت پرداخت");
      console.error("Error adding payment:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePayment = async (paymentId: number, _purchaseId: number) => {
    try {
      setLoading(true);
      await deletePurchasePayment(paymentId);
      toast.success("پرداخت با موفقیت حذف شد");
      // Reload balance data
      if (selectedSupplier) {
        await handleOpenBalanceModal(selectedSupplier);
      }
      await loadSuppliers();
    } catch (error: any) {
      toast.error("خطا در حذف پرداخت");
      console.error("Error deleting payment:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (supplier?: Supplier) => {
    if (supplier) {
      setEditingSupplier(supplier);
      setFormData({
        full_name: supplier.full_name,
        phone: supplier.phone,
        address: supplier.address,
        email: supplier.email || "",
        notes: supplier.notes || "",
      });
    } else {
      setEditingSupplier(null);
      setFormData({
        full_name: "",
        phone: "",
        address: "",
        email: "",
        notes: "",
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingSupplier(null);
    setFormData({
      full_name: "",
      phone: "",
      address: "",
      email: "",
      notes: "",
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.full_name.trim()) {
      toast.error(translations.errors.nameRequired);
      return;
    }

    if (!formData.phone.trim()) {
      toast.error(translations.errors.phoneRequired);
      return;
    }

    if (!formData.address.trim()) {
      toast.error(translations.errors.addressRequired);
      return;
    }

    try {
      setLoading(true);
      if (editingSupplier) {
        await updateSupplier(
          editingSupplier.id,
          formData.full_name,
          formData.phone,
          formData.address,
          formData.email || null,
          formData.notes || null
        );
        toast.success(translations.success.updated);
      } else {
        await createSupplier(
          formData.full_name,
          formData.phone,
          formData.address,
          formData.email || null,
          formData.notes || null
        );
        toast.success(translations.success.created);
      }
      handleCloseModal();
      await loadSuppliers();
    } catch (error: any) {
      toast.error(editingSupplier ? translations.errors.update : translations.errors.create);
      console.error("Error saving supplier:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      setLoading(true);
      await deleteSupplier(id);
      toast.success(translations.success.deleted);
      setDeleteConfirm(null);
      await loadSuppliers();
    } catch (error: any) {
      toast.error(translations.errors.delete);
      console.error("Error deleting supplier:", error);
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      key: "full_name", label: translations.fullName, sortable: true,
      render: (s: Supplier) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-teal-500 rounded-full flex items-center justify-center text-white font-bold text-xs">
            {s.full_name.charAt(0)}
          </div>
          <span className="font-medium text-gray-900 dark:text-white">{s.full_name}</span>
        </div>
      )
    },
    {
      key: "phone", label: translations.phone, sortable: true,
      render: (s: Supplier) => (
        <span className="font-mono text-gray-700 dark:text-gray-300" dir="ltr">{s.phone}</span>
      )
    },
    {
      key: "address", label: translations.address, sortable: false,
      render: (s: Supplier) => (
        <span className="text-gray-600 dark:text-gray-400 text-sm truncate max-w-xs block" title={s.address}>
          {s.address}
        </span>
      )
    },
    {
      key: "email", label: translations.email, sortable: true,
      render: (s: Supplier) => s.email ? (
        <span className="text-gray-600 dark:text-gray-400 text-sm" dir="ltr">{s.email}</span>
      ) : <span className="text-gray-400">-</span>
    },
    {
      key: "totalPurchases", label: translations.totalPurchases, sortable: false,
      render: (s: Supplier) => {
        const balance = supplierBalances[s.id];
        return (
          <span className="text-lg font-bold text-purple-600 dark:text-purple-400">
            {balance ? balance.totalPurchases.toLocaleString('en-US') : '0'} افغانی
          </span>
        );
      }
    },
    {
      key: "totalPaid", label: translations.totalPaid, sortable: false,
      render: (s: Supplier) => {
        const balance = supplierBalances[s.id];
        return (
          <span className="text-lg font-bold text-green-600 dark:text-green-400">
            {balance ? balance.totalPaid.toLocaleString('en-US') : '0'} افغانی
          </span>
        );
      }
    },
    {
      key: "totalRemaining", label: translations.totalRemaining, sortable: false,
      render: (s: Supplier) => {
        const balance = supplierBalances[s.id];
        const remaining = balance ? balance.totalRemaining : 0;
        return (
          <span className={`text-lg font-bold ${remaining > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
            {remaining.toLocaleString('en-US')} افغانی
          </span>
        );
      }
    },
    {
      key: "created_at", label: translations.createdAt, sortable: true,
      render: (s: Supplier) => (
        <span className="text-gray-600 dark:text-gray-400 text-sm">
          {new Date(s.created_at).toLocaleDateString('fa-IR')}
        </span>
      )
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-6" dir="rtl">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title={translations.title}
          onBack={onBack}
          backLabel={translations.backToDashboard}
          actions={[
            ...(onNavigateToBalancePage
              ? [
                  {
                    label: "بیلانس تمویل کننده ها",
                    onClick: onNavigateToBalancePage,
                    variant: "secondary" as const,
                  },
                ]
              : []),
            {
              label: translations.addNew,
              onClick: () => handleOpenModal(),
              variant: "primary" as const
            }
          ]}
        >
          <ViewModeToggle viewMode={viewMode} onChange={setViewMode} tableLabel="لیست" thumbnailLabel="کارت" />
        </PageHeader>

          {/* Search Bar */}
          <div className="relative max-w-md w-full">
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="block w-full pr-10 pl-3 py-3 border border-gray-200 dark:border-gray-700 rounded-xl leading-5 bg-white dark:bg-gray-800 placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 sm:text-sm transition-all shadow-sm hover:shadow-md"
              placeholder="جستجو بر اساس نام، شماره تماس یا ایمیل..."
            />
          </div>

        {viewMode === "table" ? (
          <Table
            data={suppliers}
            columns={columns}
            total={totalItems}
            page={page}
            perPage={perPage}
            onPageChange={setPage}
            onPerPageChange={setPerPage}
            onSort={(key, dir) => {
              setSortBy(key);
              setSortOrder(dir);
            }}
            sortBy={sortBy}
            sortOrder={sortOrder}
            loading={loading}
            actions={(supplier) => (
              <div className="flex items-center gap-2">
                {onNavigateToDetail && (
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => onNavigateToDetail(supplier.id)}
                    className="p-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
                    title={translations.viewDetailPage}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </motion.button>
                )}
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => handleOpenBalanceModal(supplier)}
                  className="p-2 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
                  title={translations.viewBalance}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => handleOpenModal(supplier)}
                  className="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                  title={translations.edit}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setDeleteConfirm(supplier.id)}
                  className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                  title={translations.delete}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </motion.button>
              </div>
            )}
          />
        ) : (
          <ThumbnailGrid
            data={suppliers}
            total={totalItems}
            page={page}
            perPage={perPage}
            onPageChange={setPage}
            onPerPageChange={setPerPage}
            loading={loading}
            renderCard={(s) => {
              const balance = supplierBalances[s.id];
              return (
                <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800/80 p-4 shadow-lg hover:shadow-xl hover:border-purple-300 dark:hover:border-purple-600 transition-all h-full flex flex-col">
                  <div className="flex justify-center mb-3">
                    <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-teal-500 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-md">
                      {s.full_name.charAt(0)}
                    </div>
                  </div>
                  <div className="font-bold text-gray-900 dark:text-white text-center mb-1 truncate" title={s.full_name}>{s.full_name}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 text-center font-mono" dir="ltr">{s.phone}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-500 text-center truncate mb-2" title={s.address}>{s.address}</div>
                  {balance != null && (
                    <div className="text-xs text-center mb-2">
                      <span className="text-purple-600 dark:text-purple-400 font-semibold">باقیمانده: </span>
                      <span>{balance.totalRemaining.toLocaleString("en-US")} افغانی</span>
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-1.5 mt-auto pt-2">
                    {onNavigateToDetail && (
                      <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => onNavigateToDetail(s.id)} className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg" title={translations.viewDetailPage}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg></motion.button>
                    )}
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => handleOpenBalanceModal(s)} className="p-2 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg" title={translations.viewBalance}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></motion.button>
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => handleOpenModal(s)} className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg" title={translations.edit}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></motion.button>
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setDeleteConfirm(s.id)} className="p-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg" title={translations.delete}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></motion.button>
                  </div>
                </div>
              );
            }}
          />
        )}

        {/* Modal for Add/Edit */}
        <AnimatePresence>
          {isModalOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
              onClick={handleCloseModal}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
              >
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                  {editingSupplier ? translations.edit : translations.addNew}
                </h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {translations.fullName} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.full_name}
                      onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                      required
                      className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                      placeholder={translations.placeholders.fullName}
                      dir="rtl"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {translations.phone} <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      required
                      className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                      placeholder={translations.placeholders.phone}
                      dir="rtl"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {translations.address} <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      required
                      rows={3}
                      className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200 resize-none"
                      placeholder={translations.placeholders.address}
                      dir="rtl"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {translations.email}
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                      placeholder={translations.placeholders.email}
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {translations.notes}
                    </label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      rows={4}
                      className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200 resize-none"
                      placeholder={translations.placeholders.notes}
                      dir="rtl"
                    />
                  </div>
                  <div className="flex gap-3 pt-4">
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={handleCloseModal}
                      className="flex-1 px-4 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-bold rounded-xl transition-colors"
                    >
                      {translations.cancel}
                    </motion.button>
                    <motion.button
                      type="submit"
                      disabled={loading}
                      whileHover={{ scale: loading ? 1 : 1.05 }}
                      whileTap={{ scale: loading ? 1 : 0.95 }}
                      className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-bold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? (
                        <span className="flex items-center justify-center gap-2">
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                          />
                          {translations.save}
                        </span>
                      ) : (
                        translations.save
                      )}
                    </motion.button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Delete Confirmation Modal */}
        <AnimatePresence>
          {deleteConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4"
              onClick={() => setDeleteConfirm(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-md border border-red-100 dark:border-red-900/30"
              >
                <div className="flex justify-center mb-6">
                  <motion.div
                    animate={{
                      scale: [1, 1.1, 1],
                      rotate: [0, -5, 5, -5, 0]
                    }}
                    transition={{
                      duration: 0.5,
                      repeat: Infinity,
                      repeatDelay: 2
                    }}
                    className="w-20 h-20 bg-gradient-to-br from-red-500 to-pink-500 rounded-full flex items-center justify-center shadow-lg"
                  >
                    <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </motion.div>
                </div>
                <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-white mb-3">
                  {translations.delete}
                </h2>
                <p className="text-center text-gray-600 dark:text-gray-400 mb-8 leading-relaxed">
                  {translations.confirmDelete}
                </p>
                <div className="flex gap-3">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setDeleteConfirm(null)}
                    className="flex-1 px-6 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-bold rounded-xl transition-all duration-200 shadow-md hover:shadow-lg"
                  >
                    {translations.cancel}
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleDelete(deleteConfirm)}
                    disabled={loading}
                    className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 text-white font-bold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                          className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                        />
                        در حال حذف...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        {translations.delete}
                      </span>
                    )}
                  </motion.button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Balance Modal */}
        <AnimatePresence>
          {isBalanceModalOpen && selectedSupplier && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4"
              onClick={handleCloseBalanceModal}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-6xl max-h-[90vh] overflow-y-auto border border-purple-100 dark:border-purple-900/30"
              >
                {/* Header */}
                <div className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-gradient-to-br from-green-500 to-teal-500 rounded-2xl flex items-center justify-center shadow-lg">
                      <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-teal-600 bg-clip-text text-transparent">
                        {translations.balance} - {selectedSupplier.full_name}
                      </h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        مشاهده خریداری‌ها و پرداخت‌های تمویل کننده
                      </p>
                    </div>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleCloseBalanceModal}
                    className="p-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                  >
                    <svg className="w-6 h-6 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </motion.button>
                </div>

                {/* Summary Cards */}
                {supplierBalances[selectedSupplier.id] && (
                  <div className="grid grid-cols-3 gap-4 mb-8">
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      className="p-5 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-2xl border border-purple-200/50 dark:border-purple-700/30">
                      <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                        {translations.totalPurchases}
                      </div>
                      <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                        {supplierBalances[selectedSupplier.id].totalPurchases.toLocaleString('en-US')} افغانی
                      </div>
                    </motion.div>
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      className="p-5 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-2xl border border-green-200/50 dark:border-green-700/30">
                      <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                        {translations.totalPaid}
                      </div>
                      <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {supplierBalances[selectedSupplier.id].totalPaid.toLocaleString('en-US')} افغانی
                      </div>
                    </motion.div>
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      className="p-5 bg-gradient-to-br from-red-50 to-pink-50 dark:from-red-900/20 dark:to-pink-900/20 rounded-2xl border border-red-200/50 dark:border-red-700/30">
                      <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                        {translations.totalRemaining}
                      </div>
                      <div className={`text-2xl font-bold ${supplierBalances[selectedSupplier.id].totalRemaining > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                        {supplierBalances[selectedSupplier.id].totalRemaining.toLocaleString('en-US')} افغانی
                      </div>
                    </motion.div>
                  </div>
                )}

                {/* Purchases List */}
                <div className="space-y-4">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                    {translations.purchase}
                  </h3>
                  {supplierPurchases.length > 0 ? (
                    supplierPurchases.map((purchase) => {
                      const paid = calculatePaidAmount(purchase.id);
                      const remaining = calculateRemainingAmount(purchase);
                      const payments = purchasePaymentsMap[purchase.id] || [];
                      return (
                        <motion.div
                          key={purchase.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="p-6 bg-gray-50 dark:bg-gray-700/50 rounded-2xl border border-gray-200 dark:border-gray-600"
                        >
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <div className="font-bold text-lg text-gray-900 dark:text-white mb-2">
                                {selectedSupplier.full_name} - {formatPersianDate(purchase.date)}
                              </div>
                              <div className="grid grid-cols-3 gap-4 text-sm">
                                <div>
                                  <span className="text-gray-500 dark:text-gray-400">مبلغ کل:</span>
                                  <span className="font-bold text-purple-600 dark:text-purple-400 mr-2">
                                    {purchase.total_amount.toLocaleString('en-US')} افغانی
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-500 dark:text-gray-400">پرداخت شده:</span>
                                  <span className="font-bold text-green-600 dark:text-green-400 mr-2">
                                    {paid.toLocaleString('en-US')} افغانی
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-500 dark:text-gray-400">باقیمانده:</span>
                                  <span className={`font-bold mr-2 ${remaining > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                                    {remaining.toLocaleString('en-US')} افغانی
                                  </span>
                                </div>
                              </div>
                            </div>
                            <motion.button
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handleOpenPaymentModal(purchase)}
                              className="px-4 py-2 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg text-sm font-semibold hover:shadow-lg transition-all"
                            >
                              {translations.addPayment}
                            </motion.button>
                          </div>

                          {/* Payments List */}
                          {payments.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
                              <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                                پرداخت‌ها:
                              </div>
                              <div className="space-y-2">
                                {payments.map((payment) => (
                                  <div
                                    key={payment.id}
                                    className="flex justify-between items-center p-3 bg-white dark:bg-gray-800 rounded-lg"
                                  >
                                    <div className="flex-1">
                                      <div className="flex items-center gap-3">
                                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                          {payment.amount.toLocaleString('en-US')} {payment.currency}
                                        </span>
                                        <span className="text-xs text-gray-500">× {payment.rate}</span>
                                        <span className="text-sm font-bold text-green-600 dark:text-green-400">
                                          = {payment.total.toLocaleString('en-US')} افغانی
                                        </span>
                                      </div>
                                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        {formatPersianDate(payment.date)}
                                        {payment.notes && ` • ${payment.notes}`}
                                      </div>
                                    </div>
                                    <motion.button
                                      whileHover={{ scale: 1.1 }}
                                      whileTap={{ scale: 0.9 }}
                                      onClick={() => handleDeletePayment(payment.id, purchase.id)}
                                      className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </motion.button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </motion.div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      {translations.noPurchases}
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Payment Modal */}
        <AnimatePresence>
          {isPaymentModalOpen && selectedPurchaseForPayment && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
              onClick={handleClosePaymentModal}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
              >
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                  {translations.addPayment} - {selectedSupplier?.full_name || ''}
                </h2>
                <form onSubmit={handleAddPayment} className="space-y-4">
                  <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl mb-4">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">مبلغ کل خریداری</div>
                    <div className="text-xl font-bold text-gray-900 dark:text-white">
                      {selectedPurchaseForPayment.total_amount.toLocaleString('en-US')} افغانی
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                      پرداخت شده: {calculatePaidAmount(selectedPurchaseForPayment.id).toLocaleString('en-US')} افغانی
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      باقیمانده: {calculateRemainingAmount(selectedPurchaseForPayment).toLocaleString('en-US')} افغانی
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      حساب
                    </label>
                    <select
                      value={paymentFormData.account_id}
                      onChange={(e) => setPaymentFormData({ ...paymentFormData, account_id: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                      dir="rtl"
                    >
                      <option value="">انتخاب حساب (اختیاری)</option>
                      {accounts.filter(acc => acc.is_active).map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        {translations.paymentAmount}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={paymentFormData.amount}
                        onChange={(e) => setPaymentFormData({ ...paymentFormData, amount: e.target.value })}
                        required
                        className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                        placeholder="مبلغ"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        {translations.paymentCurrency}
                      </label>
                      <select
                        value={paymentFormData.currency}
                        onChange={(e) => setPaymentFormData({ ...paymentFormData, currency: e.target.value })}
                        required
                        className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                        dir="rtl"
                      >
                        <option value="">انتخاب ارز</option>
                        {currencies.map((currency) => (
                          <option key={currency.id} value={currency.name}>
                            {currency.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        {translations.paymentRate}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={paymentFormData.rate}
                        onChange={(e) => setPaymentFormData({ ...paymentFormData, rate: e.target.value })}
                        required
                        className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                        placeholder="نرخ"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        {translations.paymentTotal}
                      </label>
                      <input
                        type="text"
                        value={paymentFormData.total}
                        readOnly
                        className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white"
                        dir="ltr"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {translations.paymentDate}
                    </label>
                    <PersianDatePicker
                      value={paymentFormData.date}
                      onChange={(date) => setPaymentFormData({ ...paymentFormData, date })}
                      placeholder="تاریخ را انتخاب کنید"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {translations.paymentNotes}
                    </label>
                    <textarea
                      value={paymentFormData.notes}
                      onChange={(e) => setPaymentFormData({ ...paymentFormData, notes: e.target.value })}
                      rows={3}
                      className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200 resize-none"
                      placeholder="یادداشت (اختیاری)"
                      dir="rtl"
                    />
                  </div>
                  <div className="flex gap-3 pt-4">
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={handleClosePaymentModal}
                      className="flex-1 px-4 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-bold rounded-xl transition-colors"
                    >
                      {translations.cancel}
                    </motion.button>
                    <motion.button
                      type="submit"
                      disabled={loading}
                      whileHover={{ scale: loading ? 1 : 1.05 }}
                      whileTap={{ scale: loading ? 1 : 0.95 }}
                      className="flex-1 px-4 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? (
                        <span className="flex items-center justify-center gap-2">
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                          />
                          {translations.save}
                        </span>
                      ) : (
                        translations.addPayment
                      )}
                    </motion.button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <Footer />
      </div>
    </div>
  );
}

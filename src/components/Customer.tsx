import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
  initCustomersTable,
  createCustomer,
  getCustomers,
  updateCustomer,
  deleteCustomer,
  type Customer,
} from "../utils/customer";
import { getSales, type Sale } from "../utils/sales";
import {
  getSalePayments,
  createSalePayment,
  deleteSalePayment,
  type SalePayment,
} from "../utils/sales";
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
  title: "مشتری ها",
  addNew: "افزودن مشتری جدید",
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
  totalSales: "مجموع فروش‌ها",
  totalPaid: "مجموع پرداخت شده",
  totalRemaining: "مجموع باقیمانده",
  viewBalance: "مشاهده بیلانس",
  viewDetailPage: "صفحه مشتری",
  balance: "بیلانس",
  sale: "فروش",
  saleDate: "تاریخ فروش",
  saleTotal: "مبلغ کل",
  paidAmount: "پرداخت شده",
  remainingAmount: "باقیمانده",
  addPayment: "افزودن پرداخت",
  paymentAmount: "مبلغ پرداخت",
  paymentDate: "تاریخ پرداخت",
  noPayments: "هیچ پرداختی ثبت نشده است",
  noSales: "هیچ فروشی ثبت نشده است",
  noCustomers: "هیچ مشتری‌ای ثبت نشده است",
  confirmDelete: "آیا از حذف این مشتری اطمینان دارید؟",
  backToDashboard: "بازگشت به داشبورد",
  success: {
    created: "مشتری با موفقیت ایجاد شد",
    updated: "مشتری با موفقیت بروزرسانی شد",
    deleted: "مشتری با موفقیت حذف شد",
    tableInit: "جدول مشتری‌ها با موفقیت ایجاد شد",
  },
  errors: {
    create: "خطا در ایجاد مشتری",
    update: "خطا در بروزرسانی مشتری",
    delete: "خطا در حذف مشتری",
    fetch: "خطا در دریافت مشتری‌ها",
    nameRequired: "نام کامل الزامی است",
    phoneRequired: "شماره تماس الزامی است",
    addressRequired: "آدرس الزامی است",
  },
  placeholders: {
    fullName: "نام کامل مشتری را وارد کنید",
    phone: "شماره تماس را وارد کنید",
    address: "آدرس را وارد کنید",
    email: "ایمیل را وارد کنید (اختیاری)",
    notes: "یادداشت‌ها را وارد کنید (اختیاری)",
  },
};

interface CustomerManagementProps {
  onBack?: () => void;
  onNavigateToBalancePage?: () => void;
  onNavigateToDetail?: (customerId: number) => void;
}

export default function CustomerManagement({ onBack, onNavigateToBalancePage, onNavigateToDetail }: CustomerManagementProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerBalances, setCustomerBalances] = useState<Record<number, { totalSales: number; totalPaid: number; totalRemaining: number }>>({});
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBalanceModalOpen, setIsBalanceModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSales, setCustomerSales] = useState<Sale[]>([]);
  const [salePaymentsMap, setSalePaymentsMap] = useState<Record<number, SalePayment[]>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState({
    full_name: "",
    phone: "",
    address: "",
    email: "",
    notes: "",
  });
  const [paymentFormData, setPaymentFormData] = useState({
    account_id: "",
    amount: "",
    date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
  });
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedSaleForPayment, setSelectedSaleForPayment] = useState<Sale | null>(null);
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
      const saved = localStorage.getItem("customerViewMode");
      return (saved === "thumbnail" ? "thumbnail" : "table") as ViewMode;
    } catch { return "table"; }
  });
  useEffect(() => {
    try { localStorage.setItem("customerViewMode", viewMode); } catch { /* ignore */ }
  }, [viewMode]);

  useEffect(() => {
    loadCustomers();
  }, [page, perPage, search, sortBy, sortOrder]);

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const dbOpen = await isDatabaseOpen();
      if (!dbOpen) {
        await openDatabase("db");
      }

      try {
        await initCustomersTable();
      } catch (err) {
        console.log("Table initialization:", err);
      }

      const response = await getCustomers(page, perPage, search, sortBy, sortOrder);
      setCustomers(response.items);
      setTotalItems(response.total);

      // Load all sales to calculate balances
      const allSales = await getSales(1, 10000, "", "date", "desc");
      
      // Calculate balances for each customer
      const balances: Record<number, { totalSales: number; totalPaid: number; totalRemaining: number }> = {};
      
      await Promise.all(
        response.items.map(async (customer) => {
          const customerSalesList = allSales.items.filter(s => s.customer_id === customer.id);
          let totalSales = 0;
          let totalPaid = 0;

          for (const sale of customerSalesList) {
            totalSales += sale.total_amount;
            totalPaid += sale.paid_amount || 0;
          }

          balances[customer.id] = {
            totalSales,
            totalPaid,
            totalRemaining: totalSales - totalPaid,
          };
        })
      );

      setCustomerBalances(balances);
    } catch (error: any) {
      toast.error(translations.errors.fetch);
      console.error("Error loading customers:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (customer?: Customer) => {
    if (customer) {
      setEditingCustomer(customer);
      setFormData({
        full_name: customer.full_name,
        phone: customer.phone,
        address: customer.address,
        email: customer.email || "",
        notes: customer.notes || "",
      });
    } else {
      setEditingCustomer(null);
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
    setEditingCustomer(null);
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
      if (editingCustomer) {
        await updateCustomer(
          editingCustomer.id,
          formData.full_name,
          formData.phone,
          formData.address,
          formData.email || null,
          formData.notes || null
        );
        toast.success(translations.success.updated);
      } else {
        await createCustomer(
          formData.full_name,
          formData.phone,
          formData.address,
          formData.email || null,
          formData.notes || null
        );
        toast.success(translations.success.created);
      }
      handleCloseModal();
      await loadCustomers();
    } catch (error: any) {
      toast.error(editingCustomer ? translations.errors.update : translations.errors.create);
      console.error("Error saving customer:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      setLoading(true);
      await deleteCustomer(id);
      toast.success(translations.success.deleted);
      setDeleteConfirm(null);
      await loadCustomers();
    } catch (error: any) {
      toast.error(translations.errors.delete);
      console.error("Error deleting customer:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenBalanceModal = async (customer: Customer) => {
    setSelectedCustomer(customer);
    setIsBalanceModalOpen(true);
    
    try {
      setLoading(true);
      // Load all sales for this customer and accounts
      const [allSalesResponse, accountsData] = await Promise.all([
        getSales(1, 10000, "", "date", "desc"),
        getAccounts(),
      ]);
      const customerSalesList = allSalesResponse.items.filter(s => s.customer_id === customer.id);
      setCustomerSales(customerSalesList);
      setAccounts(accountsData);

      // Load payments for each sale
      const paymentsMap: Record<number, SalePayment[]> = {};
      await Promise.all(
        customerSalesList.map(async (sale) => {
          try {
            const payments = await getSalePayments(sale.id);
            paymentsMap[sale.id] = payments;
          } catch (error) {
            paymentsMap[sale.id] = [];
          }
        })
      );
      setSalePaymentsMap(paymentsMap);
    } catch (error: any) {
      toast.error("خطا در بارگذاری اطلاعات بیلانس");
      console.error("Error loading balance:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCloseBalanceModal = () => {
    setIsBalanceModalOpen(false);
    setSelectedCustomer(null);
    setCustomerSales([]);
    setSalePaymentsMap({});
  };

  const calculatePaidAmount = (saleId: number): number => {
    const payments = salePaymentsMap[saleId] || [];
    return payments.reduce((sum, payment) => sum + payment.amount, 0);
  };

  const calculateRemainingAmount = (sale: Sale): number => {
    const paid = calculatePaidAmount(sale.id);
    return sale.total_amount - paid;
  };

  const handleOpenPaymentModal = (sale: Sale) => {
    setSelectedSaleForPayment(sale);
    setPaymentFormData({
      account_id: "",
      amount: "",
      date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
    });
    setIsPaymentModalOpen(true);
  };

  const handleClosePaymentModal = () => {
    setIsPaymentModalOpen(false);
    setSelectedSaleForPayment(null);
    setPaymentFormData({
      account_id: "",
      amount: "",
      date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
    });
  };

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSaleForPayment) return;

    if (!paymentFormData.amount || parseFloat(paymentFormData.amount) <= 0) {
      toast.error("مبلغ پرداخت باید بیشتر از صفر باشد");
      return;
    }

    try {
      setLoading(true);
      const amount = parseFloat(paymentFormData.amount);
      const account_id = paymentFormData.account_id ? parseInt(paymentFormData.account_id) : null;
      await createSalePayment(
        selectedSaleForPayment.id,
        account_id,
        selectedSaleForPayment.currency_id, // currency_id
        selectedSaleForPayment.exchange_rate || 1, // exchange_rate
        amount,
        paymentFormData.date
      );
      toast.success("پرداخت با موفقیت ثبت شد");
      handleClosePaymentModal();
      // Reload balance data
      if (selectedCustomer) {
        await handleOpenBalanceModal(selectedCustomer);
      }
      await loadCustomers();
    } catch (error: any) {
      toast.error("خطا در ثبت پرداخت");
      console.error("Error adding payment:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePayment = async (paymentId: number, _saleId: number) => {
    try {
      setLoading(true);
      await deleteSalePayment(paymentId);
      toast.success("پرداخت با موفقیت حذف شد");
      // Reload balance data
      if (selectedCustomer) {
        await handleOpenBalanceModal(selectedCustomer);
      }
      await loadCustomers();
    } catch (error: any) {
      toast.error("خطا در حذف پرداخت");
      console.error("Error deleting payment:", error);
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      key: "full_name", label: translations.fullName, sortable: true,
      render: (c: Customer) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center text-white font-bold text-xs">
            {c.full_name.charAt(0)}
          </div>
          <span className="font-medium text-gray-900 dark:text-white">{c.full_name}</span>
        </div>
      )
    },
    {
      key: "phone", label: translations.phone, sortable: true,
      render: (c: Customer) => (
        <span className="font-mono text-gray-700 dark:text-gray-300" dir="ltr">{c.phone}</span>
      )
    },
    {
      key: "address", label: translations.address, sortable: false,
      render: (c: Customer) => (
        <span className="text-gray-600 dark:text-gray-400 text-sm truncate max-w-xs block" title={c.address}>
          {c.address}
        </span>
      )
    },
    {
      key: "email", label: translations.email, sortable: true,
      render: (c: Customer) => c.email ? (
        <span className="text-gray-600 dark:text-gray-400 text-sm" dir="ltr">{c.email}</span>
      ) : <span className="text-gray-400">-</span>
    },
    {
      key: "totalSales", label: translations.totalSales, sortable: false,
      render: (c: Customer) => {
        const balance = customerBalances[c.id];
        return (
          <span className="text-lg font-bold text-purple-600 dark:text-purple-400">
            {balance ? balance.totalSales.toLocaleString('en-US') : '0'} افغانی
          </span>
        );
      }
    },
    {
      key: "totalPaid", label: translations.totalPaid, sortable: false,
      render: (c: Customer) => {
        const balance = customerBalances[c.id];
        return (
          <span className="text-lg font-bold text-green-600 dark:text-green-400">
            {balance ? balance.totalPaid.toLocaleString('en-US') : '0'} افغانی
          </span>
        );
      }
    },
    {
      key: "totalRemaining", label: translations.totalRemaining, sortable: false,
      render: (c: Customer) => {
        const balance = customerBalances[c.id];
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
      render: (c: Customer) => (
        <span className="text-gray-600 dark:text-gray-400 text-sm">
          {new Date(c.created_at).toLocaleDateString('fa-IR')}
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
                    label: "بیلانس مشتریان",
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
            data={customers}
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
            actions={(customer) => (
              <div className="flex items-center gap-2">
                {onNavigateToDetail && (
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => onNavigateToDetail(customer.id)}
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
                  onClick={() => handleOpenBalanceModal(customer)}
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
                  onClick={() => handleOpenModal(customer)}
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
                  onClick={() => setDeleteConfirm(customer.id)}
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
            data={customers}
            total={totalItems}
            page={page}
            perPage={perPage}
            onPageChange={setPage}
            onPerPageChange={setPerPage}
            loading={loading}
            renderCard={(c) => {
              const balance = customerBalances[c.id];
              return (
                <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800/80 p-4 shadow-lg hover:shadow-xl hover:border-purple-300 dark:hover:border-purple-600 transition-all h-full flex flex-col">
                  <div className="flex justify-center mb-3">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-md">
                      {c.full_name.charAt(0)}
                    </div>
                  </div>
                  <div className="font-bold text-gray-900 dark:text-white text-center mb-1 truncate" title={c.full_name}>{c.full_name}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 text-center font-mono" dir="ltr">{c.phone}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-500 text-center truncate mb-2" title={c.address}>{c.address}</div>
                  {balance != null && (
                    <div className="text-xs text-center mb-2">
                      <span className="text-purple-600 dark:text-purple-400 font-semibold">باقیمانده: </span>
                      <span>{balance.totalRemaining.toLocaleString("en-US")} افغانی</span>
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-1.5 mt-auto pt-2">
                    {onNavigateToDetail && (
                      <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => onNavigateToDetail(c.id)} className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg" title={translations.viewDetailPage}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg></motion.button>
                    )}
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => handleOpenBalanceModal(c)} className="p-2 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg" title={translations.viewBalance}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></motion.button>
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => handleOpenModal(c)} className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg" title={translations.edit}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></motion.button>
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setDeleteConfirm(c.id)} className="p-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg" title={translations.delete}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></motion.button>
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
                  {editingCustomer ? translations.edit : translations.addNew}
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
          {isBalanceModalOpen && selectedCustomer && (
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
                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-6xl max-h-[90vh] overflow-y-auto border border-blue-100 dark:border-blue-900/30"
              >
                {/* Header */}
                <div className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
                      <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                        {translations.balance} - {selectedCustomer.full_name}
                      </h2>
                      {selectedCustomer.phone && (
                        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1" dir="ltr">
                          {translations.phone}: {selectedCustomer.phone}
                        </p>
                      )}
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                        مشاهده فروش‌ها و پرداخت‌های مشتری
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
                {customerBalances[selectedCustomer.id] && (
                  <div className="grid grid-cols-3 gap-4 mb-8">
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      className="p-5 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-2xl border border-purple-200/50 dark:border-purple-700/30">
                      <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                        {translations.totalSales}
                      </div>
                      <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                        {customerBalances[selectedCustomer.id].totalSales.toLocaleString('en-US')} افغانی
                      </div>
                    </motion.div>
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      className="p-5 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-2xl border border-green-200/50 dark:border-green-700/30">
                      <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                        {translations.totalPaid}
                      </div>
                      <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {customerBalances[selectedCustomer.id].totalPaid.toLocaleString('en-US')} افغانی
                      </div>
                    </motion.div>
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      className="p-5 bg-gradient-to-br from-red-50 to-pink-50 dark:from-red-900/20 dark:to-pink-900/20 rounded-2xl border border-red-200/50 dark:border-red-700/30">
                      <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                        {translations.totalRemaining}
                      </div>
                      <div className={`text-2xl font-bold ${customerBalances[selectedCustomer.id].totalRemaining > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                        {customerBalances[selectedCustomer.id].totalRemaining.toLocaleString('en-US')} افغانی
                      </div>
                    </motion.div>
                  </div>
                )}

                {/* Sales List */}
                <div className="space-y-4">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                    {translations.sale}
                  </h3>
                  {customerSales.length > 0 ? (
                    customerSales.map((sale) => {
                      const paid = calculatePaidAmount(sale.id);
                      const remaining = calculateRemainingAmount(sale);
                      const payments = salePaymentsMap[sale.id] || [];
                      return (
                        <motion.div
                          key={sale.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="p-6 bg-gray-50 dark:bg-gray-700/50 rounded-2xl border border-gray-200 dark:border-gray-600"
                        >
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <div className="font-bold text-lg text-gray-900 dark:text-white mb-2">
                                فروش #{sale.id} - {formatPersianDate(sale.date)}
                              </div>
                              <div className="grid grid-cols-3 gap-4 text-sm">
                                <div>
                                  <span className="text-gray-500 dark:text-gray-400">مبلغ کل:</span>
                                  <span className="font-bold text-purple-600 dark:text-purple-400 mr-2">
                                    {sale.total_amount.toLocaleString('en-US')} افغانی
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
                              onClick={() => handleOpenPaymentModal(sale)}
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
                                          {payment.amount.toLocaleString('en-US')} افغانی
                                        </span>
                                      </div>
                                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        {formatPersianDate(payment.date)}
                                      </div>
                                    </div>
                                    <motion.button
                                      whileHover={{ scale: 1.1 }}
                                      whileTap={{ scale: 0.9 }}
                                      onClick={() => handleDeletePayment(payment.id, sale.id)}
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
                      {translations.noSales}
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Payment Modal */}
        <AnimatePresence>
          {isPaymentModalOpen && selectedSaleForPayment && (
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
                  {translations.addPayment} - فروش #{selectedSaleForPayment.id}
                </h2>
                <form onSubmit={handleAddPayment} className="space-y-4">
                  <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl mb-4">
                    <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">مبلغ کل فروش</div>
                    <div className="text-xl font-bold text-gray-900 dark:text-white">
                      {selectedSaleForPayment.total_amount.toLocaleString('en-US')} افغانی
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                      پرداخت شده: {calculatePaidAmount(selectedSaleForPayment.id).toLocaleString('en-US')} افغانی
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      باقیمانده: {calculateRemainingAmount(selectedSaleForPayment).toLocaleString('en-US')} افغانی
                    </div>
                  </div>
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

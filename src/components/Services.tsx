import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
    initServicesTable,
    createService,
    createServicePayment,
    getServices,
    getService,
    updateService,
    deleteService,
    getServicePayments,
    type Service,
    type ServiceItem,
    type ServiceItemInput,
    type ServicePayment,
} from "../utils/service";
import { getCustomers, type Customer } from "../utils/customer";
import { getCurrencies, type Currency } from "../utils/currency";
import { getAccounts, type Account } from "../utils/account";
import { isDatabaseOpen, openDatabase } from "../utils/db";
import Footer from "./Footer";
import PersianDatePicker from "./PersianDatePicker";
import { formatPersianDate, getCurrentPersianDate, persianToGeorgian } from "../utils/date";
import Table from "./common/Table";
import PageHeader from "./common/PageHeader";
import { Search } from "lucide-react";

const translations = {
    title: "مدیریت خدمات",
    addNew: "ثبت خدمت جدید",
    edit: "ویرایش",
    delete: "حذف",
    cancel: "لغو",
    save: "ذخیره",
    customer: "مشتری",
    date: "تاریخ",
    notes: "یادداشت",
    items: "آیتم‌ها",
    addItem: "افزودن آیتم",
    removeItem: "حذف",
    itemName: "نام آیتم",
    price: "قیمت",
    quantity: "مقدار",
    total: "جمع کل",
    totalAmount: "مبلغ کل",
    paidAmount: "پرداخت شده",
    remainingAmount: "باقی مانده",
    noServices: "هیچ خدمتی ثبت نشده است",
    confirmDelete: "آیا از حذف این خدمت اطمینان دارید؟",
    backToDashboard: "بازگشت به داشبورد",
    success: {
        created: "خدمت با موفقیت ثبت شد",
        updated: "خدمت با موفقیت بروزرسانی شد",
        deleted: "خدمت با موفقیت حذف شد",
    },
    errors: {
        create: "خطا در ثبت خدمت",
        update: "خطا در بروزرسانی خدمت",
        delete: "خطا در حذف خدمت",
        fetch: "خطا در دریافت لیست خدمات",
        customerRequired: "انتخاب مشتری الزامی است",
        dateRequired: "تاریخ الزامی است",
        itemsRequired: "حداقل یک آیتم الزامی است",
    },
    placeholders: {
        date: "تاریخ را انتخاب کنید",
        notes: "یادداشت‌ها (اختیاری)",
        itemName: "نام آیتم یا توضیحات",
        price: "قیمت",
        quantity: "۱",
    },
    payments: {
        title: "پرداخت‌ها",
        noPayments: "هیچ پرداختی ثبت نشده است",
        amount: "مبلغ",
        date: "تاریخ",
        addPayment: "ثبت پرداخت",
        service: "خدمت",
        accountOptional: "حساب (برای واریز)",
        serviceRequired: "انتخاب خدمت الزامی است",
        amountRequired: "مقدار الزامی است",
        dateRequired: "تاریخ الزامی است",
        paymentCreated: "پرداخت با موفقیت ثبت شد",
        paymentError: "خطا در ثبت پرداخت",
    },
    placeholdersPayment: {
        service: "خدمت را انتخاب کنید",
        amount: "مقدار را وارد کنید",
        account: "حساب برای واریز (اختیاری)",
    },
};

interface ServicesManagementProps {
    onBack?: () => void;
}

export default function ServicesManagement({ onBack }: ServicesManagementProps) {
    const [services, setServices] = useState<Service[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [baseCurrency, setBaseCurrency] = useState<Currency | null>(null);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [viewingService, setViewingService] = useState<{
        service: Service;
        items: ServiceItem[];
        payments: ServicePayment[];
    } | null>(null);
    const [editingService, setEditingService] = useState<Service | null>(null);
    const [formData, setFormData] = useState({
        customer_id: 0,
        date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split("T")[0],
        currency_id: "",
        exchange_rate: 1,
        notes: "",
        paid_amount: 0,
        items: [] as ServiceItemInput[],
    });
    const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [paymentFormData, setPaymentFormData] = useState({
        service_id: "",
        amount: "",
        date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split("T")[0],
        account_id: "",
    });
    const [accounts, setAccounts] = useState<Account[]>([]);

    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(10);
    const [totalItems, setTotalItems] = useState(0);
    const [search, setSearch] = useState("");
    const [sortBy, setSortBy] = useState("date");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    useEffect(() => {
        loadData();
    }, [page, perPage, search, sortBy, sortOrder]);

    const loadData = async () => {
        try {
            setLoading(true);
            const dbOpen = await isDatabaseOpen();
            if (!dbOpen) {
                await openDatabase("db");
            }
            try {
                await initServicesTable();
            } catch (err) {
                console.log("Table initialization:", err);
            }
            const [servicesResponse, customersResponse, currenciesData, accountsData] = await Promise.all([
                getServices(page, perPage, search, sortBy, sortOrder),
                getCustomers(1, 1000),
                getCurrencies(),
                getAccounts(),
            ]);
            setServices(servicesResponse.items);
            setTotalItems(servicesResponse.total);
            setCustomers(customersResponse.items);
            setCurrencies(currenciesData);
            setAccounts(accountsData || []);
            const base = currenciesData.find((c) => c.base);
            if (base) setBaseCurrency(base);
        } catch (error: unknown) {
            toast.error(translations.errors.fetch);
            console.error("Error loading data:", error);
        } finally {
            setLoading(false);
        }
    };

    const loadServiceDetails = async (id: number) => {
        try {
            const [service, items] = await getService(id);
            setEditingService(service);
            setFormData({
                customer_id: service.customer_id,
                date: service.date,
                currency_id: service.currency_id ? service.currency_id.toString() : baseCurrency?.id.toString() || "",
                exchange_rate: service.exchange_rate || 1,
                notes: service.notes || "",
                paid_amount: service.paid_amount,
                items: items.map((item) => ({
                    name: item.name,
                    price: item.price,
                    quantity: item.quantity,
                })),
            });
        } catch (error: unknown) {
            toast.error("خطا در دریافت جزئیات خدمت");
            console.error("Error loading service details:", error);
        }
    };

    const handleOpenModal = async (service?: Service) => {
        if (service) {
            await loadServiceDetails(service.id);
        } else {
            setEditingService(null);
            setFormData({
                customer_id: 0,
                date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split("T")[0],
                currency_id: baseCurrency?.id.toString() || "",
                exchange_rate: 1,
                notes: "",
                paid_amount: 0,
                items: [],
            });
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingService(null);
        setFormData({
            customer_id: 0,
            date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split("T")[0],
            currency_id: baseCurrency?.id.toString() || "",
            exchange_rate: 1,
            notes: "",
            paid_amount: 0,
            items: [],
        });
    };

    const addItem = () => {
        setFormData({
            ...formData,
            items: [...formData.items, { name: "", price: 0, quantity: 1 }],
        });
    };

    const removeItem = (index: number) => {
        setFormData({
            ...formData,
            items: formData.items.filter((_, i) => i !== index),
        });
    };

    const updateItem = (index: number, field: keyof ServiceItemInput, value: string | number) => {
        const newItems = [...formData.items];
        newItems[index] = { ...newItems[index], [field]: value };
        setFormData({ ...formData, items: newItems });
    };

    const calculateItemTotal = (item: ServiceItemInput) => item.price * item.quantity;
    const calculateTotal = () => formData.items.reduce((sum, item) => sum + calculateItemTotal(item), 0);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.customer_id) {
            toast.error(translations.errors.customerRequired);
            return;
        }
        if (!formData.date) {
            toast.error(translations.errors.dateRequired);
            return;
        }
        if (formData.items.length === 0) {
            toast.error(translations.errors.itemsRequired);
            return;
        }
        const validItems = formData.items.filter(
            (i) => (i.name?.trim() ?? "") !== "" && (i.price ?? 0) > 0 && (i.quantity ?? 1) > 0
        );
        if (validItems.length === 0) {
            toast.error(translations.errors.itemsRequired);
            return;
        }
        for (let i = 0; i < validItems.length; i++) {
            const item = validItems[i];
            if (!item.name?.trim() || (item.price ?? 0) <= 0 || (item.quantity ?? 1) <= 0) {
                toast.error(`آیتم ${i + 1} ناقص است`);
                return;
            }
        }
        try {
            setLoading(true);
            const currencyId = formData.currency_id ? parseInt(formData.currency_id, 10) : null;
            const exchangeRate = parseFloat(String(formData.exchange_rate)) || 1;
            const paidAmount = parseFloat(String(formData.paid_amount)) || 0;
            const itemsToSend = validItems.map((i) => ({
                name: i.name.trim(),
                price: i.price ?? 0,
                quantity: i.quantity ?? 1,
            }));
            if (editingService) {
                await updateService(
                    editingService.id,
                    formData.customer_id,
                    formData.date,
                    formData.notes || null,
                    currencyId,
                    exchangeRate,
                    paidAmount,
                    itemsToSend
                );
                toast.success(translations.success.updated);
            } else {
                await createService(
                    formData.customer_id,
                    formData.date,
                    formData.notes || null,
                    currencyId,
                    exchangeRate,
                    paidAmount,
                    itemsToSend
                );
                toast.success(translations.success.created);
            }
            handleCloseModal();
            await loadData();
        } catch (error: unknown) {
            toast.error(editingService ? translations.errors.update : translations.errors.create);
            console.error("Error saving service:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: number) => {
        try {
            setLoading(true);
            await deleteService(id);
            toast.success(translations.success.deleted);
            setDeleteConfirm(null);
            await loadData();
        } catch (error: unknown) {
            toast.error(translations.errors.delete);
            console.error("Error deleting service:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleViewService = async (service: Service) => {
        try {
            const [srv, items] = await getService(service.id);
            const payments = await getServicePayments(service.id);
            setViewingService({ service: srv, items, payments });
            setIsViewModalOpen(true);
        } catch (error: unknown) {
            toast.error("خطا در دریافت جزئیات خدمت");
            console.error("Error loading service details:", error);
        }
    };

    const openPaymentModal = (presetServiceId?: number) => {
        setPaymentFormData({
            service_id: presetServiceId ? String(presetServiceId) : "",
            amount: "",
            date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split("T")[0],
            account_id: "",
        });
        setIsPaymentModalOpen(true);
    };

    const handleClosePaymentModal = () => {
        setIsPaymentModalOpen(false);
        setPaymentFormData({
            service_id: "",
            amount: "",
            date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split("T")[0],
            account_id: "",
        });
    };

    const handlePaymentSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!paymentFormData.service_id) {
            toast.error(translations.payments.serviceRequired);
            return;
        }
        if (!paymentFormData.amount || parseFloat(paymentFormData.amount) <= 0) {
            toast.error(translations.payments.amountRequired);
            return;
        }
        if (!paymentFormData.date) {
            toast.error(translations.payments.dateRequired);
            return;
        }
        const service_id = parseInt(paymentFormData.service_id, 10);
        const service =
            viewingService?.service.id === service_id
                ? viewingService.service
                : services.find((s) => s.id === service_id);
        const amount = parseFloat(paymentFormData.amount);
        try {
            setLoading(true);
            await createServicePayment(
                service_id,
                paymentFormData.account_id ? parseInt(paymentFormData.account_id, 10) : null,
                service?.currency_id ?? null,
                service?.exchange_rate ?? 1,
                amount,
                paymentFormData.date
            );
            toast.success(translations.payments.paymentCreated);
            handleClosePaymentModal();
            await loadData();
            if (viewingService && viewingService.service.id === service_id) {
                const [srv, items] = await getService(service_id);
                const payments = await getServicePayments(service_id);
                setViewingService({ service: srv, items, payments });
            }
        } catch (error: unknown) {
            toast.error(translations.payments.paymentError);
            console.error("Error saving payment:", error);
        } finally {
            setLoading(false);
        }
    };

    const getCustomerName = (customerId: number) =>
        customers.find((c) => c.id === customerId)?.full_name || `ID: ${customerId}`;

    const columns = [
        {
            key: "id",
            label: "شماره",
            sortable: false,
            render: (s: Service) => (
                <span className="font-mono text-gray-700 dark:text-gray-300">#{s.id}</span>
            ),
        },
        {
            key: "customer_id",
            label: translations.customer,
            sortable: false,
            render: (s: Service) => (
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center text-white font-bold text-xs">
                        {getCustomerName(s.customer_id).charAt(0)}
                    </div>
                    <span className="font-medium text-gray-900 dark:text-white">{getCustomerName(s.customer_id)}</span>
                </div>
            ),
        },
        {
            key: "date",
            label: translations.date,
            sortable: true,
            render: (s: Service) => (
                <span className="text-gray-700 dark:text-gray-300">{formatPersianDate(s.date)}</span>
            ),
        },
        {
            key: "total_amount",
            label: translations.totalAmount,
            sortable: true,
            render: (s: Service) => {
                const currency = currencies.find((c) => c.id === s.currency_id);
                return (
                    <div>
                        <span className="font-bold text-purple-700 dark:text-purple-300">
                            {s.total_amount.toLocaleString("en-US")} {currency?.name || ""}
                        </span>
                        {s.base_amount !== s.total_amount && (
                            <div className="text-xs text-gray-500">
                                ({s.base_amount.toLocaleString("en-US")} پایه)
                            </div>
                        )}
                    </div>
                );
            },
        },
        {
            key: "paid_amount",
            label: translations.paidAmount,
            sortable: true,
            render: (s: Service) => {
                const currency = currencies.find((c) => c.id === s.currency_id);
                return (
                    <span className="font-bold text-green-700 dark:text-green-300">
                        {s.paid_amount.toLocaleString("en-US")} {currency?.name || ""}
                    </span>
                );
            },
        },
        {
            key: "remaining",
            label: translations.remainingAmount,
            sortable: false,
            render: (s: Service) => {
                const remaining = s.total_amount - s.paid_amount;
                return (
                    <span
                        className={`font-bold ${remaining > 0 ? "text-red-700 dark:text-red-300" : "text-gray-500"}`}
                    >
                        {remaining.toLocaleString("en-US")} افغانی
                    </span>
                );
            },
        },
    ];

    return (
        <div
            className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-6"
            dir="rtl"
        >
            <div className="max-w-7xl mx-auto">
                <PageHeader
                    title={translations.title}
                    onBack={onBack}
                    backLabel={translations.backToDashboard}
                    actions={[
                        {
                            label: translations.payments.addPayment,
                            onClick: () => openPaymentModal(),
                            variant: "secondary" as const,
                        },
                        {
                            label: translations.addNew,
                            onClick: () => handleOpenModal(),
                            variant: "primary" as const,
                        },
                    ]}
                />

                <div className="relative max-w-md w-full mb-6">
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
                        placeholder="جستجو بر اساس تاریخ، مشتری یا یادداشت..."
                    />
                </div>

                <Table
                    data={services}
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
                    actions={(s) => (
                        <div className="flex items-center gap-2">
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleViewService(s)}
                                className="p-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
                                title="مشاهده"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                            </motion.button>
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleOpenModal(s)}
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
                                onClick={() => setDeleteConfirm(s.id)}
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

                {/* Add/Edit Modal */}
                <AnimatePresence>
                    {isModalOpen && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto"
                            onClick={handleCloseModal}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-4xl max-h-[90vh] overflow-y-auto my-8"
                            >
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                                    {editingService ? translations.edit : translations.addNew}
                                </h2>
                                <form onSubmit={handleSubmit} className="space-y-6">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.customer} <span className="text-red-500">*</span>
                                            </label>
                                            <select
                                                value={formData.customer_id}
                                                onChange={(e) =>
                                                    setFormData({ ...formData, customer_id: parseInt(e.target.value, 10) })
                                                }
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                dir="rtl"
                                            >
                                                <option value={0}>انتخاب مشتری</option>
                                                {customers.map((c) => (
                                                    <option key={c.id} value={c.id}>
                                                        {c.full_name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.date} <span className="text-red-500">*</span>
                                            </label>
                                            <PersianDatePicker
                                                value={formData.date}
                                                onChange={(date) => setFormData({ ...formData, date })}
                                                placeholder={translations.placeholders.date}
                                                required
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                ارز
                                            </label>
                                            <select
                                                value={formData.currency_id}
                                                onChange={(e) => {
                                                    const selectedCurrencyId = e.target.value;
                                                    const selectedCurrency = currencies.find(
                                                        (c) => c.id.toString() === selectedCurrencyId
                                                    );
                                                    setFormData({
                                                        ...formData,
                                                        currency_id: selectedCurrencyId,
                                                        exchange_rate: selectedCurrency ? selectedCurrency.rate ?? 1 : 1,
                                                    });
                                                }}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                dir="rtl"
                                            >
                                                <option value="">انتخاب ارز</option>
                                                {currencies.map((c) => (
                                                    <option key={c.id} value={c.id}>
                                                        {c.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                نرخ تبدیل
                                            </label>
                                            <input
                                                type="number"
                                                step="0.0001"
                                                min="0"
                                                value={formData.exchange_rate}
                                                onChange={(e) =>
                                                    setFormData({
                                                        ...formData,
                                                        exchange_rate: parseFloat(e.target.value) || 1,
                                                    })
                                                }
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder="1.0"
                                                dir="ltr"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.notes}
                                        </label>
                                        <textarea
                                            value={formData.notes}
                                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                            rows={3}
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200 resize-none"
                                            placeholder={translations.placeholders.notes}
                                            dir="rtl"
                                        />
                                    </div>
                                    <div>
                                        <div className="flex justify-between items-center mb-4">
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                                                {translations.items} <span className="text-red-500">*</span>
                                            </label>
                                            <motion.button
                                                type="button"
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                onClick={addItem}
                                                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-sm"
                                            >
                                                {translations.addItem}
                                            </motion.button>
                                        </div>
                                        <div className="space-y-3 max-h-80 overflow-y-auto">
                                            {formData.items.map((item, index) => (
                                                <motion.div
                                                    key={index}
                                                    initial={{ opacity: 0, y: -10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl border-2 border-gray-200 dark:border-gray-600"
                                                >
                                                    <div className="grid grid-cols-12 gap-3 items-end">
                                                        <div className="col-span-4">
                                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                {translations.itemName}
                                                            </label>
                                                            <input
                                                                type="text"
                                                                value={item.name}
                                                                onChange={(e) => updateItem(index, "name", e.target.value)}
                                                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                                placeholder={translations.placeholders.itemName}
                                                                dir="rtl"
                                                            />
                                                        </div>
                                                        <div className="col-span-2">
                                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                {translations.price}
                                                            </label>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                value={item.price || ""}
                                                                onChange={(e) =>
                                                                    updateItem(index, "price", parseFloat(e.target.value) || 0)
                                                                }
                                                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                                placeholder={translations.placeholders.price}
                                                                dir="ltr"
                                                            />
                                                        </div>
                                                        <div className="col-span-2">
                                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                {translations.quantity}
                                                            </label>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                min="0.01"
                                                                value={item.quantity || ""}
                                                                onChange={(e) =>
                                                                    updateItem(index, "quantity", parseFloat(e.target.value) || 1)
                                                                }
                                                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                                placeholder={translations.placeholders.quantity}
                                                                dir="ltr"
                                                            />
                                                        </div>
                                                        <div className="col-span-2 flex items-center">
                                                            <span className="text-sm font-bold text-purple-600 dark:text-purple-400">
                                                                {calculateItemTotal(item).toLocaleString("en-US")}
                                                            </span>
                                                        </div>
                                                        <div className="col-span-2">
                                                            <motion.button
                                                                type="button"
                                                                whileHover={{ scale: 1.1 }}
                                                                whileTap={{ scale: 0.9 }}
                                                                onClick={() => removeItem(index)}
                                                                className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm"
                                                            >
                                                                {translations.removeItem}
                                                            </motion.button>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            ))}
                                            {formData.items.length === 0 && (
                                                <div className="text-center py-4 text-gray-500 dark:text-gray-400 text-sm">
                                                    آیتمی اضافه نشده است. روی «افزودن آیتم» کلیک کنید.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">
                                            جمع کل:{" "}
                                        </span>
                                        <span className="font-bold text-purple-700 dark:text-purple-300">
                                            {calculateTotal().toLocaleString("en-US")}
                                        </span>
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

                {/* View Modal */}
                <AnimatePresence>
                    {isViewModalOpen && viewingService && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto"
                            onClick={() => setIsViewModalOpen(false)}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
                            >
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                                    خدمت #{viewingService.service.id}
                                </h2>
                                <div className="space-y-4 mb-6">
                                    <p>
                                        <span className="text-gray-600 dark:text-gray-400">مشتری: </span>
                                        <span className="font-medium">
                                            {getCustomerName(viewingService.service.customer_id)}
                                        </span>
                                    </p>
                                    <p>
                                        <span className="text-gray-600 dark:text-gray-400">تاریخ: </span>
                                        {formatPersianDate(viewingService.service.date)}
                                    </p>
                                    {viewingService.service.notes && (
                                        <p>
                                            <span className="text-gray-600 dark:text-gray-400">یادداشت: </span>
                                            {viewingService.service.notes}
                                        </p>
                                    )}
                                    <p>
                                        <span className="text-gray-600 dark:text-gray-400">مبلغ کل: </span>
                                        <span className="font-bold text-purple-600">
                                            {viewingService.service.total_amount.toLocaleString("en-US")}
                                        </span>
                                        <span className="text-gray-500 mr-1">پرداخت شده: </span>
                                        <span className="font-bold text-green-600">
                                            {viewingService.service.paid_amount.toLocaleString("en-US")}
                                        </span>
                                    </p>
                                </div>
                                <div className="mb-4">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                                        آیتم‌ها
                                    </h3>
                                    <div className="rounded-xl border border-gray-200 dark:border-gray-600 overflow-hidden">
                                        <table className="w-full text-sm">
                                            <thead className="bg-gray-50 dark:bg-gray-700/50">
                                                <tr>
                                                    <th className="px-4 py-2 text-right">نام</th>
                                                    <th className="px-4 py-2 text-right">قیمت</th>
                                                    <th className="px-4 py-2 text-right">مقدار</th>
                                                    <th className="px-4 py-2 text-right">جمع</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                                {viewingService.items.map((item) => (
                                                    <tr key={item.id}>
                                                        <td className="px-4 py-2">{item.name}</td>
                                                        <td className="px-4 py-2">{item.price.toLocaleString("en-US")}</td>
                                                        <td className="px-4 py-2">{item.quantity.toLocaleString("en-US")}</td>
                                                        <td className="px-4 py-2 font-medium">{item.total.toLocaleString("en-US")}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                                <div className="mb-6">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                                        {translations.payments.title}
                                    </h3>
                                    {viewingService.payments.length === 0 ? (
                                        <p className="text-gray-500 dark:text-gray-400 text-sm">
                                            {translations.payments.noPayments}
                                        </p>
                                    ) : (
                                        <ul className="space-y-2">
                                            {viewingService.payments.map((p) => (
                                                <li
                                                    key={p.id}
                                                    className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700 last:border-0"
                                                >
                                                    <span>{p.amount.toLocaleString("en-US")}</span>
                                                    <span className="text-gray-500">{formatPersianDate(p.date)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                                <div className="flex gap-3">
                                    <motion.button
                                        type="button"
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => openPaymentModal(viewingService.service.id)}
                                        className="px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-bold rounded-xl"
                                    >
                                        {translations.payments.addPayment}
                                    </motion.button>
                                    <motion.button
                                        type="button"
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => setIsViewModalOpen(false)}
                                        className="flex-1 px-4 py-3 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white font-bold rounded-xl"
                                    >
                                        {translations.cancel}
                                    </motion.button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Payment Modal */}
                <AnimatePresence>
                    {isPaymentModalOpen && (
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
                                    {translations.payments.addPayment}
                                </h2>
                                <form onSubmit={handlePaymentSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.payments.service}
                                        </label>
                                        <select
                                            value={paymentFormData.service_id}
                                            onChange={(e) =>
                                                setPaymentFormData({ ...paymentFormData, service_id: e.target.value })
                                            }
                                            required
                                            disabled={!!viewingService}
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200 disabled:opacity-70"
                                            dir="rtl"
                                        >
                                            <option value="">{translations.placeholdersPayment.service}</option>
                                            {(
                                                viewingService && !services.some((s) => s.id === viewingService.service.id)
                                                    ? [viewingService.service, ...services]
                                                    : services
                                            ).map((service) => {
                                                const customer = customers.find((c) => c.id === service.customer_id);
                                                return (
                                                    <option key={service.id} value={service.id}>
                                                        خدمت #{service.id} – {customer ? customer.full_name : "نامشخص"} –{" "}
                                                        {formatPersianDate(service.date)} –{" "}
                                                        {service.total_amount.toLocaleString("en-US")}
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.payments.amount}
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={paymentFormData.amount}
                                            onChange={(e) =>
                                                setPaymentFormData({ ...paymentFormData, amount: e.target.value })
                                            }
                                            required
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            placeholder={translations.placeholdersPayment.amount}
                                            dir="ltr"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.date}
                                        </label>
                                        <PersianDatePicker
                                            value={paymentFormData.date}
                                            onChange={(date) =>
                                                setPaymentFormData({ ...paymentFormData, date })
                                            }
                                            placeholder={translations.placeholders.date}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.payments.accountOptional}
                                        </label>
                                        <select
                                            value={paymentFormData.account_id}
                                            onChange={(e) =>
                                                setPaymentFormData({ ...paymentFormData, account_id: e.target.value })
                                            }
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            dir="rtl"
                                        >
                                            <option value="">{translations.placeholdersPayment.account}</option>
                                            {accounts
                                                .filter((a) => a.is_active)
                                                .map((acc) => (
                                                    <option key={acc.id} value={acc.id}>
                                                        {acc.name}
                                                    </option>
                                                ))}
                                        </select>
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

                {/* Delete confirmation */}
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
                                <p className="text-center text-gray-600 dark:text-gray-400 mb-6">
                                    {translations.confirmDelete}
                                </p>
                                <div className="flex gap-3">
                                    <motion.button
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => setDeleteConfirm(null)}
                                        className="flex-1 px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white font-bold rounded-xl"
                                    >
                                        {translations.cancel}
                                    </motion.button>
                                    <motion.button
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => handleDelete(deleteConfirm)}
                                        disabled={loading}
                                        className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-pink-600 text-white font-bold rounded-xl disabled:opacity-50"
                                    >
                                        {translations.delete}
                                    </motion.button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <Footer />
            </div>
        </div>
    );
}

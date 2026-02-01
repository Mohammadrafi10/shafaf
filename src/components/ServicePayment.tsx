import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
    getServices,
    getServicePayments,
    createServicePayment,
    deleteServicePayment,
    type Service,
    type ServicePayment,
} from "../utils/service";
import { getCustomers, type Customer } from "../utils/customer";
import { getAccounts, type Account } from "../utils/account";
import { isDatabaseOpen, openDatabase } from "../utils/db";
import Footer from "./Footer";
import PersianDatePicker from "./PersianDatePicker";
import { formatPersianDate, getCurrentPersianDate, persianToGeorgian } from "../utils/date";
import Table from "./common/Table";
import PageHeader from "./common/PageHeader";
import { Search } from "lucide-react";

const translations = {
    title: "پرداخت خدمات",
    addNew: "ثبت پرداخت جدید",
    delete: "حذف",
    cancel: "لغو",
    save: "ذخیره",
    service: "خدمت",
    customer: "مشتری",
    amount: "مقدار",
    date: "تاریخ",
    account: "حساب (واریز)",
    accountOptional: "حساب برای واریز (اختیاری)",
    serviceTotal: "مبلغ کل خدمت",
    paidAmount: "پرداخت شده",
    remainingAmount: "باقیمانده",
    noPayments: "هیچ پرداختی ثبت نشده است",
    confirmDelete: "آیا از حذف این پرداخت اطمینان دارید؟",
    backToDashboard: "بازگشت به داشبورد",
    success: {
        created: "پرداخت با موفقیت ثبت شد",
        deleted: "پرداخت با موفقیت حذف شد",
    },
    errors: {
        create: "خطا در ثبت پرداخت",
        delete: "خطا در حذف پرداخت",
        fetch: "خطا در دریافت لیست پرداخت‌ها",
        serviceRequired: "انتخاب خدمت الزامی است",
        amountRequired: "مقدار الزامی است",
        dateRequired: "تاریخ الزامی است",
    },
    placeholders: {
        service: "خدمت را انتخاب کنید",
        amount: "مقدار را وارد کنید",
        date: "تاریخ را انتخاب کنید",
        account: "انتخاب حساب (برای واریز)",
    },
};

interface ServicePaymentManagementProps {
    onBack?: () => void;
}

export default function ServicePaymentManagement({ onBack }: ServicePaymentManagementProps) {
    const [payments, setPayments] = useState<ServicePayment[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [servicePaymentsMap, setServicePaymentsMap] = useState<Record<number, ServicePayment[]>>({});
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({
        service_id: "",
        account_id: "",
        amount: "",
        date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split("T")[0],
    });

    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(10);
    const [totalItems, setTotalItems] = useState(0);
    const [search, setSearch] = useState("");
    const [sortBy, setSortBy] = useState("date");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

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

            const [servicesResponse, customersData, accountsData] = await Promise.all([
                getServices(1, 10000, search, sortBy, sortOrder),
                getCustomers(1, 10000),
                getAccounts(),
            ]);

            setServices(servicesResponse.items);
            setCustomers(customersData.items);
            setAccounts(accountsData);

            const allPayments: ServicePayment[] = [];
            const paymentsMap: Record<number, ServicePayment[]> = {};

            await Promise.all(
                servicesResponse.items.map(async (service) => {
                    try {
                        const servicePayments = await getServicePayments(service.id);
                        paymentsMap[service.id] = servicePayments;
                        allPayments.push(...servicePayments);
                    } catch {
                        paymentsMap[service.id] = [];
                    }
                })
            );

            setServicePaymentsMap(paymentsMap);

            const startIndex = (page - 1) * perPage;
            const endIndex = startIndex + perPage;
            const paginatedPayments = allPayments.slice(startIndex, endIndex);
            setPayments(paginatedPayments);
            setTotalItems(allPayments.length);
        } catch (error: unknown) {
            toast.error(translations.errors.fetch);
            console.error("Error loading data:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = (payment?: ServicePayment) => {
        if (payment) {
            setFormData({
                service_id: payment.service_id.toString(),
                account_id: payment.account_id?.toString() ?? "",
                amount: payment.amount.toString(),
                date: payment.date,
            });
        } else {
            setFormData({
                service_id: "",
                account_id: "",
                amount: "",
                date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split("T")[0],
            });
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setFormData({
            service_id: "",
            account_id: "",
            amount: "",
            date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split("T")[0],
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.service_id) {
            toast.error(translations.errors.serviceRequired);
            return;
        }

        if (!formData.amount || parseFloat(formData.amount) <= 0) {
            toast.error(translations.errors.amountRequired);
            return;
        }

        if (!formData.date) {
            toast.error(translations.errors.dateRequired);
            return;
        }

        const amount = parseFloat(formData.amount);
        const service_id = parseInt(formData.service_id, 10);
        const service = services.find((s) => s.id === service_id);

        try {
            setLoading(true);
            await createServicePayment(
                service_id,
                formData.account_id ? parseInt(formData.account_id, 10) : null,
                service?.currency_id ?? null,
                service?.exchange_rate ?? 1,
                amount,
                formData.date
            );
            toast.success(translations.success.created);
            handleCloseModal();
            await loadData();
        } catch (error: unknown) {
            toast.error(translations.errors.create);
            console.error("Error saving payment:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: number) => {
        try {
            setLoading(true);
            await deleteServicePayment(id);
            toast.success(translations.success.deleted);
            setDeleteConfirm(null);
            await loadData();
        } catch (error: unknown) {
            toast.error(translations.errors.delete);
            console.error("Error deleting payment:", error);
        } finally {
            setLoading(false);
        }
    };

    const getServiceInfo = (serviceId: number): string => {
        const service = services.find((s) => s.id === serviceId);
        const customer = service
            ? customers.find((c) => c.id === service.customer_id)
            : null;
        return service
            ? `خدمت #${service.id} - ${customer ? customer.full_name : "نامشخص"} - ${formatPersianDate(service.date)} - ${service.total_amount.toLocaleString()}`
            : "نامشخص";
    };

    const calculatePaidAmount = (serviceId: number): number => {
        const servicePayments = servicePaymentsMap[serviceId] || [];
        return servicePayments.reduce((sum, p) => sum + p.amount, 0);
    };

    const calculateRemainingAmount = (serviceId: number): number => {
        const service = services.find((s) => s.id === serviceId);
        if (!service) return 0;
        const paid = calculatePaidAmount(serviceId);
        return service.total_amount - paid;
    };

    const getAccountName = (accountId: number | null): string => {
        if (!accountId) return "—";
        const acc = accounts.find((a) => a.id === accountId);
        return acc ? acc.name : `#${accountId}`;
    };

    const columns = [
        {
            key: "service_id",
            label: translations.service,
            sortable: false,
            render: (payment: ServicePayment) => {
                const service = services.find((s) => s.id === payment.service_id);
                const paid = calculatePaidAmount(payment.service_id);
                const remaining = calculateRemainingAmount(payment.service_id);
                return (
                    <div className="space-y-2">
                        <div className="font-medium text-gray-900 dark:text-white">
                            {getServiceInfo(payment.service_id)}
                        </div>
                        <div className="text-xs space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-gray-500 dark:text-gray-400">مبلغ کل:</span>
                                <span className="font-bold text-teal-600 dark:text-teal-400">
                                    {service ? service.total_amount.toLocaleString("en-US") : "0"} افغانی
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-gray-500 dark:text-gray-400">پرداخت شده:</span>
                                <span className="font-bold text-green-600 dark:text-green-400">
                                    {paid.toLocaleString("en-US")} افغانی
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-gray-500 dark:text-gray-400">باقیمانده:</span>
                                <span
                                    className={`font-bold ${remaining > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
                                >
                                    {remaining.toLocaleString("en-US")} افغانی
                                </span>
                            </div>
                        </div>
                    </div>
                );
            },
        },
        {
            key: "amount",
            label: translations.amount,
            sortable: true,
            render: (payment: ServicePayment) => (
                <span className="font-bold text-green-600 dark:text-green-400">
                    {payment.amount.toLocaleString("en-US")} افغانی
                </span>
            ),
        },
        {
            key: "account_id",
            label: translations.account,
            sortable: false,
            render: (payment: ServicePayment) => (
                <span className="text-gray-700 dark:text-gray-300">
                    {getAccountName(payment.account_id)}
                </span>
            ),
        },
        {
            key: "date",
            label: translations.date,
            sortable: true,
            render: (payment: ServicePayment) => formatPersianDate(payment.date),
        },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-6" dir="rtl">
            <div className="max-w-6xl mx-auto">
                <PageHeader
                    title={translations.title}
                    onBack={onBack}
                    backLabel={translations.backToDashboard}
                    actions={[
                        {
                            label: translations.addNew,
                            onClick: () => handleOpenModal(),
                            variant: "primary" as const,
                        },
                    ]}
                />

                <div className="mb-6 relative max-w-md w-full">
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
                        className="block w-full pr-10 pl-3 py-3 border border-gray-200 dark:border-gray-700 rounded-xl leading-5 bg-white dark:bg-gray-800 placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 sm:text-sm transition-all shadow-sm hover:shadow-md"
                        placeholder="جستجو بر اساس تاریخ..."
                    />
                </div>

                <Table<ServicePayment>
                    data={payments}
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
                    actions={(payment) => (
                        <div className="flex items-center gap-2">
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => setDeleteConfirm(payment.id)}
                                className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </motion.button>
                        </div>
                    )}
                />

                {/* Modal for Add */}
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
                                    {translations.addNew}
                                </h2>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.service}
                                        </label>
                                        <select
                                            value={formData.service_id}
                                            onChange={(e) =>
                                                setFormData({ ...formData, service_id: e.target.value })
                                            }
                                            required
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            dir="rtl"
                                        >
                                            <option value="">{translations.placeholders.service}</option>
                                            {services.map((service) => {
                                                const customer = customers.find(
                                                    (c) => c.id === service.customer_id
                                                );
                                                return (
                                                    <option key={service.id} value={service.id}>
                                                        خدمت #{service.id} -{" "}
                                                        {customer ? customer.full_name : "نامشخص"} -{" "}
                                                        {formatPersianDate(service.date)} -{" "}
                                                        {service.total_amount.toLocaleString()}
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.amount}
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={formData.amount}
                                            onChange={(e) =>
                                                setFormData({ ...formData, amount: e.target.value })
                                            }
                                            required
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            placeholder={translations.placeholders.amount}
                                            dir="ltr"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.accountOptional}
                                        </label>
                                        <select
                                            value={formData.account_id}
                                            onChange={(e) =>
                                                setFormData({ ...formData, account_id: e.target.value })
                                            }
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            dir="rtl"
                                        >
                                            <option value="">{translations.placeholders.account}</option>
                                            {accounts.map((acc) => (
                                                <option key={acc.id} value={acc.id}>
                                                    {acc.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.date}
                                        </label>
                                        <PersianDatePicker
                                            value={formData.date}
                                            onChange={(date) =>
                                                setFormData({ ...formData, date: date ?? formData.date })
                                            }
                                            placeholder={translations.placeholders.date}
                                            required
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
                                            className="flex-1 px-4 py-3 bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white font-bold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {loading ? (
                                                <span className="flex items-center justify-center gap-2">
                                                    <motion.div
                                                        animate={{ rotate: 360 }}
                                                        transition={{
                                                            duration: 1,
                                                            repeat: Infinity,
                                                            ease: "linear",
                                                        }}
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
                                                    transition={{
                                                        duration: 1,
                                                        repeat: Infinity,
                                                        ease: "linear",
                                                    }}
                                                    className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                                                />
                                                در حال حذف...
                                            </span>
                                        ) : (
                                            translations.delete
                                        )}
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

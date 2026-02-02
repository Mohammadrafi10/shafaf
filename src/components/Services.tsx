import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
    initServicesTable,
    createService,
    getServices,
    getService,
    updateService,
    deleteService,
    type Service,
} from "../utils/service";
import { getCurrencies, type Currency } from "../utils/currency";
import { isDatabaseOpen, openDatabase } from "../utils/db";
import Table from "./common/Table";
import PageHeader from "./common/PageHeader";
import { Search } from "lucide-react";

const translations = {
    title: "تعریف خدمات",
    addNew: "افزودن خدمت",
    edit: "ویرایش",
    delete: "حذف",
    cancel: "لغو",
    save: "ذخیره",
    name: "نام خدمت",
    price: "قیمت",
    currency: "ارز",
    description: "توضیحات",
    noServices: "هیچ خدمتی تعریف نشده است",
    confirmDelete: "آیا از حذف این خدمت اطمینان دارید؟",
    backToDashboard: "بازگشت به داشبورد",
    success: {
        created: "خدمت با موفقیت اضافه شد",
        updated: "خدمت با موفقیت بروزرسانی شد",
        deleted: "خدمت با موفقیت حذف شد",
    },
    errors: {
        create: "خطا در ثبت خدمت",
        update: "خطا در بروزرسانی خدمت",
        delete: "خطا در حذف خدمت",
        fetch: "خطا در دریافت لیست خدمات",
        nameRequired: "نام خدمت الزامی است",
        priceRequired: "قیمت باید بزرگتر از صفر باشد",
    },
    placeholders: {
        name: "نام خدمت",
        price: "۰",
        description: "توضیحات (اختیاری)",
    },
};

interface ServicesManagementProps {
    onBack?: () => void;
}

export default function ServicesManagement({ onBack }: ServicesManagementProps) {
    const [services, setServices] = useState<Service[]>([]);
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingService, setEditingService] = useState<Service | null>(null);
    const [formData, setFormData] = useState({
        name: "",
        price: "",
        currency_id: "",
        description: "",
    });
    const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(10);
    const [totalItems, setTotalItems] = useState(0);
    const [search, setSearch] = useState("");
    const [sortBy, setSortBy] = useState("name");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

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
            const [servicesResponse, currenciesData] = await Promise.all([
                getServices(page, perPage, search, sortBy, sortOrder),
                getCurrencies(),
            ]);
            setServices(servicesResponse.items);
            setTotalItems(servicesResponse.total);
            setCurrencies(currenciesData || []);
        } catch (error: unknown) {
            toast.error(translations.errors.fetch);
            console.error("Error loading data:", error);
        } finally {
            setLoading(false);
        }
    };

    const loadServiceDetails = async (id: number) => {
        try {
            const service = await getService(id);
            setEditingService(service);
            setFormData({
                name: service.name,
                price: service.price.toString(),
                currency_id: service.currency_id ? service.currency_id.toString() : "",
                description: service.description || "",
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
                name: "",
                price: "",
                currency_id: "",
                description: "",
            });
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingService(null);
        setFormData({
            name: "",
            price: "",
            currency_id: "",
            description: "",
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const name = formData.name?.trim() ?? "";
        if (!name) {
            toast.error(translations.errors.nameRequired);
            return;
        }
        const price = parseFloat(formData.price);
        if (Number.isNaN(price) || price < 0) {
            toast.error(translations.errors.priceRequired);
            return;
        }
        try {
            setLoading(true);
            const currencyId = formData.currency_id ? parseInt(formData.currency_id, 10) : null;
            const description = formData.description?.trim() || null;
            if (editingService) {
                await updateService(
                    editingService.id,
                    name,
                    price,
                    currencyId,
                    description
                );
                toast.success(translations.success.updated);
            } else {
                await createService(name, price, currencyId, description);
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

    const getCurrencyName = (currencyId: number | null) =>
        currencyId ? currencies.find((c) => c.id === currencyId)?.name ?? "" : "";

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
            key: "name",
            label: translations.name,
            sortable: true,
            render: (s: Service) => (
                <span className="font-medium text-gray-900 dark:text-white">{s.name}</span>
            ),
        },
        {
            key: "price",
            label: translations.price,
            sortable: true,
            render: (s: Service) => (
                <span className="text-gray-700 dark:text-gray-300">
                    {s.price.toLocaleString("en-US")} {getCurrencyName(s.currency_id)}
                </span>
            ),
        },
        {
            key: "description",
            label: translations.description,
            sortable: false,
            render: (s: Service) => (
                <span className="text-gray-600 dark:text-gray-400 text-sm max-w-xs truncate block">
                    {s.description || "—"}
                </span>
            ),
        },
    ];

    return (
        <div
            className="min-h-screen bg-gradient-to-br from-teal-50 via-cyan-50 to-blue-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-6"
            dir="rtl"
        >
            <div className="max-w-7xl mx-auto">
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
                        className="block w-full pr-10 pl-3 py-3 border border-gray-200 dark:border-gray-700 rounded-xl leading-5 bg-white dark:bg-gray-800 placeholder-gray-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm transition-all shadow-sm hover:shadow-md"
                        placeholder="جستجو بر اساس نام یا توضیحات..."
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
                                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-lg my-8"
                            >
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                                    {editingService ? translations.edit : translations.addNew}
                                </h2>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.name} <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            required
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-teal-500 dark:focus:border-teal-400 transition-all duration-200"
                                            placeholder={translations.placeholders.name}
                                            dir="rtl"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.price} <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={formData.price}
                                            onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                            required
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-teal-500 dark:focus:border-teal-400 transition-all duration-200"
                                            placeholder={translations.placeholders.price}
                                            dir="ltr"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.currency}
                                        </label>
                                        <select
                                            value={formData.currency_id}
                                            onChange={(e) => setFormData({ ...formData, currency_id: e.target.value })}
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-teal-500 dark:focus:border-teal-400 transition-all duration-200"
                                            dir="rtl"
                                        >
                                            <option value="">انتخاب ارز (اختیاری)</option>
                                            {currencies.map((c) => (
                                                <option key={c.id} value={c.id}>
                                                    {c.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.description}
                                        </label>
                                        <textarea
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            rows={3}
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-teal-500 dark:focus:border-teal-400 transition-all duration-200 resize-none"
                                            placeholder={translations.placeholders.description}
                                            dir="rtl"
                                        />
                                    </div>
                                    <div className="flex gap-3 pt-4">
                                        <button
                                            type="button"
                                            onClick={handleCloseModal}
                                            className="flex-1 px-4 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                        >
                                            {translations.cancel}
                                        </button>
                                        <button
                                            type="submit"
                                            className="flex-1 px-4 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold transition-colors"
                                        >
                                            {translations.save}
                                        </button>
                                    </div>
                                </form>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Delete confirmation */}
                <AnimatePresence>
                    {deleteConfirm !== null && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                            onClick={() => setDeleteConfirm(null)}
                        >
                            <motion.div
                                initial={{ scale: 0.9 }}
                                animate={{ scale: 1 }}
                                exit={{ scale: 0.9 }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 max-w-sm w-full"
                            >
                                <p className="text-gray-700 dark:text-gray-300 mb-6">{translations.confirmDelete}</p>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setDeleteConfirm(null)}
                                        className="flex-1 px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                        {translations.cancel}
                                    </button>
                                    <button
                                        onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)}
                                        className="flex-1 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white"
                                    >
                                        {translations.delete}
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

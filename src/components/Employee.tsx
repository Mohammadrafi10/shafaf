import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
// Note: File dialog functionality can be added later with @tauri-apps/plugin-dialog
// For now, using a simple file input approach
import {
    initEmployeesTable,
    createEmployee,
    getEmployees,
    updateEmployee,
    deleteEmployee,
    type Employee,
} from "../utils/employee";
import { isDatabaseOpen, openDatabase } from "../utils/db";
import Footer from "./Footer";
import PersianDatePicker from "./PersianDatePicker";
import PageHeader from "./common/PageHeader";
import Table from "./common/Table";
import ViewModeToggle, { type ViewMode } from "./common/ViewModeToggle";
import ThumbnailGrid from "./common/ThumbnailGrid";
import { Search } from "lucide-react";

// Dari translations
const translations = {
    title: "مدیریت کارمندان",
    addNew: "ثبت کارمند جدید",
    edit: "ویرایش",
    delete: "حذف",
    cancel: "لغو",
    save: "ذخیره",
    fullName: "نام کامل",
    phone: "شماره تماس",
    email: "ایمیل",
    address: "آدرس",
    position: "سمت/موقعیت",
    hireDate: "تاریخ استخدام",
    baseSalary: "حقوق پایه",
    photo: "عکس",
    notes: "یادداشت",
    actions: "عملیات",
    createdAt: "تاریخ ایجاد",
    updatedAt: "آخرین بروزرسانی",
    noEmployees: "هیچ کارمندی ثبت نشده است",
    confirmDelete: "آیا از حذف این کارمند اطمینان دارید؟",
    backToDashboard: "بازگشت به داشبورد",
    selectPhoto: "انتخاب عکس",
    photoSelected: "عکس انتخاب شد",
    success: {
        created: "کارمند با موفقیت ثبت شد",
        updated: "کارمند با موفقیت بروزرسانی شد",
        deleted: "کارمند با موفقیت حذف شد",
    },
    errors: {
        create: "خطا در ثبت کارمند",
        update: "خطا در بروزرسانی کارمند",
        delete: "خطا در حذف کارمند",
        fetch: "خطا در دریافت لیست کارمندان",
        nameRequired: "نام کامل الزامی است",
        phoneRequired: "شماره تماس الزامی است",
        addressRequired: "آدرس الزامی است",
    },
    placeholders: {
        fullName: "نام کامل را وارد کنید",
        phone: "شماره تماس را وارد کنید",
        email: "ایمیل را وارد کنید",
        address: "آدرس را وارد کنید",
        position: "سمت را وارد کنید",
        baseSalary: "حقوق پایه",
        notes: "یادداشت را وارد کنید",
    },
};

interface EmployeeManagementProps {
    onBack?: () => void;
    onNavigateToSalary?: () => void;
}

export default function EmployeeManagement({ onBack, onNavigateToSalary }: EmployeeManagementProps) {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

    // Pagination & Search State
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(10);
    const [totalItems, setTotalItems] = useState(0);
    const [search, setSearch] = useState("");
    const [sortBy, setSortBy] = useState("created_at");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    // View mode: table or thumbnail
    const [viewMode, setViewMode] = useState<ViewMode>(() => {
        try {
            const saved = localStorage.getItem("employeeViewMode");
            return (saved === "thumbnail" ? "thumbnail" : "table") as ViewMode;
        } catch { return "table"; }
    });
    useEffect(() => {
        try { localStorage.setItem("employeeViewMode", viewMode); } catch { /* ignore */ }
    }, [viewMode]);

    const [formData, setFormData] = useState({
        full_name: "",
        phone: "",
        email: "",
        address: "",
        position: "",
        hire_date: "",
        base_salary: "",
        photo_path: "",
        notes: "",
    });
    const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);

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
                await initEmployeesTable();
            } catch (err) {
                console.log("Table initialization:", err);
            }

            const response = await getEmployees(page, perPage, search, sortBy, sortOrder);
            setEmployees(response.items);
            setTotalItems(response.total);
        } catch (error: any) {
            toast.error(translations.errors.fetch);
            console.error("Error loading data:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSelectPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            // Create a local URL for preview
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                setPhotoPreview(result);
                // Store the file path or convert to base64 if needed
                // For now, storing as data URL for preview
                setFormData({ ...formData, photo_path: result });
            };
            reader.readAsDataURL(file);
        }
    };

    const handleOpenModal = (employee?: Employee) => {
        if (employee) {
            setEditingEmployee(employee);
            setFormData({
                full_name: employee.full_name,
                phone: employee.phone,
                email: employee.email || "",
                address: employee.address,
                position: employee.position || "",
                hire_date: employee.hire_date || "",
                base_salary: employee.base_salary?.toString() || "",
                photo_path: employee.photo_path || "",
                notes: employee.notes || "",
            });
            setPhotoPreview(employee.photo_path || null);
        } else {
            setEditingEmployee(null);
            setFormData({
                full_name: "",
                phone: "",
                email: "",
                address: "",
                position: "",
                hire_date: "",
                base_salary: "",
                photo_path: "",
                notes: "",
            });
            setPhotoPreview(null);
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingEmployee(null);
        setFormData({
            full_name: "",
            phone: "",
            email: "",
            address: "",
            position: "",
            hire_date: "",
            base_salary: "",
            photo_path: "",
            notes: "",
        });
        setPhotoPreview(null);
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
            if (editingEmployee) {
                await updateEmployee(
                    editingEmployee.id,
                    formData.full_name,
                    formData.phone,
                    formData.address,
                    formData.email || null,
                    formData.position || null,
                    formData.hire_date || null,
                    formData.base_salary ? parseFloat(formData.base_salary) : null,
                    formData.photo_path || null,
                    formData.notes || null
                );
                toast.success(translations.success.updated);
            } else {
                await createEmployee(
                    formData.full_name,
                    formData.phone,
                    formData.address,
                    formData.email || null,
                    formData.position || null,
                    formData.hire_date || null,
                    formData.base_salary ? parseFloat(formData.base_salary) : null,
                    formData.photo_path || null,
                    formData.notes || null
                );
                toast.success(translations.success.created);
            }
            handleCloseModal();
            await loadData();
        } catch (error: any) {
            toast.error(editingEmployee ? translations.errors.update : translations.errors.create);
            console.error("Error saving employee:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: number) => {
        try {
            setLoading(true);
            await deleteEmployee(id);
            toast.success(translations.success.deleted);
            setDeleteConfirm(null);
            await loadData();
        } catch (error: any) {
            toast.error(translations.errors.delete);
            console.error("Error deleting employee:", error);
        } finally {
            setLoading(false);
        }
    };

    const columns = [
        {
            key: "photo_path",
            label: translations.photo,
            className: "w-20",
            render: (emp: Employee) => (
                emp.photo_path ? (
                    <img src={emp.photo_path} alt={emp.full_name} className="w-12 h-12 rounded-full object-cover border-2 border-white dark:border-gray-700 shadow-sm" />
                ) : (
                    <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-sm">
                        {emp.full_name.charAt(0)}
                    </div>
                )
            )
        },
        {
            key: "full_name",
            label: translations.fullName,
            sortable: true,
            render: (emp: Employee) => (
                <div className="font-bold text-gray-900 dark:text-white">{emp.full_name}</div>
            )
        },
        { key: "phone", label: translations.phone, sortable: true },
        { key: "position", label: translations.position, sortable: true },
        { key: "email", label: translations.email, sortable: true },
        {
            key: "base_salary",
            label: translations.baseSalary,
            sortable: true,
            render: (emp: Employee) => emp.base_salary ? (
                <span className="font-mono font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-lg">
                    {emp.base_salary.toLocaleString()}
                </span>
            ) : "-"
        },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-6" dir="rtl">
            <div className="max-w-7xl mx-auto">
                <PageHeader
                    title={translations.title}
                    onBack={onBack}
                    backLabel={translations.backToDashboard}
                    actions={[
                        ...(onNavigateToSalary ? [{
                            label: "مدیریت معاشات",
                            onClick: onNavigateToSalary,
                            icon: (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            ),
                            variant: "warning" as const
                        }] : []),
                        {
                            label: translations.addNew,
                            onClick: () => handleOpenModal(),
                            icon: (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                            ),
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
                                setPage(1); // Reset to first page on search
                            }}
                            className="block w-full pr-10 pl-3 py-3 border border-gray-200 dark:border-gray-700 rounded-xl leading-5 bg-white dark:bg-gray-800 placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 sm:text-sm transition-all shadow-sm hover:shadow-md"
                            placeholder="جستجو بر اساس نام، شماره تماس، ایمیل..."
                        />
                    </div>

                {viewMode === "table" ? (
                    <Table
                        data={employees}
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
                        actions={(emp) => (
                            <div className="flex items-center gap-2">
                                <motion.button
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={() => handleOpenModal(emp)}
                                    className="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={() => setDeleteConfirm(emp.id)}
                                    className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
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
                        data={employees}
                        total={totalItems}
                        page={page}
                        perPage={perPage}
                        onPageChange={setPage}
                        onPerPageChange={setPerPage}
                        loading={loading}
                        renderCard={(emp) => (
                            <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800/80 p-4 shadow-lg hover:shadow-xl hover:border-purple-300 dark:hover:border-purple-600 transition-all h-full flex flex-col">
                                <div className="flex justify-center mb-3">
                                    {emp.photo_path ? (
                                        <img src={emp.photo_path} alt={emp.full_name} className="w-16 h-16 rounded-full object-cover border-2 border-white dark:border-gray-700 shadow-md" />
                                    ) : (
                                        <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-md">
                                            {emp.full_name.charAt(0)}
                                        </div>
                                    )}
                                </div>
                                <div className="font-bold text-gray-900 dark:text-white text-center mb-1 truncate" title={emp.full_name}>{emp.full_name}</div>
                                {emp.position && <div className="text-sm text-gray-600 dark:text-gray-400 text-center mb-1">{emp.position}</div>}
                                {emp.base_salary != null && emp.base_salary !== 0 && (
                                    <div className="text-xs font-semibold text-green-600 dark:text-green-400 text-center mb-2">{emp.base_salary.toLocaleString()} افغانی</div>
                                )}
                                <div className="flex items-center justify-center gap-1.5 mt-auto pt-2">
                                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => handleOpenModal(emp)} className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg" title={translations.edit}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></motion.button>
                                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setDeleteConfirm(emp.id)} className="p-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg" title={translations.delete}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></motion.button>
                                </div>
                            </div>
                        )}
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
                                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-3xl max-h-[90vh] overflow-y-auto"
                            >
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                                    {editingEmployee ? translations.edit : translations.addNew}
                                </h2>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                                                type="text"
                                                value={formData.phone}
                                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder={translations.placeholders.phone}
                                                dir="ltr"
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                                                {translations.position}
                                            </label>
                                            <input
                                                type="text"
                                                value={formData.position}
                                                onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder={translations.placeholders.position}
                                                dir="rtl"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.address} <span className="text-red-500">*</span>
                                        </label>
                                        <textarea
                                            value={formData.address}
                                            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                            required
                                            rows={2}
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            placeholder={translations.placeholders.address}
                                            dir="rtl"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.hireDate}
                                            </label>
                                            <PersianDatePicker
                                                value={formData.hire_date || ''}
                                                onChange={(date) => setFormData({ ...formData, hire_date: date })}
                                                placeholder="تاریخ استخدام را انتخاب کنید"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.baseSalary}
                                            </label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={formData.base_salary}
                                                onChange={(e) => setFormData({ ...formData, base_salary: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder={translations.placeholders.baseSalary}
                                                dir="ltr"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.photo}
                                        </label>
                                        <div className="flex gap-4 items-center">
                                            <label className="cursor-pointer">
                                                <motion.div
                                                    whileHover={{ scale: 1.05 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    className="px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-semibold rounded-xl shadow-md hover:shadow-lg transition-all duration-200 inline-block"
                                                >
                                                    {translations.selectPhoto}
                                                </motion.div>
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={handleSelectPhoto}
                                                    className="hidden"
                                                />
                                            </label>
                                            {photoPreview && (
                                                <div className="flex items-center gap-2">
                                                    <img
                                                        src={photoPreview}
                                                        alt="Preview"
                                                        className="w-16 h-16 rounded-full object-cover border-2 border-purple-300 dark:border-purple-700"
                                                    />
                                                    <span className="text-sm text-gray-600 dark:text-gray-400">{translations.photoSelected}</span>
                                                </div>
                                            )}
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
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
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
                <Footer />
            </div>
        </div>
    );
}

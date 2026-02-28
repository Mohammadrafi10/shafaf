import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
    initSalariesTable,
    createSalary,
    updateSalary,
    getSalaries,
    deleteSalary,
    type Salary,
} from "../utils/salary";
import { getEmployees, type Employee } from "../utils/employee";
import { isDatabaseOpen, openDatabase } from "../utils/db";
import Footer from "./Footer";
import Table from "./common/Table";
import PageHeader from "./common/PageHeader";
import { Search } from "lucide-react";
import { getCurrentPersianYear } from "../utils/date";
import { Deduction, getDeductionsByEmployeeYearMonth } from "../utils/deduction";

// Dari month names
const dariMonths = [
    "حمل", "ثور", "جوزا", "سرطان", "اسد", "سنبله",
    "میزان", "عقرب", "قوس", "جدی", "دلو", "حوت"
];

// Dari translations
const translations = {
    title: "مدیریت معاشات",
    addNew: "پرداخت معاش",
    edit: "ویرایش",
    delete: "حذف",
    cancel: "لغو",
    save: "ذخیره",
    employee: "کارمند",
    year: "سال",
    month: "ماه",
    amount: "مقدار حقوق",
    deductions: "کسر",
    netSalary: "حقوق خالص",
    baseSalary: "حقوق پایه",
    notes: "یادداشت",
    actions: "عملیات",
    createdAt: "تاریخ ایجاد",
    updatedAt: "آخرین بروزرسانی",
    noSalaries: "هیچ معاشی ثبت نشده است",
    confirmDelete: "آیا از حذف این معاش اطمینان دارید؟",
    backToDashboard: "بازگشت به داشبورد",
    success: {
        created: "معاش با موفقیت ثبت شد",
        updated: "معاش با موفقیت بروزرسانی شد",
        deleted: "معاش با موفقیت حذف شد",
    },
    errors: {
        create: "خطا در ثبت معاش",
        update: "خطا در بروزرسانی معاش",
        delete: "خطا در حذف معاش",
        fetch: "خطا در دریافت لیست معاشات",
        employeeRequired: "انتخاب کارمند الزامی است",
        yearRequired: "سال الزامی است",
        monthRequired: "ماه الزامی است",
        amountRequired: "مقدار معاش الزامی است",
    },
    placeholders: {
        employee: "کارمند را انتخاب کنید",
        year: "سال را وارد کنید",
        amount: "مقدار معاش را وارد کنید",
        notes: "یادداشت را وارد کنید",
    },
};

interface SalaryManagementProps {
    onBack?: () => void;
    onNavigateToDeduction?: () => void;
}

export default function SalaryManagement({ onBack, onNavigateToDeduction }: SalaryManagementProps) {
    const [salaries, setSalaries] = useState<Salary[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [deductions, setDeductions] = useState<Deduction[]>([]);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSalary, setEditingSalary] = useState<Salary | null>(null);
    const [formData, setFormData] = useState({
        employee_id: "",
        year: getCurrentPersianYear().toString(),
        month: "",
        amount: "",
        deductions: "0",
        notes: "",
    });

    // Pagination & Search
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(10);
    const [totalItems, setTotalItems] = useState(0);
    const [search, setSearch] = useState("");
    const [sortBy, setSortBy] = useState("year");
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

            try {
                await initSalariesTable();
            } catch (err) {
                console.log("Table initialization:", err);
            }

            const [salariesResponse, employeesResponse] = await Promise.all([
                getSalaries(page, perPage, search, sortBy, sortOrder),
                getEmployees(1, 1000), // Get all employees for dropdown (up to 1000)
            ]);

            setSalaries(salariesResponse.items);
            setTotalItems(salariesResponse.total);
            setEmployees(employeesResponse.items);
        } catch (error: any) {
            toast.error(translations.errors.fetch);
            console.error("Error loading data:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = (salary?: Salary) => {
        if (salary) {
            setEditingSalary(salary);
            setFormData({
                employee_id: salary.employee_id.toString(),
                year: salary.year.toString(),
                month: salary.month,
                amount: salary.amount.toString(),
                deductions: salary.deductions.toString(),
                notes: salary.notes || "",
            });
        } else {
            setEditingSalary(null);
            setFormData({
                employee_id: "",
                year: getCurrentPersianYear().toString(),
                month: "",
                amount: "",
                deductions: "0",
                notes: "",
            });
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingSalary(null);
        setFormData({
            employee_id: "",
            year: getCurrentPersianYear().toString(),
            month: "",
            amount: "",
            deductions: "0",
            notes: "",
        });
    };

    // Auto-populate salary amount when employee is selected
    useEffect(() => {
        if (formData.employee_id && !editingSalary) {
            const selectedEmployee = employees.find(e => e.id.toString() === formData.employee_id);
            if (selectedEmployee && selectedEmployee.base_salary != null && selectedEmployee.base_salary !== undefined) {
                setFormData(prev => ({
                    ...prev,
                    amount: String(selectedEmployee.base_salary)
                }));
            }
        }
    }, [formData.employee_id, employees, editingSalary]);

    // Fetch and calculate deductions when employee, year, or month changes
    useEffect(() => {
        const fetchDeductions = async () => {
            if (formData.employee_id && formData.year && formData.month) {
                try {
                    const employeeId = parseInt(formData.employee_id);
                    const year = parseInt(formData.year);
                    const fetchedDeductions = await getDeductionsByEmployeeYearMonth(
                        employeeId,
                        year,
                        formData.month
                    );

                    setDeductions(fetchedDeductions);

                    // Calculate total deductions in AFN
                    const totalDeductions = fetchedDeductions.reduce((sum, deduction) => {
                        return sum + (deduction.amount * deduction.rate);
                    }, 0);

                    // Only auto-update deductions field when creating (not editing)
                    // This allows manual edits when editing existing salaries
                    if (!editingSalary) {
                        setFormData(prev => ({
                            ...prev,
                            deductions: totalDeductions.toFixed(2)
                        }));
                    }
                } catch (error) {
                    console.error("Error fetching deductions:", error);
                    setDeductions([]);
                    if (!editingSalary) {
                        setFormData(prev => ({
                            ...prev,
                            deductions: "0"
                        }));
                    }
                }
            } else {
                setDeductions([]);
                if (!editingSalary) {
                    setFormData(prev => ({
                        ...prev,
                        deductions: "0"
                    }));
                }
            }
        };

        fetchDeductions();
    }, [formData.employee_id, formData.year, formData.month, editingSalary]);

    // Calculate net salary
    const calculateNetSalary = () => {
        const amount = parseFloat(formData.amount) || 0;
        const deductions = parseFloat(formData.deductions) || 0;
        return Math.max(0, amount - deductions);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.employee_id) {
            toast.error(translations.errors.employeeRequired);
            return;
        }

        if (!formData.year || parseInt(formData.year) <= 0) {
            toast.error(translations.errors.yearRequired);
            return;
        }

        if (!formData.month) {
            toast.error(translations.errors.monthRequired);
            return;
        }

        if (!formData.amount || parseFloat(formData.amount) <= 0) {
            toast.error(translations.errors.amountRequired);
            return;
        }

        try {
            setLoading(true);
            if (editingSalary) {
                await updateSalary(
                    editingSalary.id,
                    parseInt(formData.employee_id),
                    parseInt(formData.year),
                    formData.month,
                    parseFloat(formData.amount),
                    parseFloat(formData.deductions) || 0,
                    formData.notes || null
                );
                toast.success(translations.success.updated);
            } else {
                await createSalary(
                    parseInt(formData.employee_id),
                    parseInt(formData.year),
                    formData.month,
                    parseFloat(formData.amount),
                    parseFloat(formData.deductions) || 0,
                    formData.notes || null
                );
                toast.success(translations.success.created);
            }
            handleCloseModal();
            await loadData();
        } catch (error: any) {
            toast.error(editingSalary ? translations.errors.update : translations.errors.create);
            console.error("Error saving salary:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: number) => {
        try {
            setLoading(true);
            await deleteSalary(id);
            toast.success(translations.success.deleted);
            setDeleteConfirm(null);
            await loadData();
        } catch (error: any) {
            toast.error(translations.errors.delete);
            console.error("Error deleting salary:", error);
        } finally {
            setLoading(false);
        }
    };



    const columns = [
        {
            key: "employee_id",
            label: translations.employee,
            sortable: false, // Cannot sort by employee name easily yet unless backend supports it directly or we join
            render: (sal: Salary) => {
                const emp = employees.find(e => e.id === sal.employee_id);
                return (
                    <div className="flex items-center gap-3">
                        {emp?.photo_path ? (
                            <img src={emp.photo_path} alt={emp.full_name} className="w-10 h-10 rounded-full object-cover border border-gray-200 dark:border-gray-700" />
                        ) : (
                            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
                                {emp?.full_name?.charAt(0) || "؟"}
                            </div>
                        )}
                        <div>
                            <div className="font-bold text-gray-900 dark:text-white">{emp?.full_name || "Unknown"}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{emp?.position}</div>
                        </div>
                    </div>
                );
            }
        },
        {
            key: "month",
            label: translations.month,
            sortable: true,
            render: (sal: Salary) => (
                <span className="font-medium text-gray-700 dark:text-gray-300">
                    {sal.month} {sal.year}
                </span>
            )
        },
        {
            key: "amount",
            label: translations.baseSalary,
            sortable: true,
            render: (sal: Salary) => (
                <span className="font-bold text-blue-600 dark:text-blue-400">
                    {sal.amount.toLocaleString()}
                </span>
            )
        },
        {
            key: "deductions",
            label: translations.deductions,
            sortable: true,
            render: (sal: Salary) => (
                <span className="font-bold text-red-600 dark:text-red-400">
                    {sal.deductions.toLocaleString()}
                </span>
            )
        },
        {
            key: "net_salary",
            label: translations.netSalary,
            sortable: false,
            render: (sal: Salary) => (
                <span className="font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded-lg">
                    {(sal.amount - sal.deductions).toLocaleString()}
                </span>
            )
        },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-6" dir="rtl">
            <div className="w-full">
                <PageHeader
                    title={translations.title}
                    onBack={onBack}
                    backLabel={translations.backToDashboard}
                    actions={[
                        ...(onNavigateToDeduction ? [{
                            label: "مدیریت کسرها",
                            onClick: onNavigateToDeduction,
                            icon: (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            ),
                            variant: "danger" as const
                        }] : []),
                        {
                            label: translations.addNew,
                            onClick: () => handleOpenModal(),
                            variant: "primary" as const
                        }
                    ]}
                />

                {/* Search Bar */}
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
                        placeholder="جستجو بر اساس سال، ماه یا نام کارمند..."
                    />
                </div>

                <Table
                    data={salaries}
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
                    actions={(sal) => (
                        <div className="flex items-center gap-2">
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleOpenModal(sal)}
                                className="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                            </motion.button>
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => setDeleteConfirm(sal.id)}
                                className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </motion.button>
                        </div>
                    )}
                />

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
                                    {editingSalary ? translations.edit : translations.addNew}
                                </h2>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.employee} <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            value={formData.employee_id}
                                            onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                                            required
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            dir="rtl"
                                        >
                                            <option value="">{translations.placeholders.employee}</option>
                                            {employees.map((employee) => (
                                                <option key={employee.id} value={employee.id}>
                                                    {employee.full_name} {employee.position ? `(${employee.position})` : ""}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.year} <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="number"
                                                value={formData.year}
                                                onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                                                required
                                                min="1300"
                                                max="1500"
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder={translations.placeholders.year}
                                                dir="ltr"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.month} <span className="text-red-500">*</span>
                                            </label>
                                            <select
                                                value={formData.month}
                                                onChange={(e) => setFormData({ ...formData, month: e.target.value })}
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                dir="rtl"
                                            >
                                                <option value="">انتخاب ماه</option>
                                                {dariMonths.map((month) => (
                                                    <option key={month} value={month}>
                                                        {month}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.amount} <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={formData.amount}
                                            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                                            required
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            placeholder={translations.placeholders.amount}
                                            dir="ltr"
                                        />
                                    </div>
                                    {deductions.length > 0 && (
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                کسرهای ثبت شده برای {formData.month} {formData.year}
                                            </label>
                                            <div className="space-y-2 p-4 bg-gray-50 dark:bg-gray-700/30 rounded-xl border border-gray-200 dark:border-gray-600">
                                                {deductions.map((deduction) => {
                                                    const total = deduction.amount * deduction.rate;
                                                    return (
                                                        <div key={deduction.id} className="flex justify-between items-center p-2 bg-white dark:bg-gray-800 rounded-lg">
                                                            <div>
                                                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                    {deduction.amount.toLocaleString()} {deduction.currency} × {deduction.rate}
                                                                </span>
                                                            </div>
                                                            <span className="text-sm font-bold text-red-600 dark:text-red-400">
                                                                {total.toLocaleString()} افغانی
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.deductions} {deductions.length > 0 && <span className="text-xs text-gray-500">(محاسبه شده از کسرهای ثبت شده)</span>}
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={formData.deductions}
                                            onChange={(e) => setFormData({ ...formData, deductions: e.target.value })}
                                            min="0"
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                            placeholder="مقدار کسر"
                                            dir="ltr"
                                            readOnly={deductions.length > 0}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.netSalary}
                                        </label>
                                        <input
                                            type="text"
                                            value={calculateNetSalary().toLocaleString()}
                                            readOnly
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 font-bold"
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

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
    initExtendedUsersTable,
    getUsers,
    createUser,
    updateUser,
    deleteUser,
    toggleUserStatus,
    getUserStats,
    type User,
    type UserFormData,
} from "../utils/user";
import { isDatabaseOpen, openDatabase } from "../utils/db";
import Footer from "./Footer";
import PageHeader from "./common/PageHeader";
import Table from "./common/Table";
import { Edit2, Trash2, Power, Mail, Phone, User as UserIcon } from "lucide-react";

// Dari translations
const translations = {
    title: "مدیریت کاربران",
    addNew: "افزودن کاربر جدید",
    edit: "ویرایش",
    delete: "حذف",
    cancel: "لغو",
    save: "ذخیره",
    search: "جستجو...",
    username: "نام کاربری",
    email: "ایمیل",
    password: "رمز عبور",
    confirmPassword: "تأیید رمز عبور",
    fullName: "نام کامل",
    phone: "شماره تماس",
    role: "نقش",
    status: "وضعیت",
    active: "فعال",
    inactive: "غیرفعال",
    actions: "عملیات",
    createdAt: "تاریخ ایجاد",
    updatedAt: "آخرین بروزرسانی",
    noUsers: "هیچ کاربری ثبت نشده است",
    confirmDelete: "آیا از حذف این کاربر اطمینان دارید؟",
    backToDashboard: "بازگشت به داشبورد",
    roles: {
        admin: "مدیر",
        user: "کاربر",
        editor: "ویرایشگر",
    },
    stats: {
        total: "مجموع کاربران",
        active: "کاربران فعال",
        inactive: "کاربران غیرفعال",
        admins: "مدیران",
    },
    success: {
        created: "کاربر با موفقیت ایجاد شد",
        updated: "کاربر با موفقیت بروزرسانی شد",
        deleted: "کاربر با موفقیت حذف شد",
        statusChanged: "وضعیت کاربر تغییر کرد",
        tableInit: "جدول کاربران با موفقیت ایجاد شد",
    },
    errors: {
        create: "خطا در ایجاد کاربر",
        update: "خطا در بروزرسانی کاربر",
        delete: "خطا در حذف کاربر",
        fetch: "خطا در دریافت کاربران",
        usernameRequired: "نام کاربری الزامی است",
        emailRequired: "ایمیل الزامی است",
        passwordRequired: "رمز عبور الزامی است",
        passwordMismatch: "رمزهای عبور مطابقت ندارند",
        passwordTooShort: "رمز عبور باید حداقل ۶ کاراکتر باشد",
    },
    placeholders: {
        username: "نام کاربری را وارد کنید",
        email: "ایمیل را وارد کنید",
        password: "رمز عبور را وارد کنید (اختیاری برای ویرایش)",
        confirmPassword: "رمز عبور را تأیید کنید",
        fullName: "نام کامل را وارد کنید (اختیاری)",
        phone: "شماره تماس را وارد کنید (اختیاری)",
        search: "جستجوی کاربران...",
    },
    profilePicture: "تصویر پروفایل",
    selectProfilePicture: "انتخاب تصویر",
    removeProfilePicture: "حذف تصویر",
};

interface UserManagementProps {
    onBack?: () => void;
    currentUser?: { id: number; username: string; email: string };
}

export default function UserManagement({ onBack, currentUser }: UserManagementProps) {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(10);
    const [total, setTotal] = useState(0);
    const [sortBy, setSortBy] = useState("created_at");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    const [stats, setStats] = useState({
        total: 0,
        active: 0,
        inactive: 0,
        admins: 0,
    });
    const [formData, setFormData] = useState<UserFormData & { confirmPassword: string }>({
        username: "",
        email: "",
        password: "",
        confirmPassword: "",
        full_name: "",
        phone: "",
        role: "user",
        is_active: true,
        profile_picture: null,
    });
    const [profilePreview, setProfilePreview] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

    useEffect(() => {
        loadUsers();
    }, [page, perPage, sortBy, sortOrder]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (page === 1) loadUsers();
            else setPage(1);
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const loadUsers = async () => {
        try {
            setLoading(true);
            const dbOpen = await isDatabaseOpen();
            if (!dbOpen) {
                await openDatabase("db");
            }

            try {
                await initExtendedUsersTable();
            } catch (err) {
                console.log("Table initialization:", err);
            }

            const response = await getUsers(page, perPage, searchQuery, sortBy, sortOrder);
            setUsers(response.items);
            setTotal(response.total);

            const userStats = await getUserStats();
            setStats(userStats);
        } catch (error: any) {
            toast.error(translations.errors.fetch);
            console.error("Error loading users:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = (user?: User) => {
        if (user) {
            setEditingUser(user);
            setFormData({
                username: user.username,
                email: user.email,
                password: "",
                confirmPassword: "",
                full_name: user.full_name || "",
                phone: user.phone || "",
                role: user.role || "user",
                is_active: user.is_active,
                profile_picture: user.profile_picture ?? null,
            });
            setProfilePreview(user.profile_picture ?? null);
        } else {
            setEditingUser(null);
            setFormData({
                username: "",
                email: "",
                password: "",
                confirmPassword: "",
                full_name: "",
                phone: "",
                role: "user",
                is_active: true,
                profile_picture: null,
            });
            setProfilePreview(null);
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingUser(null);
        setFormData({
            username: "",
            email: "",
            password: "",
            confirmPassword: "",
            full_name: "",
            phone: "",
            role: "user",
            is_active: true,
            profile_picture: null,
        });
        setProfilePreview(null);
    };

    const handleSelectProfilePicture = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (!file.type.startsWith("image/")) {
                toast.error("لطفاً یک فایل تصویری انتخاب کنید");
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                toast.error("حجم فایل نباید بیشتر از 5 مگابایت باشد");
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                setProfilePreview(result);
                setFormData((prev) => ({ ...prev, profile_picture: result }));
            };
            reader.readAsDataURL(file);
        }
    };

    const handleRemoveProfilePicture = () => {
        setProfilePreview(null);
        setFormData((prev) => ({ ...prev, profile_picture: null }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.username.trim()) {
            toast.error(translations.errors.usernameRequired);
            return;
        }

        if (!formData.email.trim()) {
            toast.error(translations.errors.emailRequired);
            return;
        }

        // Password validation only for new users or if password is being changed
        if (!editingUser && !formData.password) {
            toast.error(translations.errors.passwordRequired);
            return;
        }

        if (formData.password) {
            if (formData.password.length < 6) {
                toast.error(translations.errors.passwordTooShort);
                return;
            }

            if (formData.password !== formData.confirmPassword) {
                toast.error(translations.errors.passwordMismatch);
                return;
            }
        }

        try {
            setLoading(true);
            if (editingUser) {
                await updateUser(editingUser.id, {
                    username: formData.username,
                    email: formData.email,
                    password: formData.password || undefined,
                    full_name: formData.full_name,
                    phone: formData.phone,
                    role: formData.role,
                    is_active: formData.is_active,
                    profile_picture: formData.profile_picture ?? undefined,
                });
                toast.success(translations.success.updated);
            } else {
                await createUser({
                    username: formData.username,
                    email: formData.email,
                    password: formData.password,
                    full_name: formData.full_name,
                    phone: formData.phone,
                    role: formData.role,
                    is_active: formData.is_active,
                    profile_picture: formData.profile_picture ?? undefined,
                });
                toast.success(translations.success.created);
            }
            handleCloseModal();
            await loadUsers();
        } catch (error: any) {
            toast.error(editingUser ? translations.errors.update : translations.errors.create);
            console.error("Error saving user:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: number) => {
        try {
            setLoading(true);
            await deleteUser(id);
            toast.success(translations.success.deleted);
            setDeleteConfirm(null);
            await loadUsers();
        } catch (error: any) {
            toast.error(translations.errors.delete);
            console.error("Error deleting user:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleStatus = async (user: User) => {
        try {
            await toggleUserStatus(user.id, !user.is_active);
            toast.success(translations.success.statusChanged);
            await loadUsers();
        } catch (error: any) {
            toast.error(translations.errors.update);
            console.error("Error toggling user status:", error);
        }
    };

    const getRoleBadgeColor = (role: string) => {
        switch (role) {
            case "admin":
                return "from-red-500 to-pink-500";
            case "editor":
                return "from-amber-500 to-orange-500";
            default:
                return "from-blue-500 to-cyan-500";
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-6" dir="rtl">
            <div className="max-w-7xl mx-auto">
                <PageHeader
                    title={translations.title}
                    onBack={onBack}
                    backLabel={translations.backToDashboard}
                    actions={[
                        {
                            label: translations.addNew,
                            onClick: () => handleOpenModal(),
                            icon: (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                                </svg>
                            ),
                            variant: "primary" as const
                        }
                    ]}
                />

                {/* Stats Cards */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
                >
                    {[
                        { label: translations.stats.total, value: stats.total, icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z", color: "from-purple-500 to-indigo-500" },
                        { label: translations.stats.active, value: stats.active, icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z", color: "from-green-500 to-emerald-500" },
                        { label: translations.stats.inactive, value: stats.inactive, icon: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z", color: "from-red-500 to-pink-500" },
                        { label: translations.stats.admins, value: stats.admins, icon: "M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z", color: "from-amber-500 to-orange-500" },
                    ].map((stat, index) => (
                        <motion.div
                            key={stat.label}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 + index * 0.1 }}
                            whileHover={{ y: -5, transition: { duration: 0.2 } }}
                            className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-lg hover:shadow-2xl p-5 border border-purple-100/50 dark:border-purple-900/30 transition-all duration-300"
                        >
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{stat.label}</p>
                                    <p className="text-3xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
                                </div>
                                <div className={`w-12 h-12 bg-gradient-to-br ${stat.color} rounded-xl flex items-center justify-center shadow-lg`}>
                                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={stat.icon} />
                                    </svg>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </motion.div>

                {/* Search Bar */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="mb-6"
                >
                    <div className="relative">
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pr-12 pl-4 py-4 rounded-2xl border-2 border-gray-200 dark:border-gray-600 bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-200 dark:focus:ring-purple-900/30 transition-all duration-200 shadow-lg"
                            placeholder={translations.placeholders.search}
                            dir="rtl"
                        />
                    </div>
                </motion.div>

                {/* Users List */}
                <Table<User>
                    data={users}
                    columns={[
                        {
                            key: "username",
                            label: translations.username,
                            sortable: true,
                            render: (user) => (
                                <div className="flex items-center gap-3">
                                    {user.profile_picture ? (
                                        <img
                                            src={user.profile_picture}
                                            alt={user.username}
                                            className="w-10 h-10 rounded-lg object-cover shadow-sm border border-gray-200 dark:border-gray-600"
                                        />
                                    ) : (
                                        <div className={`w-10 h-10 bg-gradient-to-br ${user.is_active ? 'from-purple-500 to-blue-500' : 'from-gray-400 to-gray-500'} rounded-lg flex items-center justify-center text-white font-bold shadow-sm`}>
                                            {user.username.charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    <div>
                                        <div className="font-bold text-gray-900 dark:text-white">
                                            {user.full_name || user.username}
                                        </div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">@{user.username}</div>
                                    </div>
                                </div>
                            )
                        },
                        {
                            key: "email",
                            label: translations.email,
                            sortable: true,
                            render: (user) => (
                                <div className="flex items-center gap-2" dir="ltr">
                                    <Mail className="w-4 h-4 text-gray-400" />
                                    <span>{user.email}</span>
                                </div>
                            )
                        },
                        {
                            key: "phone",
                            label: translations.phone,
                            sortable: true,
                            render: (user) => (
                                user.phone ? (
                                    <div className="flex items-center gap-2" dir="ltr">
                                        <Phone className="w-4 h-4 text-gray-400" />
                                        <span>{user.phone}</span>
                                    </div>
                                ) : <span className="text-gray-400 cursor-default">---</span>
                            )
                        },
                        {
                            key: "role",
                            label: translations.role,
                            sortable: true,
                            render: (user) => (
                                <span className={`px-2 py-1 text-[10px] font-bold text-white rounded-full bg-gradient-to-r ${getRoleBadgeColor(user.role)}`}>
                                    {translations.roles[user.role as keyof typeof translations.roles] || user.role}
                                </span>
                            )
                        },
                        {
                            key: "is_active",
                            label: translations.status,
                            sortable: true,
                            render: (user) => (
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${user.is_active ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                                    <span className={user.is_active ? 'text-green-600 dark:text-green-400 font-medium' : 'text-red-600 dark:text-red-400 font-medium'}>
                                        {user.is_active ? translations.active : translations.inactive}
                                    </span>
                                </div>
                            )
                        },
                        {
                            key: "created_at",
                            label: translations.createdAt,
                            sortable: true,
                            render: (user) => new Date(user.created_at).toLocaleDateString("fa-IR")
                        }
                    ]}
                    total={total}
                    page={page}
                    perPage={perPage}
                    onPageChange={setPage}
                    onPerPageChange={setPerPage}
                    onSort={(key, order) => {
                        setSortBy(key);
                        setSortOrder(order);
                    }}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    loading={loading}
                    actions={(user) => (
                        <div className="flex items-center gap-2">
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleToggleStatus(user)}
                                disabled={currentUser?.id === user.id}
                                className={`p-2 rounded-lg text-white shadow-sm disabled:opacity-30 ${user.is_active
                                    ? "bg-amber-500 hover:bg-amber-600"
                                    : "bg-emerald-500 hover:bg-emerald-600"
                                    }`}
                                title={user.is_active ? 'غیرفعال کردن' : 'فعال کردن'}
                            >
                                <Power className="w-4 h-4" />
                            </motion.button>
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleOpenModal(user)}
                                className="p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg shadow-sm"
                                title={translations.edit}
                            >
                                <Edit2 className="w-4 h-4" />
                            </motion.button>
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => setDeleteConfirm(user.id)}
                                disabled={currentUser?.id === user.id}
                                className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg shadow-sm disabled:opacity-30"
                                title={translations.delete}
                            >
                                <Trash2 className="w-4 h-4" />
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
                                <div className="flex items-center gap-4 mb-6">
                                    {profilePreview ? (
                                        <div className="relative">
                                            <img src={profilePreview} alt="پروفایل" className="w-14 h-14 rounded-xl object-cover shadow-lg border-2 border-purple-200 dark:border-purple-700" />
                                            <button
                                                type="button"
                                                onClick={handleRemoveProfilePicture}
                                                className="absolute -top-1 -left-1 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center text-xs shadow"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl flex items-center justify-center shadow-lg">
                                            <UserIcon className="w-7 h-7 text-white" />
                                        </div>
                                    )}
                                    <div>
                                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                            {editingUser ? translations.edit : translations.addNew}
                                        </h2>
                                        <p className="text-gray-600 dark:text-gray-400 text-sm">
                                            {editingUser ? "تغییر اطلاعات کاربر" : "ایجاد کاربر جدید در سیستم"}
                                        </p>
                                    </div>
                                </div>

                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                            {translations.profilePicture}
                                        </label>
                                        <div className="flex items-center gap-4">
                                            {profilePreview ? (
                                                <div className="relative inline-block">
                                                    <img src={profilePreview} alt="پروفایل" className="w-20 h-20 rounded-xl object-cover border-2 border-gray-200 dark:border-gray-600" />
                                                    <button
                                                        type="button"
                                                        onClick={handleRemoveProfilePicture}
                                                        className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center text-xs"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            ) : (
                                                <label className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer hover:border-purple-500 dark:hover:border-purple-400 transition-colors bg-gray-50 dark:bg-gray-700/50">
                                                    <UserIcon className="w-8 h-8 text-gray-400" />
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={handleSelectProfilePicture}
                                                    />
                                                </label>
                                            )}
                                            {!profilePreview && (
                                                <span className="text-sm text-gray-500 dark:text-gray-400">{translations.selectProfilePicture}</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.username} <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={formData.username}
                                                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder={translations.placeholders.username}
                                                dir="ltr"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.email} <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="email"
                                                value={formData.email}
                                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder={translations.placeholders.email}
                                                dir="ltr"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.password} {!editingUser && <span className="text-red-500">*</span>}
                                            </label>
                                            <input
                                                type="password"
                                                value={formData.password}
                                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                                required={!editingUser}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder={translations.placeholders.password}
                                                dir="ltr"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.confirmPassword} {!editingUser && <span className="text-red-500">*</span>}
                                            </label>
                                            <input
                                                type="password"
                                                value={formData.confirmPassword}
                                                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                                required={!editingUser}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder={translations.placeholders.confirmPassword}
                                                dir="ltr"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.fullName}
                                            </label>
                                            <input
                                                type="text"
                                                value={formData.full_name}
                                                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder={translations.placeholders.fullName}
                                                dir="rtl"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.phone}
                                            </label>
                                            <input
                                                type="tel"
                                                value={formData.phone}
                                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder={translations.placeholders.phone}
                                                dir="ltr"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.role}
                                            </label>
                                            <select
                                                value={formData.role}
                                                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                dir="rtl"
                                            >
                                                <option value="user">{translations.roles.user}</option>
                                                <option value="editor">{translations.roles.editor}</option>
                                                <option value="admin">{translations.roles.admin}</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.status}
                                            </label>
                                            <div className="flex items-center gap-4 h-12">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        checked={formData.is_active}
                                                        onChange={() => setFormData({ ...formData, is_active: true })}
                                                        className="w-5 h-5 text-purple-600 focus:ring-purple-500 border-gray-300"
                                                    />
                                                    <span className="text-gray-700 dark:text-gray-300 font-medium">{translations.active}</span>
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        checked={!formData.is_active}
                                                        onChange={() => setFormData({ ...formData, is_active: false })}
                                                        className="w-5 h-5 text-purple-600 focus:ring-purple-500 border-gray-300"
                                                    />
                                                    <span className="text-gray-700 dark:text-gray-300 font-medium">{translations.inactive}</span>
                                                </label>
                                            </div>
                                        </div>
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

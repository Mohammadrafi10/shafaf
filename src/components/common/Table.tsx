import { motion, AnimatePresence } from "framer-motion";
import { ChevronUp, ChevronDown } from "lucide-react";
import Pagination from "./Pagination";

interface Column<T> {
    key: keyof T | string;
    label: string;
    sortable?: boolean;
    render?: (item: T) => React.ReactNode;
    className?: string; // For custom width or alignment
}

interface TableProps<T> {
    data: T[];
    columns: Column<T>[];
    total: number;
    page: number;
    perPage: number;
    onPageChange: (page: number) => void;
    onPerPageChange: (perPage: number) => void;
    onSort?: (key: string, direction: "asc" | "desc") => void;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    loading?: boolean;
    actions?: (item: T) => React.ReactNode;
}

export default function Table<T extends { id: number | string }>({
    data,
    columns,
    total,
    page,
    perPage,
    onPageChange,
    onPerPageChange,
    onSort,
    sortBy,
    sortOrder,
    loading,
    actions,
}: TableProps<T>) {
    const handleSort = (key: string) => {
        if (!onSort) return;
        if (sortBy === key) {
            onSort(key, sortOrder === "asc" ? "desc" : "asc");
        } else {
            onSort(key, "asc");
        }
    };

    return (
        <div className="w-full space-y-4">
            <div className="overflow-x-auto rounded-3xl border border-gray-100 dark:border-gray-700/50 shadow-xl bg-white/50 dark:bg-gray-800/50 backdrop-blur-xl">
                <table className="w-full">
                    <thead>
                        <tr className="bg-gray-50/50 dark:bg-gray-900/30 border-b border-gray-100 dark:border-gray-700/50">
                            {columns.map((col, idx) => (
                                <th
                                    key={idx}
                                    className={`px-6 py-4 text-right text-sm font-semibold text-gray-600 dark:text-gray-300 ${col.sortable ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors" : ""
                                        } ${col.className || ""}`}
                                    onClick={() => col.sortable && handleSort(col.key as string)}
                                >
                                    <div className="flex items-center gap-2">
                                        {col.label}
                                        {col.sortable && sortBy === col.key && (
                                            <span className="text-purple-600 dark:text-purple-400">
                                                {sortOrder === "asc" ? (
                                                    <ChevronUp className="w-4 h-4" />
                                                ) : (
                                                    <ChevronDown className="w-4 h-4" />
                                                )}
                                            </span>
                                        )}
                                        {col.sortable && sortBy !== col.key && (
                                            <span className="text-gray-400 opacity-0 group-hover:opacity-50">
                                                <ChevronDown className="w-4 h-4" />
                                            </span>
                                        )}
                                    </div>
                                </th>
                            ))}
                            {actions && <th className="px-6 py-4 text-right text-sm font-semibold text-gray-600 dark:text-gray-300">عملیات</th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700/30">
                        {loading ? (
                            <tr>
                                <td colSpan={columns.length + (actions ? 1 : 0)} className="py-20 text-center">
                                    <motion.div
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                        className="w-8 h-8 mx-auto border-2 border-purple-600 border-t-transparent rounded-full"
                                    />
                                </td>
                            </tr>
                        ) : data.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length + (actions ? 1 : 0)} className="py-20 text-center text-gray-500 dark:text-gray-400">
                                    هیچ داده‌ای یافت نشد
                                </td>
                            </tr>
                        ) : (
                            <AnimatePresence>
                                {data.map((item, index) => (
                                    <motion.tr
                                        key={item.id}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        transition={{ delay: index * 0.05 }}
                                        className="group hover:bg-purple-50/50 dark:hover:bg-gray-700/30 transition-colors"
                                    >
                                        {columns.map((col, idx) => (
                                            <td key={idx} className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                                                {col.render ? col.render(item) : (item[col.key as keyof T] as React.ReactNode)}
                                            </td>
                                        ))}
                                        {actions && (
                                            <td className="px-6 py-4">
                                                {actions(item)}
                                            </td>
                                        )}
                                    </motion.tr>
                                ))}
                            </AnimatePresence>
                        )}
                    </tbody>
                </table>
            </div>

            <Pagination
                total={total}
                page={page}
                perPage={perPage}
                onPageChange={onPageChange}
                onPerPageChange={onPerPageChange}
            />
        </div>
    );
}

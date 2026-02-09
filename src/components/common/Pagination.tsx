import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

interface PaginationProps {
    total: number;
    page: number;
    perPage: number;
    onPageChange: (page: number) => void;
    onPerPageChange: (perPage: number) => void;
}

export default function Pagination({
    total,
    page,
    perPage,
    onPageChange,
    onPerPageChange,
}: PaginationProps) {
    const totalPages = Math.ceil(total / perPage);

    if (total <= 0) return null;

    return (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <span>نمایش</span>
                <select
                    value={perPage}
                    onChange={(e) => onPerPageChange(Number(e.target.value))}
                    className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                </select>
                <span>مورد از {total}</span>
            </div>

            <div className="flex items-center gap-2 bg-white dark:bg-gray-800 p-1 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                <button
                    onClick={() => onPageChange(1)}
                    disabled={page === 1}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-gray-600 dark:text-gray-300"
                >
                    <ChevronsRight className="w-5 h-5" />
                </button>
                <button
                    onClick={() => onPageChange(page - 1)}
                    disabled={page === 1}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-gray-600 dark:text-gray-300"
                >
                    <ChevronRight className="w-5 h-5" />
                </button>

                <div className="flex items-center gap-1 px-2">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let p = page;
                        if (page < 3) p = i + 1;
                        else if (page > totalPages - 2) p = totalPages - 4 + i;
                        else p = page - 2 + i;

                        if (p < 1) p = 1;
                        if (p > totalPages) return null;

                        return (
                            <button
                                key={p}
                                onClick={() => onPageChange(p)}
                                className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${page === p
                                    ? "bg-purple-600 text-white shadow-lg shadow-purple-500/30"
                                    : "hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                                    }`}
                            >
                                {p}
                            </button>
                        );
                    })}
                </div>

                <button
                    onClick={() => onPageChange(page + 1)}
                    disabled={page === totalPages}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-gray-600 dark:text-gray-300"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                    onClick={() => onPageChange(totalPages)}
                    disabled={page === totalPages}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent transition-colors text-gray-600 dark:text-gray-300"
                >
                    <ChevronsLeft className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}

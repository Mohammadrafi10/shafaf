import { motion, AnimatePresence } from "framer-motion";
import Pagination from "./Pagination";

interface ThumbnailGridProps<T extends { id: number | string }> {
    data: T[];
    total: number;
    page: number;
    perPage: number;
    onPageChange: (page: number) => void;
    onPerPageChange: (perPage: number) => void;
    loading?: boolean;
    renderCard: (item: T) => React.ReactNode;
}

export default function ThumbnailGrid<T extends { id: number | string }>({
    data,
    total,
    page,
    perPage,
    onPageChange,
    onPerPageChange,
    loading,
    renderCard,
}: ThumbnailGridProps<T>) {
    return (
        <div className="w-full space-y-4">
            <div className="overflow-hidden rounded-3xl border border-gray-100 dark:border-gray-700/50 shadow-xl bg-white/50 dark:bg-gray-800/50 backdrop-blur-xl p-4">
                {loading ? (
                    <div className="py-20 flex justify-center">
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            className="w-8 h-8 border-2 border-purple-600 border-t-transparent rounded-full"
                        />
                    </div>
                ) : data.length === 0 ? (
                    <div className="py-20 text-center text-gray-500 dark:text-gray-400">
                        هیچ داده‌ای یافت نشد
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        <AnimatePresence>
                            {data.map((item, index) => (
                                <motion.div
                                    key={item.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    transition={{ delay: index * 0.03 }}
                                >
                                    {renderCard(item)}
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
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

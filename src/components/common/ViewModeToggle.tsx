import { List, LayoutGrid } from "lucide-react";
import { motion } from "framer-motion";

export type ViewMode = "table" | "thumbnail";

interface ViewModeToggleProps {
    viewMode: ViewMode;
    onChange: (mode: ViewMode) => void;
    tableLabel?: string;
    thumbnailLabel?: string;
}

export default function ViewModeToggle({
    viewMode,
    onChange,
    tableLabel = "لیست",
    thumbnailLabel = "کارت",
}: ViewModeToggleProps) {
    return (
        <div className="flex items-center gap-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-1 shadow-sm">
            <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => onChange("table")}
                title={tableLabel}
                className={`p-2.5 rounded-lg transition-colors ${viewMode === "table"
                    ? "bg-purple-600 text-white shadow-md"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300"
                    }`}
            >
                <List className="w-5 h-5" />
            </motion.button>
            <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => onChange("thumbnail")}
                title={thumbnailLabel}
                className={`p-2.5 rounded-lg transition-colors ${viewMode === "thumbnail"
                    ? "bg-purple-600 text-white shadow-md"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300"
                    }`}
            >
                <LayoutGrid className="w-5 h-5" />
            </motion.button>
        </div>
    );
}

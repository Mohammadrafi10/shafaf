import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Search } from "lucide-react";

export interface SearchableSelectOption {
  id: number;
  label: string;
  [key: string]: unknown;
}

interface SearchableSelectProps<T> {
  options: T[];
  value: number;
  onChange: (value: number) => void;
  getOptionLabel: (option: T) => string;
  getOptionValue: (option: T) => number;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  dir?: "rtl" | "ltr";
  /** Optional extra line under each option (e.g. stock) */
  renderOptionExtra?: (option: T) => React.ReactNode;
}

export default function SearchableSelect<T>({
  options,
  value,
  onChange,
  getOptionLabel,
  getOptionValue,
  placeholder = "انتخاب کنید",
  searchPlaceholder = "جستجو بر اساس نام یا بارکد...",
  className = "",
  dir = "rtl",
  renderOptionExtra,
}: SearchableSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => getOptionValue(o) === value);
  const displayLabel = selectedOption ? getOptionLabel(selectedOption) : placeholder;

  const filteredOptions = options.filter((opt) => {
    const label = getOptionLabel(opt).toLowerCase();
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return label.includes(q);
  });

  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownRect({
        top: rect.bottom,
        left: rect.left,
        width: rect.width,
      });
    } else {
      setDropdownRect(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inContainer = containerRef.current?.contains(target);
      const inDropdown = dropdownRef.current?.contains(target);
      if (!inContainer && !inDropdown) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Update dropdown position on scroll/resize when open
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const updatePos = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDropdownRect({
          top: rect.bottom,
          left: rect.left,
          width: rect.width,
        });
      }
    };
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [isOpen]);

  const handleSelect = (opt: T) => {
    onChange(getOptionValue(opt));
    setIsOpen(false);
    setSearchQuery("");
  };

  return (
    <div ref={containerRef} className={`relative ${className}`} dir={dir}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500 flex items-center justify-between gap-2 text-right"
      >
        <span className="truncate flex-1">
          {displayLabel}
        </span>
        <ChevronDown
          className={`w-4 h-4 flex-shrink-0 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && dropdownRect && createPortal(
        <AnimatePresence>
          <motion.div
            ref={dropdownRef}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="fixed z-[9999] py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl max-h-64 flex flex-col"
            style={{
              top: dropdownRect.top,
              left: dropdownRect.left,
              width: dropdownRect.width,
            }}
          >
            <div className="p-2 border-b border-gray-200 dark:border-gray-600 sticky top-0 bg-white dark:bg-gray-800">
              <div className="relative">
                <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full pr-8 pl-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500"
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              </div>
            </div>
            <div className="overflow-y-auto flex-1 min-h-0">
              {filteredOptions.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  موردی یافت نشد
                </div>
              ) : (
                filteredOptions.map((opt) => {
                  const optValue = getOptionValue(opt);
                  const isSelected = optValue === value;
                  return (
                    <button
                      key={optValue}
                      type="button"
                      onClick={() => handleSelect(opt)}
                      className={`w-full px-3 py-2 text-right text-sm hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors ${
                        isSelected
                          ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium"
                          : "text-gray-900 dark:text-white"
                      }`}
                    >
                      <span className="block truncate">{getOptionLabel(opt)}</span>
                      {renderOptionExtra && (
                        <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {renderOptionExtra(opt)}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

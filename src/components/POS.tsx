import { useEffect, useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import PageHeader from "./common/PageHeader";
import { Search } from "lucide-react";
import { isDatabaseOpen, openDatabase } from "../utils/db";
import { getProducts, type Product } from "../utils/product";
import { getCustomers, createCustomer, type Customer } from "../utils/customer";
import { getUnits, type Unit } from "../utils/unit";
import { getCurrencies, type Currency } from "../utils/currency";
import { getServices, initServicesTable, type Service } from "../utils/service";
import { getAccounts, initAccountsTable, type Account } from "../utils/account";
import {
    createSale,
    getSale,
    getSalePayments,
    getProductBatches,
    getProductStock,
    type ProductBatch,
    type SaleItemInput,
    type SaleServiceItemInput,
    type SaleWithItems,
    type SalePayment,
    type ProductStock as ProductStockSummary,
} from "../utils/sales";
import { formatPersianDate, getCurrentPersianDate, persianToGeorgian } from "../utils/date";
import SaleInvoice from "./SaleInvoice";
import Footer from "./Footer";

interface POSProps {
    onBack?: () => void;
}

type PosSaleType = "retail" | "wholesale";

interface PosCartItem {
    product: Product;
    batch: ProductBatch | null;
    unit: Unit | null;
    saleType: PosSaleType;
    quantity: number;
    perPrice: number;
    discountType: "percent" | "fixed" | null;
    discountValue: number;
}

interface PosServiceItem {
    catalogId: number | null;
    name: string;
    price: number;
    quantity: number;
    discountType: "percent" | "fixed" | null;
    discountValue: number;
}

const translations = {
    title: "فروش سریع (POS)",
    backToDashboard: "بازگشت به داشبورد",
    searchPlaceholder: "جستجوی محصول (نام یا بارکد)...",
    products: "محصولات",
    cart: "سبد خرید",
    quantity: "تعداد",
    price: "قیمت",
    total: "جمع",
    subtotal: "جمع جزء",
    discount: "تخفیف",
    discountType: "نوع تخفیف",
    fixed: "مبلغ ثابت",
    percent: "درصد",
    totalAfterDiscount: "جمع پس از تخفیف",
    paidAmount: "مبلغ پرداختی",
    remainingAmount: "باقیمانده",
    change: "پس‌داد",
    checkout: "تکمیل فروش",
    customer: "مشتری",
    walkInCustomer: "مشتری راه‌رو",
    selectCustomer: "انتخاب مشتری (اختیاری)",
    currency: "ارز",
    account: "حساب",
    date: "تاریخ",
    notes: "یادداشت (اختیاری)",
    remove: "حذف",
    clearCart: "خالی کردن سبد",
    emptyCart: "سبد خالی است",
    available: "موجودی",
    unit: "واحد",
    retail: "پرچون",
    wholesale: "کلان",
    services: "خدمات",
    addService: "افزودن خدمت",
    emptyServices: "هیچ خدمتی اضافه نشده است",
    selectService: "انتخاب خدمت",
    serviceName: "نام خدمت",
    servicePrice: "قیمت خدمت",
    quantityShort: "تعداد",
    errors: {
        load: "خطا در بارگذاری اطلاعات",
        checkoutEmpty: "سبد خرید خالی است",
        invalidPaid: "مبلغ پرداختی نامعتبر است",
        missingCurrency: "انتخاب ارز الزامی است",
        missingAccount: "انتخاب حساب برای پرداخت الزامی است",
        stockExceeded: "مقدار از موجودی بیشتر است",
        missingDate: "تاریخ الزامی است",
        missingService: "انتخاب خدمت الزامی است",
    },
    success: {
        saleCompleted: "فروش با موفقیت ثبت شد",
    },
    receiptTitle: "رسید فروش",
    keyboardShortcuts: "کلیدهای میانبر",
    shortcutsHelp: "F2: جستجو، F9: تکمیل فروش، Delete: حذف آیتم انتخاب‌شده",
};

function computeLineDiscountAmount(
    subtotal: number,
    discountType: "percent" | "fixed" | null,
    discountValue: number
): number {
    if (subtotal <= 0 || !discountType || !discountValue) return 0;
    const v = Number(discountValue) || 0;
    if (discountType === "percent") {
        return Math.round((subtotal * Math.min(100, Math.max(0, v)) / 100) * 100) / 100;
    }
    if (discountType === "fixed") {
        return Math.round(Math.min(v, subtotal) * 100) / 100;
    }
    return 0;
}

export default function POS({ onBack }: POSProps) {
    const [loading, setLoading] = useState(false);
    const [products, setProducts] = useState<Product[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [units, setUnits] = useState<Unit[]>([]);
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [servicesCatalog, setServicesCatalog] = useState<Service[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [productBatches, setProductBatches] = useState<Record<number, ProductBatch[]>>({});
    const [productStocks, setProductStocks] = useState<Record<number, ProductStockSummary>>({});

    const [search, setSearch] = useState("");
    const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
    const [selectedCurrencyId, setSelectedCurrencyId] = useState<number | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
    const [date, setDate] = useState(
        persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split("T")[0]
    );
    const [notes, setNotes] = useState("");

    const [cartItems, setCartItems] = useState<PosCartItem[]>([]);
    const [serviceItems, setServiceItems] = useState<PosServiceItem[]>([]);

    const [orderDiscountType, setOrderDiscountType] = useState<"percent" | "fixed" | "">("");
    const [orderDiscountValue, setOrderDiscountValue] = useState(0);
    const [paidAmount, setPaidAmount] = useState<string>("");

    const [showReceipt, setShowReceipt] = useState(false);
    const [receiptSale, setReceiptSale] = useState<SaleWithItems | null>(null);
    const [receiptPayments, setReceiptPayments] = useState<SalePayment[]>([]);
    const [receiptCustomer, setReceiptCustomer] = useState<Customer | null>(null);
    const [baseCurrency, setBaseCurrency] = useState<Currency | null>(null);

    const filteredProducts = useMemo(() => {
        const q = search.trim();
        if (!q) return products;
        const lower = q.toLowerCase();
        return products.filter((p) => {
            const nameMatch = p.name.toLowerCase().includes(lower);
            const barcodeMatch = p.bar_code?.toLowerCase().includes(lower);
            return nameMatch || barcodeMatch;
        });
    }, [products, search]);

    const subtotal = useMemo(() => {
        const itemsTotal = cartItems.reduce((sum, item) => {
            const lineSubtotal = item.perPrice * item.quantity;
            const disc = computeLineDiscountAmount(lineSubtotal, item.discountType, item.discountValue);
            return sum + (lineSubtotal - disc);
        }, 0);
        const servicesTotal = serviceItems.reduce((sum, si) => {
            const lineSubtotal = si.price * si.quantity;
            const disc = computeLineDiscountAmount(lineSubtotal, si.discountType, si.discountValue);
            return sum + (lineSubtotal - disc);
        }, 0);
        return Math.round((itemsTotal + servicesTotal) * 100) / 100;
    }, [cartItems, serviceItems]);

    const orderDiscountAmount = useMemo(() => {
        if (!orderDiscountType || !orderDiscountValue) return 0;
        return computeLineDiscountAmount(
            subtotal,
            orderDiscountType as "percent" | "fixed",
            orderDiscountValue
        );
    }, [subtotal, orderDiscountType, orderDiscountValue]);

    const totalAfterDiscount = useMemo(() => {
        return Math.round((subtotal - orderDiscountAmount) * 100) / 100;
    }, [subtotal, orderDiscountAmount]);

    const paidAmountNumber = useMemo(() => {
        return parseFloat(paidAmount || "0") || 0;
    }, [paidAmount]);

    const remainingAmount = useMemo(() => {
        return Math.max(totalAfterDiscount - paidAmountNumber, 0);
    }, [totalAfterDiscount, paidAmountNumber]);

    const changeAmount = useMemo(() => {
        return Math.max(paidAmountNumber - totalAfterDiscount, 0);
    }, [totalAfterDiscount, paidAmountNumber]);

    const keyboardHandler = useCallback(
        (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const isInput =
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.isContentEditable ||
                target.closest("input, textarea, [contenteditable='true']");
            if (isInput) return;

            if (e.key === "F2") {
                e.preventDefault();
                const searchEl = document.getElementById("pos-product-search") as HTMLInputElement | null;
                searchEl?.focus();
            }
            if (e.key === "F9") {
                e.preventDefault();
                void handleCheckout();
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [cartItems, serviceItems, subtotal, orderDiscountType, orderDiscountValue, paidAmount, selectedCurrencyId, selectedAccountId]
    );

    useEffect(() => {
        window.addEventListener("keydown", keyboardHandler, true);
        return () => {
            window.removeEventListener("keydown", keyboardHandler, true);
        };
    }, [keyboardHandler]);

    const loadInitialData = useCallback(async () => {
        try {
            setLoading(true);
            const dbOpen = await isDatabaseOpen();
            if (!dbOpen) {
                await openDatabase("db");
            }
            try {
                await initAccountsTable();
            } catch (err) {
                console.log("Accounts table init:", err);
            }
            try {
                await initServicesTable();
            } catch (err) {
                console.log("Services table init:", err);
            }
            const [
                productsResponse,
                customersResponse,
                unitsData,
                currenciesData,
                servicesResponse,
                accountsData,
            ] = await Promise.all([
                getProducts(1, 1000),
                getCustomers(1, 1000),
                getUnits(),
                getCurrencies(),
                getServices(1, 1000, "", "name", "asc"),
                getAccounts(),
            ]);

            setProducts(productsResponse.items);
            setCustomers(customersResponse.items);
            setUnits(unitsData);
            setCurrencies(currenciesData);
            setServicesCatalog(servicesResponse.items ?? []);
            setAccounts((accountsData ?? []).filter((a) => a.is_active));

            const base = currenciesData.find((c) => c.base);
            if (base) {
                setBaseCurrency(base);
                setSelectedCurrencyId(base.id);
            }

            // Ensure we have a default walk-in customer if any customer exists
            const existingWalkIn =
                customersResponse.items.find((c) => c.full_name.includes(translations.walkInCustomer)) ||
                null;
            if (existingWalkIn) {
                setSelectedCustomerId(existingWalkIn.id);
            } else if (customersResponse.items.length > 0) {
                setSelectedCustomerId(customersResponse.items[0].id);
            }
        } catch (error) {
            console.error("Error loading POS data:", error);
            toast.error(translations.errors.load);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadInitialData();
    }, [loadInitialData]);

    const ensureBatchesLoaded = async (productId: number): Promise<ProductBatch[]> => {
        const cached = productBatches[productId];
        if (cached) return cached;
        try {
            const batches = await getProductBatches(productId);
            setProductBatches((prev) => ({ ...prev, [productId]: batches }));
            return batches;
        } catch (err) {
            console.error("Error loading batches:", err);
            toast.error("خطا در دریافت اطلاعات دسته‌ها");
            return [];
        }
    };

    const ensureStockLoaded = async (productId: number, unitId?: number | null) => {
        if (productStocks[productId] && !unitId) return;
        try {
            const stock = await getProductStock(productId, unitId ?? undefined);
            setProductStocks((prev) => ({ ...prev, [productId]: stock }));
        } catch (err) {
            console.error("Error loading product stock:", err);
        }
    };

    const getUnitByName = (name: string | null | undefined): Unit | null => {
        if (!name) return null;
        const u = units.find((x) => x.name === name);
        return u ?? null;
    };

    const getDefaultUnitForProduct = (product: Product): Unit | null => {
        // 1) Try the unit name stored on the product (same behavior as Sales form)
        const viaName = getUnitByName(product.unit);
        if (viaName) return viaName;
        // 2) Fallback to any base unit (e.g. "عدد") if available
        const baseUnit = units.find((u) => u.is_base);
        if (baseUnit) return baseUnit;
        // 3) As a last resort, use the first defined unit (keeps FK valid)
        return units.length > 0 ? units[0] : null;
    };

    const getItemStockInSaleUnit = (item: PosCartItem): number | null => {
        const product = item.product;
        if (!product) return null;
        const batchesForProduct = productBatches[product.id] || [];
        if (item.batch) {
            const batch =
                batchesForProduct.find((b) => b.purchase_item_id === item.batch?.purchase_item_id) ??
                item.batch;
            if (!batch) return null;
            if (item.saleType === "wholesale") {
                return batch.remaining_quantity;
            }
            const perUnit = batch.per_unit ?? 1;
            return batch.remaining_quantity * perUnit;
        }
        const stock = productStocks[product.id];
        if (stock) {
            return stock.total_in_unit ?? stock.total_base;
        }
        return null;
    };

    const itemExceedsStock = (item: PosCartItem): boolean => {
        const product = item.product;
        if (!product) return false;
        const batchesForProduct = productBatches[product.id] || [];
        const batch = item.batch
            ? batchesForProduct.find((b) => b.purchase_item_id === item.batch?.purchase_item_id) ??
              item.batch
            : null;
        if (batch) {
            const amount = Number(item.quantity);
            if (item.saleType === "wholesale") {
                return amount > batch.remaining_quantity;
            }
            const perUnit = batch.per_unit ?? 1;
            return amount > batch.remaining_quantity * perUnit;
        }
        const stock = productStocks[product.id];
        if (!stock) return false;
        const inUnit = stock.total_in_unit ?? stock.total_base;
        return item.quantity > inUnit;
    };

    /** Prefetch batches for all products currently in cart (e.g. after refresh or stale state). */
    useEffect(() => {
        const ids = [...new Set(cartItems.map((c) => c.product.id))];
        for (const id of ids) {
            if (!productBatches[id]) {
                void ensureBatchesLoaded(id);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- prefetch when cart product set changes; avoid loop on every productBatches update
    }, [cartItems]);

    /** When batches arrive and a line has no batch, default to oldest (same as Sales). */
    useEffect(() => {
        setCartItems((prev) => {
            let changed = false;
            const next = prev.map((item) => {
                const batches = productBatches[item.product.id];
                if (!batches?.length || item.batch) return item;
                const b = batches[0];
                const perPrice =
                    item.saleType === "wholesale"
                        ? b.wholesale_price || b.per_price
                        : b.retail_price || b.per_price;
                changed = true;
                return { ...item, batch: b, perPrice };
            });
            return changed ? next : prev;
        });
    }, [productBatches]);

    const addProductToCart = async (product: Product) => {
        const batchesForProduct = await ensureBatchesLoaded(product.id);
        await ensureStockLoaded(product.id, null);
        const defaultBatch = batchesForProduct[0] ?? null;

        const unitFromProduct = getDefaultUnitForProduct(product);
        const defaultSaleType: PosSaleType = "retail";
        const perPrice =
            defaultBatch != null
                ? defaultSaleType === "retail"
                    ? defaultBatch.retail_price || defaultBatch.per_price
                    : defaultBatch.wholesale_price || defaultBatch.per_price
                : product.price || 0;

        const existingIndex = cartItems.findIndex(
            (ci) =>
                ci.product.id === product.id &&
                ((ci.batch?.purchase_item_id ?? null) === (defaultBatch?.purchase_item_id ?? null)) &&
                ci.saleType === defaultSaleType
        );

        if (existingIndex >= 0) {
            const updated = [...cartItems];
            const candidate: PosCartItem = {
                ...updated[existingIndex],
                quantity: updated[existingIndex].quantity + 1,
            };
            if (itemExceedsStock(candidate)) {
                toast.error(translations.errors.stockExceeded);
                return;
            }
            updated[existingIndex] = candidate;
            setCartItems(updated);
        } else {
            const newItem: PosCartItem = {
                product,
                batch: defaultBatch,
                unit: unitFromProduct,
                saleType: defaultSaleType,
                quantity: 1,
                perPrice,
                discountType: null,
                discountValue: 0,
            };
            if (itemExceedsStock(newItem)) {
                toast.error(translations.errors.stockExceeded);
                return;
            }
            setCartItems((prev) => [...prev, newItem]);
        }
    };

    const updateCartItem = (index: number, changes: Partial<PosCartItem>) => {
        setCartItems((prev) => {
            const copy = [...prev];
            const updated: PosCartItem = { ...copy[index], ...changes };

            if (changes.saleType != null || changes.batch !== undefined) {
                const batchesForProduct = productBatches[updated.product.id] || [];
                const selectedBatch = updated.batch
                    ? batchesForProduct.find((b) => b.purchase_item_id === updated.batch?.purchase_item_id) ??
                      updated.batch
                    : null;
                if (selectedBatch) {
                    updated.perPrice =
                        updated.saleType === "wholesale"
                            ? selectedBatch.wholesale_price || selectedBatch.per_price
                            : selectedBatch.retail_price || selectedBatch.per_price;
                }
            }

            if (updated.quantity <= 0) {
                copy.splice(index, 1);
                return copy;
            }

            if (itemExceedsStock(updated)) {
                toast.error(translations.errors.stockExceeded);
                return prev;
            }

            copy[index] = updated;
            return copy;
        });
    };

    const removeCartItem = (index: number) => {
        setCartItems((prev) => prev.filter((_, i) => i !== index));
    };

    const clearCart = () => {
        setCartItems([]);
        setServiceItems([]);
        setOrderDiscountType("");
        setOrderDiscountValue(0);
        setPaidAmount("");
    };

    const addServiceItem = () => {
        setServiceItems((prev) => [
            ...prev,
            {
                catalogId: null,
                name: "",
                price: 0,
                quantity: 1,
                discountType: null,
                discountValue: 0,
            },
        ]);
    };

    const updateServiceItem = (index: number, changes: Partial<PosServiceItem>) => {
        setServiceItems((prev) => {
            const copy = [...prev];
            const updated: PosServiceItem = { ...copy[index], ...changes };
            if (updated.quantity <= 0) {
                copy.splice(index, 1);
                return copy;
            }
            copy[index] = updated;
            return copy;
        });
    };

    const removeServiceItem = (index: number) => {
        setServiceItems((prev) => prev.filter((_, i) => i !== index));
    };

    const findCurrencyName = (id: number | null | undefined) => {
        if (!id) return "";
        return currencies.find((c) => c.id === id)?.name ?? "";
    };

    const handleCheckout = async () => {
        if (cartItems.length === 0 && serviceItems.length === 0) {
            toast.error(translations.errors.checkoutEmpty);
            return;
        }
        if (!date) {
            toast.error(translations.errors.missingDate);
            return;
        }
        if (!selectedCurrencyId) {
            toast.error(translations.errors.missingCurrency);
            return;
        }
        if (paidAmount && paidAmountNumber < 0) {
            toast.error(translations.errors.invalidPaid);
            return;
        }

        let customerId = selectedCustomerId;
        try {
            if (!customerId) {
                const walkIn = await createCustomer(
                    translations.walkInCustomer,
                    "-",
                    "-",
                    null,
                    "ایجاد خودکار برای POS"
                );
                customerId = walkIn.id;
                setCustomers((prev) => [...prev, walkIn]);
                setSelectedCustomerId(walkIn.id);
            }
        } catch (err) {
            console.error("Error ensuring walk-in customer:", err);
        }

        if (!customerId) {
            toast.error("ایجاد مشتری راه‌رو ناموفق بود");
            return;
        }

        const itemsPayload: SaleItemInput[] = [];
        for (const ci of cartItems) {
            const resolvedUnit = ci.unit ?? getDefaultUnitForProduct(ci.product);
            if (!resolvedUnit) {
                toast.error(
                    `واحد معتبر برای محصول "${ci.product.name}" یافت نشد. لطفاً واحدها را در تنظیمات سیستم بررسی کنید.`
                );
                return;
            }
            /**
             * Backend stock: sold_base = amount * unit.ratio. Wholesale qty is in batch units;
             * retail qty is already in retail/small units. Match DB: wholesale → amount * per_unit,
             * per_price scaled so line total stays qty * wholesale_unit_price.
             */
            const perUnit = Math.max(ci.batch?.per_unit ?? 1, 1e-9);
            const isWholesaleWithBatch =
                ci.saleType === "wholesale" && ci.batch != null && (ci.batch.per_unit ?? 0) > 0;
            const amountForSale = isWholesaleWithBatch
                ? ci.quantity * perUnit
                : ci.quantity;
            const perPriceForSale = isWholesaleWithBatch ? ci.perPrice / perUnit : ci.perPrice;

            itemsPayload.push({
                product_id: ci.product.id,
                unit_id: resolvedUnit.id,
                per_price: Math.round(perPriceForSale * 1e6) / 1e6,
                amount: Math.round(amountForSale * 1e6) / 1e6,
                purchase_item_id: ci.batch?.purchase_item_id ?? null,
                sale_type: ci.saleType,
                discount_type: ci.discountType,
                discount_value: ci.discountValue,
            });
        }

        const servicePayload: SaleServiceItemInput[] = serviceItems.map((si) => ({
            service_id: (si.catalogId ?? 0),
            name: si.name,
            price: si.price,
            quantity: si.quantity,
            discount_type: si.discountType,
            discount_value: si.discountValue,
        }));

        if (serviceItems.some((s) => !s.catalogId)) {
            toast.error(translations.errors.missingService);
            return;
        }

        const orderDiscountTypeFinal =
            orderDiscountType && orderDiscountValue ? (orderDiscountType as "percent" | "fixed") : null;
        const orderDiscountValueFinal = Number(orderDiscountValue) || 0;

        try {
            setLoading(true);
            const paidForCreate = paidAmountNumber;
            const newSale = await createSale(
                customerId,
                date,
                notes || null,
                selectedCurrencyId,
                1,
                paidForCreate,
                [],
                itemsPayload,
                servicePayload,
                orderDiscountTypeFinal,
                orderDiscountValueFinal
            );

            toast.success(translations.success.saleCompleted);

            const soldProductIds = [...new Set(cartItems.map((c) => c.product.id))];
            try {
                const refreshed = await Promise.all(
                    soldProductIds.map(async (id) => {
                        try {
                            const batches = await getProductBatches(id);
                            return { id, batches } as const;
                        } catch (e) {
                            console.error(`POS: refresh batches for product ${id}:`, e);
                            return null;
                        }
                    })
                );
                setProductBatches((prev) => {
                    const next = { ...prev };
                    for (const row of refreshed) {
                        if (row) next[row.id] = row.batches;
                    }
                    return next;
                });
            } catch (e) {
                console.error("POS: batch refresh after sale:", e);
            }

            const saleData = await getSale(newSale.id);
            const salePayments = await getSalePayments(newSale.id);
            const customer = customers.find((c) => c.id === customerId) || null;

            setReceiptSale(saleData);
            setReceiptPayments(salePayments);
            setReceiptCustomer(customer);
            setShowReceipt(true);

            clearCart();
        } catch (err) {
            console.error("Error completing POS sale:", err);
            toast.error("خطا در ثبت فروش");
        } finally {
            setLoading(false);
        }
    };

    const currencyName = findCurrencyName(selectedCurrencyId ?? baseCurrency?.id);

    return (
        <div
            className="min-h-screen w-full bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4 md:p-6"
            dir="rtl"
        >
            <PageHeader title="" onBack={onBack} backLabel="" actions={[]} />

            <div className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                <span className="font-semibold">{translations.keyboardShortcuts}:</span>{" "}
                {translations.shortcutsHelp}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 items-start">
                <div className="lg:col-span-2 space-y-4">
                    <div className="relative">
                        <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                            <Search className="h-5 w-5 text-gray-400" />
                        </div>
                        <input
                            id="pos-product-search"
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="block w-full pr-10 pl-3 py-3 border border-gray-200 dark:border-gray-700 rounded-2xl leading-5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 sm:text-sm transition-all shadow-sm hover:shadow-md"
                            placeholder={translations.searchPlaceholder}
                        />
                    </div>

                    <div className="bg-white dark:bg-gray-900/80 rounded-2xl shadow-lg border border-purple-100/60 dark:border-purple-900/40 p-3 md:p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-sm md:text-base font-bold text-gray-800 dark:text-gray-100">
                                {translations.products}
                            </h2>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                {filteredProducts.length} / {products.length}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[55vh] overflow-y-auto">
                            {filteredProducts.map((product) => (
                                <motion.button
                                    key={product.id}
                                    whileHover={{ scale: 1.02, y: -2 }}
                                    whileTap={{ scale: 0.97 }}
                                    onClick={() => void addProductToCart(product)}
                                    className="flex flex-col items-stretch text-right bg-gradient-to-br from-white to-purple-50 dark:from-gray-800 dark:to-gray-900 border border-gray-100 dark:border-gray-700 rounded-2xl p-3 shadow-sm hover:shadow-md transition-all"
                                >
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between gap-1 mb-1">
                                            <span className="font-bold text-xs md:text-sm text-gray-900 dark:text-gray-100 line-clamp-2">
                                                {product.name}
                                            </span>
                                        </div>
                                        {product.bar_code && (
                                            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1 ltr">
                                                {product.bar_code}
                                            </p>
                                        )}
                                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                            {translations.unit}:{" "}
                                            <span className="font-semibold">
                                                {product.unit || "-"}
                                            </span>
                                        </p>
                                    </div>
                                </motion.button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="bg-white dark:bg-gray-900/80 rounded-2xl shadow-lg border border-purple-100/60 dark:border-purple-900/40 p-3 md:p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-sm md:text-base font-bold text-gray-800 dark:text-gray-100">
                                {translations.cart}
                            </h2>
                            {cartItems.length > 0 && (
                                <button
                                    onClick={clearCart}
                                    className="text-xs text-red-500 hover:text-red-600 dark:hover:text-red-400"
                                >
                                    {translations.clearCart}
                                </button>
                            )}
                        </div>
                        {cartItems.length === 0 ? (
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                                {translations.emptyCart}
                            </p>
                        ) : (
                            <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-1">
                                {cartItems.map((item, index) => {
                                    const stock = getItemStockInSaleUnit(item);
                                    return (
                                        <div
                                            key={`${item.product.id}-${index}`}
                                            className={`rounded-xl border p-2.5 text-xs bg-gray-50/60 dark:bg-gray-800/80 ${
                                                itemExceedsStock(item)
                                                    ? "border-amber-500"
                                                    : "border-gray-200 dark:border-gray-700"
                                            }`}
                                        >
                                                <div className="flex items-start justify-between gap-2 mb-1">
                                                    <div className="flex-1">
                                                        <p className="font-semibold text-gray-900 dark:text-gray-100 text-[11px]">
                                                            {item.product.name}
                                                        </p>
                                                        <p className="text-[10px] text-gray-500 dark:text-gray-400">
                                                            {translations.unit}:{" "}
                                                            {item.unit?.name || item.product.unit || "-"}
                                                        </p>
                                                        {stock != null && (
                                                            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                                                                {translations.available}:{" "}
                                                                {stock.toLocaleString("en-US", {
                                                                    maximumFractionDigits: 3,
                                                                })}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <button
                                                        onClick={() => removeCartItem(index)}
                                                        className="text-[10px] text-red-500 hover:text-red-600"
                                                    >
                                                        {translations.remove}
                                                    </button>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                                                    {productBatches[item.product.id] &&
                                                        productBatches[item.product.id].length > 0 && (
                                                            <div className="flex flex-col">
                                                                <span className="text-[10px] text-gray-400 mb-0.5">
                                                                    دسته (Batch)
                                                                </span>
                                                                <select
                                                                    value={
                                                                        item.batch?.purchase_item_id ?? ""
                                                                    }
                                                                    onChange={(e) => {
                                                                        const pid = parseInt(
                                                                            e.target.value,
                                                                            10
                                                                        );
                                                                        const b = productBatches[
                                                                            item.product.id
                                                                        ]?.find(
                                                                            (x) =>
                                                                                x.purchase_item_id ===
                                                                                pid
                                                                        );
                                                                        if (b) {
                                                                            updateCartItem(index, {
                                                                                batch: b,
                                                                            });
                                                                        }
                                                                    }}
                                                                    onFocus={() => {
                                                                        void ensureBatchesLoaded(
                                                                            item.product.id
                                                                        );
                                                                    }}
                                                                    className="w-full px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px]"
                                                                    dir="rtl"
                                                                >
                                                                    {productBatches[item.product.id].map(
                                                                        (batch) => (
                                                                            <option
                                                                                key={
                                                                                    batch.purchase_item_id
                                                                                }
                                                                                value={
                                                                                    batch.purchase_item_id
                                                                                }
                                                                            >
                                                                                {batch.batch_number ||
                                                                                    `دسته ${batch.purchase_item_id}`}{" "}
                                                                                - تاریخ:{" "}
                                                                                {formatPersianDate(
                                                                                    batch.purchase_date
                                                                                )}{" "}
                                                                                - موجودی:{" "}
                                                                                {batch.remaining_quantity.toLocaleString(
                                                                                    "en-US",
                                                                                    {
                                                                                        maximumFractionDigits: 3,
                                                                                    }
                                                                                )}
                                                                                {batch.expiry_date &&
                                                                                    ` - انقضا: ${formatPersianDate(batch.expiry_date)}`}
                                                                            </option>
                                                                        )
                                                                    )}
                                                                </select>
                                                            </div>
                                                        )}
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] text-gray-400 mb-0.5">
                                                            نوع فروش
                                                        </span>
                                                        <select
                                                            value={item.saleType || "retail"}
                                                            onChange={(e) =>
                                                                updateCartItem(index, {
                                                                    saleType: e.target
                                                                        .value as PosSaleType,
                                                                })
                                                            }
                                                            className="w-full px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px]"
                                                            dir="rtl"
                                                        >
                                                            <option value="retail">خرده فروشی</option>
                                                            <option value="wholesale">عمده فروشی</option>
                                                        </select>
                                                    </div>
                                                </div>
                                                {item.batch &&
                                                    item.batch.purchase_item_id &&
                                                    productBatches[item.product.id] && (
                                                        <div className="mb-2 p-2 bg-blue-50/80 dark:bg-blue-900/20 rounded-lg text-[10px] text-gray-700 dark:text-gray-300">
                                                            {(() => {
                                                                const batch =
                                                                    productBatches[
                                                                        item.product.id
                                                                    ].find(
                                                                        (b) =>
                                                                            b.purchase_item_id ===
                                                                            item.batch?.purchase_item_id
                                                                    ) ?? item.batch;
                                                                if (!batch) return null;
                                                                return (
                                                                    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                                                                        <div>
                                                                            <span className="font-semibold">
                                                                                تاریخ خرید:
                                                                            </span>{" "}
                                                                            {formatPersianDate(
                                                                                batch.purchase_date
                                                                            )}
                                                                        </div>
                                                                        {batch.expiry_date && (
                                                                            <div>
                                                                                <span className="font-semibold">
                                                                                    تاریخ انقضا:
                                                                                </span>{" "}
                                                                                {formatPersianDate(
                                                                                    batch.expiry_date
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                        <div>
                                                                            <span className="font-semibold">
                                                                                موجودی:
                                                                            </span>{" "}
                                                                            {batch.remaining_quantity.toLocaleString()}
                                                                        </div>
                                                                        <div>
                                                                            <span className="font-semibold">
                                                                                قیمت خرید:
                                                                            </span>{" "}
                                                                            {batch.per_price.toLocaleString()}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })()}
                                                        </div>
                                                    )}
                                                <div className="grid grid-cols-3 gap-2 items-center">
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] text-gray-400">
                                                            {translations.quantity}
                                                        </span>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            step={item.saleType === "wholesale" ? 1 : 0.01}
                                                            value={item.quantity}
                                                            onChange={(e) =>
                                                                updateCartItem(index, {
                                                                    quantity:
                                                                        parseFloat(e.target.value || "0") ||
                                                                        0,
                                                                })
                                                            }
                                                            className="w-full px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px]"
                                                            dir="ltr"
                                                        />
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] text-gray-400">
                                                            {translations.price}
                                                        </span>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            step={0.01}
                                                            value={item.perPrice}
                                                            onChange={(e) =>
                                                                updateCartItem(index, {
                                                                    perPrice:
                                                                        parseFloat(e.target.value || "0") ||
                                                                        0,
                                                                })
                                                            }
                                                            className="w-full px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px]"
                                                            dir="ltr"
                                                        />
                                                    </div>
                                                    <div className="flex flex-col text-left">
                                                        <span className="text-[10px] text-gray-400">
                                                            {translations.total}
                                                        </span>
                                                        <span className="font-bold text-[12px] text-purple-600 dark:text-purple-300 ltr">
                                                            {(
                                                                item.perPrice * item.quantity -
                                                                computeLineDiscountAmount(
                                                                    item.perPrice * item.quantity,
                                                                    item.discountType,
                                                                    item.discountValue
                                                                )
                                                            ).toLocaleString("en-US", {
                                                                maximumFractionDigits: 2,
                                                            })}
                                                        </span>
                                                    </div>
                                                </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="bg-white dark:bg-gray-900/80 rounded-2xl shadow-lg border border-purple-100/60 dark:border-purple-900/40 p-3 md:p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-sm md:text-base font-bold text-gray-800 dark:text-gray-100">
                                {translations.services}
                            </h2>
                            <button
                                type="button"
                                onClick={addServiceItem}
                                className="text-xs font-semibold text-purple-600 dark:text-purple-300 hover:text-purple-700 dark:hover:text-purple-200"
                            >
                                {translations.addService}
                            </button>
                        </div>

                        {serviceItems.length === 0 ? (
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                                {translations.emptyServices}
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {serviceItems.map((si, index) => {
                                    const lineSubtotal = si.price * si.quantity;
                                    const disc = computeLineDiscountAmount(lineSubtotal, si.discountType, si.discountValue);
                                    const total = Math.round((lineSubtotal - disc) * 100) / 100;
                                    return (
                                        <div
                                            key={`service-${index}`}
                                            className="rounded-xl border border-gray-200 dark:border-gray-700 p-2.5 text-xs bg-gray-50/60 dark:bg-gray-800/80"
                                        >
                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                <p className="font-semibold text-gray-900 dark:text-gray-100 text-[11px]">
                                                    {translations.services} {index + 1}
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={() => removeServiceItem(index)}
                                                    className="text-[10px] text-red-500 hover:text-red-600"
                                                >
                                                    {translations.remove}
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] text-gray-400">
                                                        {translations.selectService}
                                                    </span>
                                                    <select
                                                        value={si.catalogId ?? ""}
                                                        onChange={(e) => {
                                                            const nextId = e.target.value ? parseInt(e.target.value, 10) : null;
                                                            const svc = nextId ? servicesCatalog.find((s) => s.id === nextId) ?? null : null;
                                                            updateServiceItem(index, {
                                                                catalogId: nextId,
                                                                name: svc?.name ?? "",
                                                                price: svc?.price ?? 0,
                                                            });
                                                        }}
                                                        className="w-full px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px]"
                                                    >
                                                        <option value="">{translations.selectService}</option>
                                                        {servicesCatalog
                                                            .filter((s) => !selectedCurrencyId || s.currency_id == null || s.currency_id === selectedCurrencyId)
                                                            .map((s) => (
                                                                <option key={s.id} value={s.id}>
                                                                    {s.name}
                                                                </option>
                                                            ))}
                                                    </select>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] text-gray-400">
                                                        {translations.servicePrice}
                                                    </span>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={0.01}
                                                        value={si.price}
                                                        onChange={(e) =>
                                                            updateServiceItem(index, {
                                                                price: parseFloat(e.target.value || "0") || 0,
                                                            })
                                                        }
                                                        className="w-full px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px]"
                                                        dir="ltr"
                                                    />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] text-gray-400">
                                                        {translations.quantityShort}
                                                    </span>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={1}
                                                        value={si.quantity}
                                                        onChange={(e) =>
                                                            updateServiceItem(index, {
                                                                quantity: parseFloat(e.target.value || "0") || 0,
                                                            })
                                                        }
                                                        className="w-full px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px]"
                                                        dir="ltr"
                                                    />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] text-gray-400">
                                                        {translations.discountType}
                                                    </span>
                                                    <div className="flex gap-2">
                                                        <select
                                                            value={si.discountType ?? ""}
                                                            onChange={(e) =>
                                                                updateServiceItem(index, {
                                                                    discountType: (e.target.value as "percent" | "fixed" | "") || null,
                                                                    discountValue: 0,
                                                                })
                                                            }
                                                            className="w-full px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px]"
                                                        >
                                                            <option value="">{translations.discountType}</option>
                                                            <option value="percent">{translations.percent}</option>
                                                            <option value="fixed">{translations.fixed}</option>
                                                        </select>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            step={0.01}
                                                            value={si.discountType ? si.discountValue : 0}
                                                            onChange={(e) =>
                                                                updateServiceItem(index, {
                                                                    discountValue: parseFloat(e.target.value || "0") || 0,
                                                                })
                                                            }
                                                            disabled={!si.discountType}
                                                            className="w-24 px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px] disabled:opacity-60"
                                                            dir="ltr"
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="mt-2 flex items-center justify-between">
                                                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                                                    {translations.total}
                                                </span>
                                                <span className="font-bold text-[12px] text-purple-600 dark:text-purple-300 ltr">
                                                    {total.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                        <div className="bg-white dark:bg-gray-900/80 rounded-2xl shadow-lg border border-purple-100/60 dark:border-purple-900/40 p-3 md:p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="flex flex-col">
                                    <label className="mb-1 text-gray-500 dark:text-gray-400">
                                        {translations.customer}
                                    </label>
                                    <select
                                        value={selectedCustomerId ?? ""}
                                        onChange={(e) =>
                                            setSelectedCustomerId(
                                                e.target.value ? parseInt(e.target.value, 10) : null
                                            )
                                        }
                                        className="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px]"
                                    >
                                        <option value="">{translations.selectCustomer}</option>
                                        {customers.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.full_name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex flex-col">
                                    <label className="mb-1 text-gray-500 dark:text-gray-400">
                                        {translations.currency}
                                    </label>
                                    <select
                                        value={selectedCurrencyId ?? ""}
                                        onChange={(e) =>
                                            setSelectedCurrencyId(
                                                e.target.value ? parseInt(e.target.value, 10) : null
                                            )
                                        }
                                        className="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px]"
                                    >
                                        {currencies.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex flex-col">
                                    <label className="mb-1 text-gray-500 dark:text-gray-400">
                                        {translations.date}
                                    </label>
                                    <input
                                        type="date"
                                        value={date}
                                        onChange={(e) => setDate(e.target.value)}
                                        className="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px]"
                                    />
                                </div>
                                <div className="flex flex-col">
                                    <label className="mb-1 text-gray-500 dark:text-gray-400">
                                        {translations.account}
                                    </label>
                                    <select
                                        value={selectedAccountId ?? ""}
                                        onChange={(e) =>
                                            setSelectedAccountId(
                                                e.target.value ? parseInt(e.target.value, 10) : null
                                            )
                                        }
                                        className="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px]"
                                    >
                                        <option value="">{translations.account}</option>
                                        {accounts
                                            .filter((a) => !selectedCurrencyId || a.currency_id === selectedCurrencyId)
                                            .map((a) => (
                                                <option key={a.id} value={a.id}>
                                                    {a.name}
                                                </option>
                                            ))}
                                    </select>
                                </div>
                            </div>

                            <div className="flex flex-col text-xs">
                                <label className="mb-1 text-gray-500 dark:text-gray-400">
                                    {translations.notes}
                                </label>
                                <textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    rows={2}
                                    className="w-full px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px] resize-none"
                                />
                            </div>

                            <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-2 text-xs">
                                <div className="flex items-center justify-between">
                                    <span className="text-gray-500 dark:text-gray-400">
                                        {translations.subtotal}
                                    </span>
                                    <span className="font-bold text-gray-900 dark:text-gray-100 ltr">
                                        {subtotal.toLocaleString("en-US", {
                                            maximumFractionDigits: 2,
                                        })}{" "}
                                        {currencyName}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-gray-500 dark:text-gray-400">
                                            {translations.discount}
                                        </span>
                                        <select
                                            value={orderDiscountType}
                                            onChange={(e) =>
                                                setOrderDiscountType(
                                                    e.target.value as "percent" | "fixed" | ""
                                                )
                                            }
                                            className="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px]"
                                        >
                                            <option value="">{translations.discountType}</option>
                                            <option value="percent">{translations.percent}</option>
                                            <option value="fixed">{translations.fixed}</option>
                                        </select>
                                    </div>
                                    <input
                                        type="number"
                                        value={orderDiscountValue || ""}
                                        onChange={(e) =>
                                            setOrderDiscountValue(
                                                parseFloat(e.target.value || "0") || 0
                                            )
                                        }
                                        className="w-24 px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px]"
                                        dir="ltr"
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-gray-500 dark:text-gray-400">
                                        {translations.totalAfterDiscount}
                                    </span>
                                    <span className="font-extrabold text-lg text-purple-600 dark:text-purple-300 ltr">
                                        {totalAfterDiscount.toLocaleString("en-US", {
                                            maximumFractionDigits: 2,
                                        })}{" "}
                                        {currencyName}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-gray-500 dark:text-gray-400">
                                        {translations.paidAmount}
                                    </span>
                                    <input
                                        type="number"
                                        value={paidAmount}
                                        onChange={(e) => setPaidAmount(e.target.value)}
                                        className="w-28 px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-[11px]"
                                        dir="ltr"
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-gray-500 dark:text-gray-400">
                                        {translations.remainingAmount}
                                    </span>
                                    <span className="font-bold text-amber-600 dark:text-amber-300 ltr">
                                        {remainingAmount.toLocaleString("en-US", {
                                            maximumFractionDigits: 2,
                                        })}{" "}
                                        {currencyName}
                                    </span>
                                </div>
                                {changeAmount > 0 && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-gray-500 dark:text-gray-400">
                                            {translations.change}
                                        </span>
                                        <span className="font-bold text-emerald-600 dark:text-emerald-300 ltr">
                                            {changeAmount.toLocaleString("en-US", {
                                                maximumFractionDigits: 2,
                                            })}{" "}
                                            {currencyName}
                                        </span>
                                    </div>
                                )}
                                <motion.button
                                    whileHover={{ scale: loading ? 1 : 1.02 }}
                                    whileTap={{ scale: loading ? 1 : 0.98 }}
                                    disabled={loading}
                                    onClick={() => void handleCheckout()}
                                    className="mt-2 w-full inline-flex items-center justify-center px-4 py-2.5 rounded-2xl bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-bold shadow-lg hover:shadow-xl disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {loading ? (
                                        <motion.div
                                            animate={{ rotate: 360 }}
                                            transition={{
                                                duration: 1,
                                                repeat: Infinity,
                                                ease: "linear",
                                            }}
                                            className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                                        />
                                    ) : (
                                        translations.checkout
                                    )}
                                </motion.button>
                            </div>
                        </div>
                </div>
            </div>

            <Footer className="mt-6" />

            <AnimatePresence>
                {showReceipt && receiptSale && receiptCustomer && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 backdrop-blur-md z-40 flex items-center justify-center"
                    >
                        <div className="w-full h-full md:h-[90vh] md:w-[90vw] bg-white dark:bg-gray-900 rounded-none md:rounded-3xl overflow-hidden shadow-2xl">
                            <SaleInvoice
                                saleData={receiptSale}
                                customer={receiptCustomer}
                                products={products}
                                units={units}
                                payments={receiptPayments}
                                currencyName={currencyName}
                                onClose={() => setShowReceipt(false)}
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}


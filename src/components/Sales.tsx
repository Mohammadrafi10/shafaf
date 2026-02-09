import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
    initSalesTable,
    initSaleDiscountCodesTable,
    createSale,
    getSales,
    getSale,
    updateSale,
    deleteSale,
    createSalePayment,
    getSalePayments,
    deleteSalePayment,
    getSaleAdditionalCosts,
    getProductBatches,
    validateDiscountCode,
    getDiscountCodes,
    createDiscountCode,
    updateDiscountCode,
    deleteDiscountCode,
    type Sale,
    type SaleItemInput,
    type SaleServiceItemInput,
    type SaleWithItems,
    type SalePayment,
    type SaleAdditionalCost,
    type ProductBatch,
    type SaleDiscountCode,
} from "../utils/sales";
import { getServices as getServiceCatalog, type Service as ServiceCatalogItem } from "../utils/service";
import { getCustomers, type Customer } from "../utils/customer";
import { getProducts, type Product } from "../utils/product";
import { getUnits, type Unit } from "../utils/unit";
import { getCurrencies, type Currency } from "../utils/currency";
import { getAccounts, getAccountBalanceByCurrency, type Account } from "../utils/account";
import { isDatabaseOpen, openDatabase } from "../utils/db";
import Footer from "./Footer";
import PersianDatePicker from "./PersianDatePicker";
import { formatPersianDate, getCurrentPersianDate, persianToGeorgian } from "../utils/date";
import Table from "./common/Table";
import PageHeader from "./common/PageHeader";
import SearchableSelect from "./common/SearchableSelect";
import { Search } from "lucide-react";

// Dari translations
const translations = {
    title: "مدیریت فروشات",
    addNew: "ثبت فروش جدید",
    edit: "ویرایش",
    delete: "حذف",
    cancel: "لغو",
    save: "ذخیره",
    customer: "مشتری",
    date: "تاریخ",
    notes: "یادداشت",
    items: "آیتم‌ها",
    addItem: "افزودن آیتم",
    addService: "افزودن خدمت",
    serviceItems: "خدمات",
    removeItem: "حذف",
    product: "محصول",
    service: "خدمت",
    unit: "واحد",
    price: "قیمت",
    perPrice: "قیمت واحد",
    amount: "مقدار",
    total: "جمع کل",
    totalAmount: "مبلغ کل",
    paidAmount: "پرداخت شده",
    remainingAmount: "باقی مانده",
    noSales: "هیچ فروشی ثبت نشده است",
    confirmDelete: "آیا از حذف این فروش اطمینان دارید؟",
    backToDashboard: "بازگشت به داشبورد",
    printInvoice: "چاپ فاکتور",
    success: {
        created: "فروش با موفقیت ثبت شد",
        updated: "فروش با موفقیت بروزرسانی شد",
        deleted: "فروش با موفقیت حذف شد",
    },
    errors: {
        create: "خطا در ثبت فروش",
        update: "خطا در بروزرسانی فروش",
        delete: "خطا در حذف فروش",
        fetch: "خطا در دریافت لیست فروشات",
        customerRequired: "انتخاب مشتری الزامی است",
        dateRequired: "تاریخ الزامی است",
        itemsRequired: "حداقل یک آیتم الزامی است",
    },
    placeholders: {
        date: "تاریخ را انتخاب کنید",
        notes: "یادداشت‌ها (اختیاری)",
        selectProduct: "محصول را انتخاب کنید",
        selectUnit: "واحد را انتخاب کنید",
    },
    searchProductByNameOrBarcode: "جستجوی محصول (نام یا بارکد)",
    selectUnit: "واحد را انتخاب کنید",
    payments: {
        title: "پرداخت‌ها",
        add: "افزودن پرداخت",
        amount: "مبلغ",
        date: "تاریخ",
        history: "تاریخچه پرداخت‌ها",
        noPayments: "هیچ پرداختی ثبت نشده است",
    },
    initialPayment: "پرداخت اولیه",
    initialPaymentOptional: "پرداخت اولیه (اختیاری)",
    optional: "اختیاری",
    paymentAmount: "مبلغ پرداخت",
    paymentCurrency: "ارز",
    paymentRate: "نرخ",
    paymentDate: "تاریخ پرداخت",
    paymentNotes: "یادداشت",
    paymentTotal: "مجموع",
    discount: "تخفیف",
    discountType: "نوع تخفیف",
    percent: "درصد",
    fixed: "مبلغ ثابت",
    orderDiscount: "تخفیف کل فاکتور",
    discountCode: "کد تخفیف",
    subtotal: "جمع جزء",
    orderDiscountAmount: "مبلغ تخفیف",
    totalAfterOrderDiscount: "جمع پس از تخفیف",
    applyCode: "اعمال کد",
    discountTokens: "کدهای تخفیف",
    discountTokenManage: "مدیریت کدهای تخفیف",
    addDiscountToken: "افزودن کد تخفیف",
    minPurchase: "حداقل خرید",
    validFrom: "اعتبار از",
    validTo: "اعتبار تا",
    maxUses: "حداکثر استفاده",
    useCount: "تعداد استفاده",
    noDiscountTokens: "هیچ کد تخفیفی ثبت نشده است",
    confirmDeleteDiscountToken: "آیا از حذف این کد تخفیف اطمینان دارید؟",
};

interface SalesManagementProps {
    onBack?: () => void;
    onOpenInvoice?: (data: {
        saleData: SaleWithItems;
        customer: Customer;
        products: Product[];
        units: Unit[];
        payments: SalePayment[];
        currencyName?: string;
    }) => void;
}

export default function SalesManagement({ onBack, onOpenInvoice }: SalesManagementProps) {
    const [sales, setSales] = useState<Sale[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [units, setUnits] = useState<Unit[]>([]);
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [baseCurrency, setBaseCurrency] = useState<Currency | null>(null);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [selectedAccountBalance, setSelectedAccountBalance] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [viewingSale, setViewingSale] = useState<SaleWithItems | null>(null);
    const [editingSale, setEditingSale] = useState<Sale | null>(null);
    const [formData, setFormData] = useState({
        customer_id: 0,
        date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
        currency_id: "",
        exchange_rate: 1,
        notes: "",
        paid_amount: 0,
        order_discount_type: "" as "" | "percent" | "fixed",
        order_discount_value: 0,
        additional_costs: [] as Array<{ name: string; amount: number }>,
        items: [] as SaleItemInput[],
        service_items: [] as SaleServiceItemInput[],
    });
    const [servicesCatalog, setServicesCatalog] = useState<ServiceCatalogItem[]>([]);
    const [payments, setPayments] = useState<SalePayment[]>([]);
    const [newPayment, setNewPayment] = useState({
        account_id: "",
        currency_id: "",
        exchange_rate: 1,
        amount: '',
        date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
    });
    const [initialPaymentFormData, setInitialPaymentFormData] = useState({
        amount: "",
        currency_id: "",
        exchange_rate: 1,
        account_id: "",
        date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
        notes: "",
        total: "",
    });
    const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
    const [productBatches, setProductBatches] = useState<Record<number, ProductBatch[]>>({});
    const [discountCodeInput, setDiscountCodeInput] = useState("");

    // Discount token (code) CRUD
    const [discountCodes, setDiscountCodes] = useState<SaleDiscountCode[]>([]);
    const [isDiscountTokenModalOpen, setIsDiscountTokenModalOpen] = useState(false);
    const [editingDiscountToken, setEditingDiscountToken] = useState<SaleDiscountCode | null>(null);
    const [discountTokenDeleteId, setDiscountTokenDeleteId] = useState<number | null>(null);
    const [discountTokenForm, setDiscountTokenForm] = useState({
        code: "",
        type: "percent" as "percent" | "fixed",
        value: 0,
        min_purchase: 0,
        valid_from: "",
        valid_to: "",
        max_uses: "" as string | number,
    });

    // Pagination & Search
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(10);
    const [totalItems, setTotalItems] = useState(0);
    const [search, setSearch] = useState("");
    const [sortBy, setSortBy] = useState("date");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

    useEffect(() => {
        loadData();
    }, [page, perPage, search, sortBy, sortOrder]);

    // Get filtered accounts based on selected currency
    const getFilteredAccounts = () => {
        if (!newPayment.currency_id || !accounts || !Array.isArray(accounts)) {
            return [];
        }
        const selectedCurrency = currencies.find(c => c.id.toString() === newPayment.currency_id);
        if (!selectedCurrency) {
            return [];
        }
        return accounts.filter(account => account.currency_id === selectedCurrency.id && account.is_active);
    };

    const getFilteredAccountsForInitialPayment = () => {
        if (!initialPaymentFormData.currency_id || !accounts || !Array.isArray(accounts)) return [];
        const selectedCurrency = currencies.find(c => c.id.toString() === initialPaymentFormData.currency_id);
        if (!selectedCurrency) return [];
        return accounts.filter(account => account.currency_id === selectedCurrency.id && account.is_active);
    };

    const calculateInitialPaymentTotal = () => {
        const amount = parseFloat(initialPaymentFormData.amount) || 0;
        const rate = parseFloat(String(initialPaymentFormData.exchange_rate)) || 1;
        return amount * rate;
    };

    // Load account balance when account and currency are selected
    useEffect(() => {
        const loadAccountBalance = async () => {
            if (newPayment.account_id && newPayment.currency_id) {
                try {
                    const selectedCurrency = currencies.find(c => c.id.toString() === newPayment.currency_id);
                    if (selectedCurrency) {
                        const balance = await getAccountBalanceByCurrency(
                            parseInt(newPayment.account_id),
                            selectedCurrency.id
                        );
                        setSelectedAccountBalance(balance);
                    }
                } catch (error) {
                    console.error("Error loading account balance:", error);
                    setSelectedAccountBalance(null);
                }
            } else {
                setSelectedAccountBalance(null);
            }
        };

        loadAccountBalance();
    }, [newPayment.account_id, newPayment.currency_id, currencies]);

    useEffect(() => {
        const total = calculateInitialPaymentTotal();
        setInitialPaymentFormData(prev => ({ ...prev, total: total.toFixed(2) }));
    }, [initialPaymentFormData.amount, initialPaymentFormData.exchange_rate]);

    const loadData = async () => {
        try {
            setLoading(true);
            const dbOpen = await isDatabaseOpen();
            if (!dbOpen) {
                await openDatabase("db");
            }

            try {
                await initSalesTable();
                await initSaleDiscountCodesTable();
            } catch (err) {
                console.log("Table initialization:", err);
            }

            const [salesResponse, customersResponse, productsResponse, unitsData, currenciesData, accountsData, servicesCatalogResponse] = await Promise.all([
                getSales(page, perPage, search, sortBy, sortOrder),
                getCustomers(1, 1000), // Get all customers (large page size)
                getProducts(1, 1000), // Get all products (large page size)
                getUnits(),
                getCurrencies(),
                getAccounts(), // Get all accounts
                getServiceCatalog(1, 1000), // Get all services (catalog) for sale form
            ]);

            setSales(salesResponse.items);
            setTotalItems(salesResponse.total);
            setCustomers(customersResponse.items);
            setProducts(productsResponse.items);
            setUnits(unitsData);
            setCurrencies(currenciesData);
            setAccounts(accountsData || []);
            setServicesCatalog(servicesCatalogResponse.items || []);
            
            // Set base currency
            const base = currenciesData.find(c => c.base);
            if (base) {
                setBaseCurrency(base);
            }
        } catch (error: any) {
            toast.error(translations.errors.fetch);
            console.error("Error loading data:", error);
        } finally {
            setLoading(false);
        }
    };

    const loadSaleDetails = async (id: number) => {
        try {
            const saleData = await getSale(id);
            const additionalCosts: SaleAdditionalCost[] = await getSaleAdditionalCosts(id);
            setEditingSale(saleData.sale);
            
            // Fetch batches for all products in sale items
            const batchesMap: Record<number, ProductBatch[]> = {};
            for (const item of saleData.items) {
                if (item.product_id && !batchesMap[item.product_id]) {
                    try {
                        const batches = await getProductBatches(item.product_id);
                        batchesMap[item.product_id] = batches;
                    } catch (error) {
                        console.error(`Error fetching batches for product ${item.product_id}:`, error);
                    }
                }
            }
            setProductBatches(prev => ({ ...prev, ...batchesMap }));
            
            setFormData({
                customer_id: saleData.sale.customer_id,
                date: saleData.sale.date,
                currency_id: saleData.sale.currency_id ? saleData.sale.currency_id.toString() : (baseCurrency?.id.toString() || ""),
                exchange_rate: saleData.sale.exchange_rate || 1,
                notes: saleData.sale.notes || "",
                paid_amount: saleData.sale.paid_amount,
                order_discount_type: (saleData.sale.order_discount_type as "" | "percent" | "fixed") || "",
                order_discount_value: saleData.sale.order_discount_value ?? 0,
                additional_costs: additionalCosts.map(cost => ({ name: cost.name, amount: cost.amount })),
                items: saleData.items.map(item => ({
                    product_id: item.product_id,
                    unit_id: item.unit_id,
                    per_price: item.per_price,
                    amount: item.amount,
                    purchase_item_id: item.purchase_item_id ?? null,
                    sale_type: (item.sale_type as 'retail' | 'wholesale') || 'retail',
                    discount_type: (item.discount_type as 'percent' | 'fixed') ?? null,
                    discount_value: item.discount_value ?? 0,
                })),
                service_items: (saleData.service_items || []).map(si => ({
                    service_id: si.service_id,
                    name: si.name,
                    price: si.price,
                    quantity: si.quantity,
                    discount_type: (si.discount_type as 'percent' | 'fixed') ?? null,
                    discount_value: si.discount_value ?? 0,
                })),
            });
        } catch (error: any) {
            toast.error("خطا در دریافت جزئیات فروش");
            console.error("Error loading sale details:", error);
        }
    };

    const loadPayments = async (saleId: number) => {
        try {
            const paymentsData = await getSalePayments(saleId);
            setPayments(paymentsData);
        } catch (error) {
            console.error("Error loading payments:", error);
            toast.error("خطا در دریافت لیست پرداخت‌ها");
        }
    };

    const handleAddPayment = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!viewingSale) return;

        if (!newPayment.amount || parseFloat(newPayment.amount) <= 0) {
            toast.error("مبلغ پرداخت باید بیشتر از صفر باشد");
            return;
        }

        if (!newPayment.currency_id) {
            toast.error("انتخاب ارز الزامی است");
            return;
        }

        try {
            setLoading(true);
            await createSalePayment(
                viewingSale.sale.id,
                newPayment.account_id ? parseInt(newPayment.account_id) : null,
                newPayment.currency_id ? parseInt(newPayment.currency_id) : null,
                parseFloat(newPayment.exchange_rate.toString()) || 1,
                parseFloat(newPayment.amount),
                newPayment.date
            );
            toast.success("پرداخت با موفقیت ثبت شد");
            setNewPayment({
                account_id: "",
                currency_id: "",
                exchange_rate: 1,
                amount: '',
                date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
            });
            setSelectedAccountBalance(null);
            await loadPayments(viewingSale.sale.id);
            await loadData();
            const updatedSale = await getSale(viewingSale.sale.id);
            // Fetch additional costs
            const additionalCosts = await getSaleAdditionalCosts(viewingSale.sale.id);
            const saleWithCosts = {
                ...updatedSale,
                additional_costs: additionalCosts,
            };
            setViewingSale(saleWithCosts);
        } catch (error) {
            console.error("Error adding payment:", error);
            toast.error("خطا در ثبت پرداخت");
        } finally {
            setLoading(false);
        }
    };

    const handleDeletePayment = async (paymentId: number) => {
        if (!viewingSale) return;
        try {
            // Confirm? Maybe too annoying with another modal within modal. Just do it or browser confirm.
            if (!window.confirm("آیا از حذف این پرداخت اطمینان دارید؟")) return;

            setLoading(true);
            await deleteSalePayment(paymentId);
            toast.success("پرداخت حذف شد");
            await loadPayments(viewingSale.sale.id);
            await loadData();
            const updatedSale = await getSale(viewingSale.sale.id);
            // Fetch additional costs
            const additionalCosts = await getSaleAdditionalCosts(viewingSale.sale.id);
            const saleWithCosts = {
                ...updatedSale,
                additional_costs: additionalCosts,
            };
            setViewingSale(saleWithCosts);
        } catch (error) {
            console.error("Error deleting payment:", error);
            toast.error("خطا در حذف پرداخت");
        } finally {
            setLoading(false);
        }
    };

    const loadDiscountCodes = async () => {
        try {
            const list = await getDiscountCodes();
            setDiscountCodes(list);
        } catch (e) {
            toast.error("خطا در دریافت کدهای تخفیف");
        }
    };

    const handleDiscountTokenSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!discountTokenForm.code.trim()) {
            toast.error("کد تخفیف الزامی است");
            return;
        }
        try {
            setLoading(true);
            const payload = {
                code: discountTokenForm.code.trim().toUpperCase(),
                type: discountTokenForm.type,
                value: Number(discountTokenForm.value) || 0,
                min_purchase: Number(discountTokenForm.min_purchase) || 0,
                valid_from: discountTokenForm.valid_from.trim() || null,
                valid_to: discountTokenForm.valid_to.trim() || null,
                max_uses: discountTokenForm.max_uses === "" ? null : Number(discountTokenForm.max_uses),
            };
            if (editingDiscountToken) {
                await updateDiscountCode(editingDiscountToken.id, payload);
                toast.success("کد تخفیف بروزرسانی شد");
            } else {
                await createDiscountCode(payload);
                toast.success("کد تخفیف ثبت شد");
            }
            setEditingDiscountToken(null);
            setDiscountTokenForm({ code: "", type: "percent", value: 0, min_purchase: 0, valid_from: "", valid_to: "", max_uses: "" });
            await loadDiscountCodes();
        } catch (err: any) {
            const msg = typeof err === "string" ? err : err?.message ?? err?.toString?.() ?? "خطا در ذخیره کد تخفیف";
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    };

    const handleEditDiscountToken = (dc: SaleDiscountCode) => {
        setEditingDiscountToken(dc);
        setDiscountTokenForm({
            code: dc.code,
            type: dc.type as "percent" | "fixed",
            value: dc.value,
            min_purchase: dc.min_purchase,
            valid_from: dc.valid_from || "",
            valid_to: dc.valid_to || "",
            max_uses: dc.max_uses ?? "",
        });
    };

    const handleDeleteDiscountToken = async (id: number) => {
        try {
            setLoading(true);
            await deleteDiscountCode(id);
            toast.success("کد تخفیف حذف شد");
            setDiscountTokenDeleteId(null);
            await loadDiscountCodes();
            if (editingDiscountToken?.id === id) {
                setEditingDiscountToken(null);
                setDiscountTokenForm({ code: "", type: "percent", value: 0, min_purchase: 0, valid_from: "", valid_to: "", max_uses: "" });
            }
        } catch (e) {
            toast.error("خطا در حذف کد تخفیف");
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = useCallback(async (sale?: Sale) => {
        if (sale && loadSaleDetails) {
            await loadSaleDetails(sale.id);
        } else {
            setEditingSale(null);
            setFormData({
                customer_id: 0,
                date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
                currency_id: baseCurrency?.id.toString() || "",
                exchange_rate: 1,
                notes: "",
                paid_amount: 0,
                order_discount_type: "" as "" | "percent" | "fixed",
                order_discount_value: 0,
                additional_costs: [],
                items: [],
                service_items: [],
            });
            setInitialPaymentFormData({
                amount: "",
                currency_id: baseCurrency?.id.toString() || "",
                exchange_rate: baseCurrency ? (baseCurrency.rate ?? 1) : 1,
                account_id: "",
                date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
                notes: "",
                total: "",
            });
            setProductBatches({});
        }
        setIsModalOpen(true);
    }, [baseCurrency, loadSaleDetails]);

    // Listen for external modal open request (e.g., from keyboard shortcut)
    // This must be after handleOpenModal is defined
    useEffect(() => {
        const handleOpen = () => {
            handleOpenModal();
        };
        // Store the handler so parent can call it
        (window as any).__openSalesModal = handleOpen;
        return () => {
            delete (window as any).__openSalesModal;
        };
    }, [handleOpenModal]);

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingSale(null);
        setFormData({
            customer_id: 0,
            date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
            currency_id: baseCurrency?.id.toString() || "",
            exchange_rate: 1,
            notes: "",
            paid_amount: 0,
            order_discount_type: "" as "" | "percent" | "fixed",
            order_discount_value: 0,
            additional_costs: [],
            items: [],
            service_items: [],
        });
        setInitialPaymentFormData({
            amount: "",
            currency_id: "",
            exchange_rate: 1,
            account_id: "",
            date: persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split('T')[0],
            notes: "",
            total: "",
        });
        setProductBatches({});
    };

    const addItem = () => {
        setFormData({
            ...formData,
            items: [
                ...formData.items,
                { product_id: 0, unit_id: 0, per_price: 0, amount: 0, purchase_item_id: null, sale_type: 'retail', discount_type: null, discount_value: 0 },
            ],
        });
    };

    const handleViewSale = async (sale: Sale) => {
        try {
            const saleData = await getSale(sale.id);
            // Fetch additional costs
            const additionalCosts = await getSaleAdditionalCosts(sale.id);
            const saleWithCosts = {
                ...saleData,
                additional_costs: additionalCosts,
            };
            setViewingSale(saleWithCosts);
            await loadPayments(sale.id);
            setIsViewModalOpen(true);
        } catch (error: any) {
            toast.error("خطا در دریافت جزئیات فروش");
            console.error("Error loading sale details:", error);
        }
    };

    const removeItem = (index: number) => {
        setFormData({
            ...formData,
            items: formData.items.filter((_, i) => i !== index),
        });
    };

    const addServiceItem = () => {
        setFormData({
            ...formData,
            service_items: [...formData.service_items, { service_id: 0, name: "", price: 0, quantity: 1, discount_type: null, discount_value: 0 }],
        });
    };

    const removeServiceItem = (index: number) => {
        setFormData({
            ...formData,
            service_items: formData.service_items.filter((_, i) => i !== index),
        });
    };

    const updateServiceItem = (index: number, field: keyof SaleServiceItemInput, value: number | string | null) => {
        const newServiceItems = [...formData.service_items];
        newServiceItems[index] = { ...newServiceItems[index], [field]: value };
        if (field === "service_id" && typeof value === "number" && value) {
            const catalogItem = servicesCatalog.find((s) => s.id === value);
            if (catalogItem) {
                newServiceItems[index].name = catalogItem.name;
                newServiceItems[index].price = catalogItem.price;
            }
        }
        setFormData({ ...formData, service_items: newServiceItems });
    };

    const updateItem = async (index: number, field: keyof SaleItemInput, value: any) => {
        const newItems = [...formData.items];
        newItems[index] = { ...newItems[index], [field]: value };

        // When product is selected, fetch batches and auto-select oldest batch
        if (field === 'product_id' && value) {
            try {
                const batches = await getProductBatches(value);
                setProductBatches(prev => ({ ...prev, [value]: batches }));
                
                // Auto-select oldest batch (first in array)
                if (batches.length > 0) {
                    const oldestBatch = batches[0];
                    newItems[index].purchase_item_id = oldestBatch.purchase_item_id;
                    
                    // Set default sale_type to retail if not set
                    if (!newItems[index].sale_type) {
                        newItems[index].sale_type = 'retail';
                    }
                    
                    // Auto-fill price based on sale_type
                    if (newItems[index].sale_type === 'retail') {
                        newItems[index].per_price = oldestBatch.retail_price || oldestBatch.per_price;
                    } else {
                        newItems[index].per_price = oldestBatch.wholesale_price || oldestBatch.per_price;
                    }
                }
                
                const product = products.find(p => p.id === value);
                if (product && product.unit) {
                    const unit = units.find(u => u.name === product.unit);
                    if (unit) {
                        newItems[index].unit_id = unit.id;
                    }
                }
            } catch (error) {
                console.error("Error fetching batches:", error);
                toast.error("خطا در دریافت اطلاعات دسته‌ها");
            }
        }

        // When sale_type changes, update price based on selected batch
        if (field === 'sale_type' && newItems[index].product_id && newItems[index].purchase_item_id) {
            const batches = productBatches[newItems[index].product_id] || [];
            const selectedBatch = batches.find(b => b.purchase_item_id === newItems[index].purchase_item_id);
            if (selectedBatch) {
                if (value === 'retail') {
                    newItems[index].per_price = selectedBatch.retail_price || selectedBatch.per_price;
                } else {
                    newItems[index].per_price = selectedBatch.wholesale_price || selectedBatch.per_price;
                }
            }
        }

        // When purchase_item_id (batch) changes, update price based on sale_type
        if (field === 'purchase_item_id' && newItems[index].product_id && newItems[index].sale_type) {
            const batches = productBatches[newItems[index].product_id] || [];
            const selectedBatch = batches.find(b => b.purchase_item_id === value);
            if (selectedBatch) {
                if (newItems[index].sale_type === 'retail') {
                    newItems[index].per_price = selectedBatch.retail_price || selectedBatch.per_price;
                } else {
                    newItems[index].per_price = selectedBatch.wholesale_price || selectedBatch.per_price;
                }
            }
        }

        setFormData({ ...formData, items: newItems });
    };

    const computeLineDiscountAmount = (subtotal: number, discountType: string | null | undefined, discountValue: number | undefined) => {
        if (subtotal <= 0 || !discountType || discountValue == null) return 0;
        const v = Number(discountValue) || 0;
        if (discountType === "percent") return Math.round((subtotal * Math.min(100, Math.max(0, v)) / 100) * 100) / 100;
        if (discountType === "fixed") return Math.round(Math.min(v, subtotal) * 100) / 100;
        return 0;
    };

    const calculateItemTotal = (item: SaleItemInput) => {
        const lineSubtotal = item.per_price * item.amount;
        const disc = computeLineDiscountAmount(lineSubtotal, item.discount_type ?? null, item.discount_value ?? 0);
        return Math.round((lineSubtotal - disc) * 100) / 100;
    };

    const calculateServiceItemTotal = (si: SaleServiceItemInput) => {
        const lineSubtotal = si.price * si.quantity;
        const disc = computeLineDiscountAmount(lineSubtotal, si.discount_type ?? null, si.discount_value ?? 0);
        return Math.round((lineSubtotal - disc) * 100) / 100;
    };

    const calculateSubtotal = () => {
        const itemsTotal = formData.items.reduce((sum, item) => sum + calculateItemTotal(item), 0);
        const serviceItemsTotal = formData.service_items.reduce((sum, si) => sum + calculateServiceItemTotal(si), 0);
        return Math.round((itemsTotal + serviceItemsTotal) * 100) / 100;
    };

    const calculateOrderDiscountAmount = () => {
        const subtotal = calculateSubtotal();
        const typ = formData.order_discount_type;
        const val = Number(formData.order_discount_value) || 0;
        if (!typ || val <= 0) return 0;
        if (typ === "percent") return Math.round((subtotal * Math.min(100, val) / 100) * 100) / 100;
        if (typ === "fixed") return Math.round(Math.min(val, subtotal) * 100) / 100;
        return 0;
    };

    const calculateTotal = () => {
        const subtotal = calculateSubtotal();
        const orderDisc = calculateOrderDiscountAmount();
        const additionalCostsTotal = formData.additional_costs.reduce((sum, cost) => sum + (cost.amount || 0), 0);
        return Math.round((subtotal - orderDisc + additionalCostsTotal) * 100) / 100;
    };

    const calculateRemaining = () => {
        return calculateTotal() - formData.paid_amount;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.customer_id) {
            toast.error(translations.errors.customerRequired);
            return;
        }

        if (!formData.date) {
            toast.error(translations.errors.dateRequired);
            return;
        }

        if (formData.items.length === 0 && formData.service_items.length === 0) {
            toast.error(translations.errors.itemsRequired);
            return;
        }

        // Validate product items
        for (let i = 0; i < formData.items.length; i++) {
            const item = formData.items[i];
            if (!item.product_id || !item.unit_id || item.per_price <= 0 || item.amount <= 0) {
                toast.error(`آیتم ${i + 1} ناقص است`);
                return;
            }
        }
        // Validate service items
        for (let i = 0; i < formData.service_items.length; i++) {
            const si = formData.service_items[i];
            if (!si.service_id || !si.name?.trim() || si.price < 0 || si.quantity <= 0) {
                toast.error(`خدمت ${i + 1} ناقص است`);
                return;
            }
        }

        try {
            setLoading(true);
            const orderDiscountType = formData.order_discount_type && formData.order_discount_value ? (formData.order_discount_type as 'percent' | 'fixed') : null;
            const orderDiscountValue = Number(formData.order_discount_value) || 0;
            if (editingSale) {
                await updateSale(
                    editingSale.id,
                    formData.customer_id,
                    formData.date,
                    formData.notes || null,
                    formData.currency_id ? parseInt(formData.currency_id) : null,
                    formData.exchange_rate ? parseFloat(formData.exchange_rate.toString()) : 1,
                    formData.paid_amount,
                    formData.additional_costs,
                    formData.items,
                    formData.service_items,
                    orderDiscountType,
                    orderDiscountValue
                );
                toast.success(translations.success.updated);
            } else {
                const initialAmount = parseFloat(initialPaymentFormData.amount) || 0;
                const useInitialPaymentForm = initialAmount > 0 && initialPaymentFormData.currency_id;
                const paidAmountForCreate = useInitialPaymentForm ? 0 : formData.paid_amount;
                const newSale = await createSale(
                    formData.customer_id,
                    formData.date,
                    formData.notes || null,
                    formData.currency_id ? parseInt(formData.currency_id) : null,
                    formData.exchange_rate ? parseFloat(formData.exchange_rate.toString()) : 1,
                    paidAmountForCreate,
                    formData.additional_costs,
                    formData.items,
                    formData.service_items,
                    orderDiscountType,
                    orderDiscountValue
                );
                toast.success(translations.success.created);
                if (useInitialPaymentForm) {
                    try {
                        const paymentDate = initialPaymentFormData.date?.trim() || persianToGeorgian(getCurrentPersianDate()) || new Date().toISOString().split("T")[0];
                        const accountId = initialPaymentFormData.account_id?.trim()
                            ? parseInt(initialPaymentFormData.account_id, 10)
                            : null;
                        const currencyId = parseInt(initialPaymentFormData.currency_id, 10);
                        if (Number.isNaN(accountId) && initialPaymentFormData.account_id?.trim()) {
                            toast.error("فروش ایجاد شد؛ حساب انتخاب شده نامعتبر است");
                        } else {
                            await createSalePayment(
                                newSale.id,
                                accountId ?? null,
                                Number.isNaN(currencyId) ? null : currencyId,
                                parseFloat(String(initialPaymentFormData.exchange_rate)) || 1,
                                initialAmount,
                                paymentDate
                            );
                            toast.success("پرداخت اولیه با موفقیت ثبت شد");
                        }
                    } catch (paymentError: unknown) {
                        const msg = typeof paymentError === "string" ? paymentError : (paymentError as Error)?.message || String(paymentError);
                        toast.error(`فروش ایجاد شد؛ ${msg}`, { duration: 5000 });
                        console.error("Error creating initial payment:", paymentError);
                    }
                }
            }
            handleCloseModal();
            await loadData();
        } catch (error: unknown) {
            const msg = typeof error === "string" ? error : (error as Error)?.message;
            toast.error(msg || (editingSale ? translations.errors.update : translations.errors.create));
            console.error("Error saving sale:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: number) => {
        try {
            setLoading(true);
            await deleteSale(id);
            toast.success(translations.success.deleted);
            setDeleteConfirm(null);
            await loadData();
        } catch (error: any) {
            toast.error(translations.errors.delete);
            console.error("Error deleting sale:", error);
        } finally {
            setLoading(false);
        }
    };

    const getCustomerName = (customerId: number) => {
        return customers.find(c => c.id === customerId)?.full_name || `ID: ${customerId}`;
    };

    const getProductName = (productId: number) => {
        return products.find(p => p.id === productId)?.name || `ID: ${productId}`;
    };

    const getUnitName = (unitId: number) => {
        return units.find(u => u.id === unitId)?.name || `ID: ${unitId}`;
    };

    const columns = [
        {
            key: "id", label: "شماره", sortable: false,
            render: (sale: Sale) => (
                <span className="font-mono text-gray-700 dark:text-gray-300">#{sale.id}</span>
            )
        },
        {
            key: "customer_id", label: translations.customer, sortable: false,
            render: (sale: Sale) => (
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center text-white font-bold text-xs">
                        {getCustomerName(sale.customer_id).charAt(0)}
                    </div>
                    <span className="font-medium text-gray-900 dark:text-white">{getCustomerName(sale.customer_id)}</span>
                </div>
            )
        },
        {
            key: "date", label: translations.date, sortable: true,
            render: (sale: Sale) => (
                <span className="text-gray-700 dark:text-gray-300">
                    {formatPersianDate(sale.date)}
                </span>
            )
        },
        {
            key: "total_amount", label: translations.totalAmount, sortable: true,
            render: (sale: Sale) => {
                const saleCurrency = currencies.find(c => c.id === sale.currency_id);
                return (
                    <div>
                        <span className="font-bold text-purple-700 dark:text-purple-300">
                            {sale.total_amount.toLocaleString('en-US')} {saleCurrency?.name || ""}
                        </span>
                        {sale.base_amount !== sale.total_amount && (
                            <div className="text-xs text-gray-500">
                                ({sale.base_amount.toLocaleString('en-US')} پایه)
                            </div>
                        )}
                    </div>
                );
            }
        },
        {
            key: "paid_amount", label: translations.paidAmount, sortable: true,
            render: (sale: Sale) => {
                const saleCurrency = currencies.find(c => c.id === sale.currency_id);
                return (
                    <span className="font-bold text-green-700 dark:text-green-300">
                        {sale.paid_amount.toLocaleString('en-US')} {saleCurrency?.name || ""}
                    </span>
                );
            }
        },
        {
            key: "remaining", label: translations.remainingAmount, sortable: false,
            render: (sale: Sale) => {
                const remaining = sale.total_amount - sale.paid_amount;
                return (
                    <span className={`font-bold ${remaining > 0 ? 'text-red-700 dark:text-red-300' : 'text-gray-500'}`}>
                        {remaining.toLocaleString('en-US')} افغانی
                    </span>
                );
            }
        },
        {
            key: "created_at", label: "تاریخ ایجاد", sortable: true,
            render: (sale: Sale) => (
                <span className="text-gray-600 dark:text-gray-400 text-sm">
                    {new Date(sale.created_at).toLocaleDateString('fa-IR')}
                </span>
            )
        }
    ];

    const handlePrintInvoice = async (saleData: SaleWithItems) => {
        try {
            const salePayments = await getSalePayments(saleData.sale.id);
            const customer = customers.find(c => c.id === saleData.sale.customer_id);
            if (customer && onOpenInvoice) {
                const currencyName = saleData.sale.currency_id
                    ? currencies.find((c) => c.id === saleData.sale.currency_id)?.name
                    : undefined;
                onOpenInvoice({
                    saleData,
                    customer,
                    products,
                    units,
                    payments: salePayments,
                    currencyName: currencyName ?? undefined,
                });
            }
        } catch (error) {
            console.error("Error loading payments:", error);
            const customer = customers.find(c => c.id === saleData.sale.customer_id);
            if (customer && onOpenInvoice) {
                const currencyName = saleData.sale.currency_id
                    ? currencies.find((c) => c.id === saleData.sale.currency_id)?.name
                    : undefined;
                onOpenInvoice({
                    saleData,
                    customer,
                    products,
                    units,
                    payments: [],
                    currencyName: currencyName ?? undefined,
                });
            }
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
                            label: translations.discountTokens,
                            onClick: async () => {
                                try {
                                    const list = await getDiscountCodes();
                                    setDiscountCodes(list);
                                    setEditingDiscountToken(null);
                                    setDiscountTokenForm({ code: "", type: "percent", value: 0, min_purchase: 0, valid_from: "", valid_to: "", max_uses: "" });
                                    setIsDiscountTokenModalOpen(true);
                                } catch (e) {
                                    toast.error("خطا در دریافت کدهای تخفیف");
                                }
                            },
                            variant: "secondary" as const
                        },
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
                        placeholder="جستجو بر اساس تاریخ، مشتری، شماره تماس یا یادداشت..."
                    />
                </div>

                <Table
                    data={sales}
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
                    actions={(sale) => (
                        <div className="flex items-center gap-2">
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleViewSale(sale)}
                                className="p-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
                                title="مشاهده"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                            </motion.button>
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => handleOpenModal(sale)}
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
                                onClick={() => setDeleteConfirm(sale.id)}
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

                {/* Modal for Add/Edit */}
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
                                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-4xl max-h-[90vh] overflow-y-auto my-8"
                            >
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                                    {editingSale ? translations.edit : translations.addNew}
                                </h2>
                                <form onSubmit={handleSubmit} className="space-y-6">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.customer} <span className="text-red-500">*</span>
                                            </label>
                                            <select
                                                value={formData.customer_id}
                                                onChange={(e) => setFormData({ ...formData, customer_id: parseInt(e.target.value) })}
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                dir="rtl"
                                            >
                                                <option value={0}>انتخاب مشتری</option>
                                                {customers.map((customer) => (
                                                    <option key={customer.id} value={customer.id}>
                                                        {customer.full_name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                {translations.date} <span className="text-red-500">*</span>
                                            </label>
                                            <PersianDatePicker
                                                value={formData.date}
                                                onChange={(date) => setFormData({ ...formData, date })}
                                                placeholder={translations.placeholders.date}
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                ارز
                                            </label>
                                            <select
                                                value={formData.currency_id}
                                                onChange={(e) => {
                                                    const selectedCurrencyId = e.target.value;
                                                    const selectedCurrency = currencies.find(c => c.id.toString() === selectedCurrencyId);
                                                    setFormData({ 
                                                        ...formData, 
                                                        currency_id: selectedCurrencyId,
                                                        exchange_rate: selectedCurrency ? selectedCurrency.rate : 1
                                                    });
                                                }}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                dir="rtl"
                                            >
                                                <option value="">انتخاب ارز</option>
                                                {currencies.map((currency) => (
                                                    <option key={currency.id} value={currency.id}>
                                                        {currency.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                نرخ تبدیل
                                            </label>
                                            <input
                                                type="number"
                                                step="0.0001"
                                                min="0"
                                                value={formData.exchange_rate}
                                                onChange={(e) => setFormData({ ...formData, exchange_rate: parseFloat(e.target.value) || 1 })}
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                                                placeholder="1.0"
                                                dir="ltr"
                                            />
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
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200 resize-none"
                                            placeholder={translations.placeholders.notes}
                                            dir="rtl"
                                        />
                                    </div>

                                    <div>
                                        <div className="flex justify-between items-center mb-4">
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                                                هزینه‌های اضافی
                                            </label>
                                            <motion.button
                                                type="button"
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                onClick={() => setFormData({
                                                    ...formData,
                                                    additional_costs: [...formData.additional_costs, { name: "", amount: 0 }]
                                                })}
                                                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-sm"
                                            >
                                                افزودن هزینه اضافی
                                            </motion.button>
                                        </div>

                                        <div className="space-y-3 max-h-48 overflow-y-auto">
                                            {formData.additional_costs.map((cost, index) => (
                                                <motion.div
                                                    key={index}
                                                    initial={{ opacity: 0, y: -10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl border-2 border-gray-200 dark:border-gray-600"
                                                >
                                                    <div className="grid grid-cols-12 gap-3 items-end">
                                                        <div className="col-span-5">
                                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                نام هزینه
                                                            </label>
                                                            <input
                                                                type="text"
                                                                value={cost.name}
                                                                onChange={(e) => {
                                                                    const newCosts = [...formData.additional_costs];
                                                                    newCosts[index].name = e.target.value;
                                                                    setFormData({ ...formData, additional_costs: newCosts });
                                                                }}
                                                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                                placeholder="مثال: حمل و نقل"
                                                                dir="rtl"
                                                            />
                                                        </div>
                                                        <div className="col-span-5">
                                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                مبلغ
                                                            </label>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                value={cost.amount || ''}
                                                                onChange={(e) => {
                                                                    const newCosts = [...formData.additional_costs];
                                                                    newCosts[index].amount = parseFloat(e.target.value) || 0;
                                                                    setFormData({ ...formData, additional_costs: newCosts });
                                                                }}
                                                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                                placeholder="0"
                                                                dir="ltr"
                                                            />
                                                        </div>
                                                        <div className="col-span-2">
                                                            <motion.button
                                                                type="button"
                                                                whileHover={{ scale: 1.1 }}
                                                                whileTap={{ scale: 0.9 }}
                                                                onClick={() => {
                                                                    const newCosts = formData.additional_costs.filter((_, i) => i !== index);
                                                                    setFormData({ ...formData, additional_costs: newCosts });
                                                                }}
                                                                className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm"
                                                            >
                                                                حذف
                                                            </motion.button>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            ))}
                                            {formData.additional_costs.length === 0 && (
                                                <div className="text-center py-4 text-gray-500 dark:text-gray-400 text-sm">
                                                    هیچ هزینه اضافی اضافه نشده است
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex justify-between items-center mb-4">
                                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                                                {translations.items} <span className="text-red-500">*</span>
                                            </label>
                                            <motion.button
                                                type="button"
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                onClick={addItem}
                                                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-sm"
                                            >
                                                {translations.addItem}
                                            </motion.button>
                                        </div>

                                        <div className="space-y-3 max-h-80 overflow-y-auto">
                                            {formData.items.map((item, index) => (
                                                <motion.div
                                                    key={index}
                                                    initial={{ opacity: 0, y: -10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl border-2 border-gray-200 dark:border-gray-600"
                                                >
                                                    <div className="grid grid-cols-12 gap-3 items-end">
                                                        <div className={item.product_id && productBatches[item.product_id] && productBatches[item.product_id].length > 0 ? "col-span-2" : "col-span-4"}>
                                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                {translations.product}
                                                            </label>
                                                            <SearchableSelect<Product>
                                                                options={products}
                                                                value={item.product_id}
                                                                onChange={(id) => updateItem(index, "product_id", id)}
                                                                getOptionLabel={(p) =>
                                                                    p.bar_code ? `${p.name} (${p.bar_code})` : p.name
                                                                }
                                                                getOptionValue={(p) => p.id}
                                                                placeholder="انتخاب محصول"
                                                                searchPlaceholder={translations.searchProductByNameOrBarcode}
                                                                dir="rtl"
                                                                renderOptionExtra={(p) =>
                                                                    `موجودی: ${p.stock_quantity?.toLocaleString() ?? "—"}`
                                                                }
                                                            />
                                                        </div>
                                                        {item.product_id && productBatches[item.product_id] && productBatches[item.product_id].length > 0 && (
                                                            <div className="col-span-2">
                                                                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                    دسته (Batch)
                                                                </label>
                                                                <select
                                                                    value={item.purchase_item_id || ''}
                                                                    onChange={(e) => updateItem(index, 'purchase_item_id', parseInt(e.target.value) || null)}
                                                                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500"
                                                                    dir="rtl"
                                                                >
                                                                    {productBatches[item.product_id].map((batch) => (
                                                                        <option key={batch.purchase_item_id} value={batch.purchase_item_id}>
                                                                            {batch.batch_number || `دسته ${batch.purchase_item_id}`} - 
                                                                            تاریخ: {formatPersianDate(batch.purchase_date)} - 
                                                                            موجودی: {batch.remaining_quantity.toLocaleString()}
                                                                            {batch.expiry_date && ` - انقضا: ${formatPersianDate(batch.expiry_date)}`}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        )}
                                                        <div className="col-span-1">
                                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                نوع فروش
                                                            </label>
                                                            <select
                                                                value={item.sale_type || 'retail'}
                                                                onChange={(e) => updateItem(index, 'sale_type', e.target.value as 'retail' | 'wholesale')}
                                                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500"
                                                                dir="rtl"
                                                            >
                                                                <option value="retail">خرده فروشی</option>
                                                                <option value="wholesale">عمده فروشی</option>
                                                            </select>
                                                        </div>
                                                        <div className="col-span-1">
                                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                {translations.unit}
                                                            </label>
                                                            <select
                                                                value={item.unit_id}
                                                                onChange={(e) => updateItem(index, 'unit_id', parseInt(e.target.value))}
                                                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500"
                                                                dir="rtl"
                                                            >
                                                                <option value={0}>انتخاب واحد</option>
                                                                {units.map((unit) => (
                                                                    <option key={unit.id} value={unit.id}>
                                                                        {unit.name}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div className="col-span-2">
                                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                {translations.perPrice}
                                                            </label>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                value={item.per_price || ''}
                                                                onChange={(e) => updateItem(index, 'per_price', parseFloat(e.target.value) || 0)}
                                                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500"
                                                                dir="ltr"
                                                            />
                                                        </div>
                                                        <div className="col-span-2">
                                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                {translations.amount}
                                                            </label>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                value={item.amount || ''}
                                                                onChange={(e) => updateItem(index, 'amount', parseFloat(e.target.value) || 0)}
                                                                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500"
                                                                dir="ltr"
                                                            />
                                                        </div>
                                                        <div className="col-span-1">
                                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                {translations.discount}
                                                            </label>
                                                            <select
                                                                value={item.discount_type || ''}
                                                                onChange={(e) => updateItem(index, 'discount_type', e.target.value === "" ? null : (e.target.value as "percent" | "fixed"))}
                                                                className="w-full px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                                dir="rtl"
                                                            >
                                                                <option value="">—</option>
                                                                <option value="percent">{translations.percent}</option>
                                                                <option value="fixed">{translations.fixed}</option>
                                                            </select>
                                                        </div>
                                                        <div className="col-span-1">
                                                            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                {item.discount_type === 'percent' ? '%' : translations.fixed}
                                                            </label>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                min="0"
                                                                value={item.discount_value ?? ''}
                                                                onChange={(e) => updateItem(index, 'discount_value', parseFloat(e.target.value) || 0)}
                                                                className="w-full px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                                dir="ltr"
                                                                disabled={!item.discount_type}
                                                            />
                                                        </div>
                                                        <div className="col-span-1">
                                                            <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                {translations.total}
                                                            </div>
                                                            <div className="px-3 py-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg text-sm font-bold text-purple-700 dark:text-purple-300">
                                                                {calculateItemTotal(item).toLocaleString('en-US')}
                                                            </div>
                                                        </div>
                                                        <div className="col-span-1">
                                                            <motion.button
                                                                type="button"
                                                                whileHover={{ scale: 1.1 }}
                                                                whileTap={{ scale: 0.9 }}
                                                                onClick={() => removeItem(index)}
                                                                className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm"
                                                            >
                                                                {translations.removeItem}
                                                            </motion.button>
                                                        </div>
                                                    </div>
                                                    {item.product_id && item.purchase_item_id && productBatches[item.product_id] && (
                                                        <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-xs">
                                                            {(() => {
                                                                const batch = productBatches[item.product_id].find(b => b.purchase_item_id === item.purchase_item_id);
                                                                if (batch) {
                                                                    return (
                                                                        <div className="grid grid-cols-4 gap-2 text-gray-700 dark:text-gray-300">
                                                                            <div><span className="font-semibold">تاریخ خرید:</span> {formatPersianDate(batch.purchase_date)}</div>
                                                                            {batch.expiry_date && <div><span className="font-semibold">تاریخ انقضا:</span> {formatPersianDate(batch.expiry_date)}</div>}
                                                                            <div><span className="font-semibold">موجودی:</span> {batch.remaining_quantity.toLocaleString()}</div>
                                                                            <div><span className="font-semibold">قیمت خرید:</span> {batch.per_price.toLocaleString()}</div>
                                                                        </div>
                                                                    );
                                                                }
                                                                return null;
                                                            })()}
                                                        </div>
                                                    )}
                                                </motion.div>
                                            ))}
                                        </div>

                                        {/* Service items */}
                                        <div className="mt-6">
                                            <div className="flex justify-between items-center mb-4">
                                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                                                    {translations.serviceItems}
                                                </label>
                                                <motion.button
                                                    type="button"
                                                    whileHover={{ scale: 1.05 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    onClick={addServiceItem}
                                                    className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition-colors text-sm"
                                                >
                                                    {translations.addService}
                                                </motion.button>
                                            </div>
                                            <div className="space-y-3 max-h-48 overflow-y-auto">
                                                {formData.service_items.map((si, index) => (
                                                    <motion.div
                                                        key={index}
                                                        initial={{ opacity: 0, y: -10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        className="p-4 bg-teal-50 dark:bg-teal-900/20 rounded-xl border-2 border-teal-200 dark:border-teal-700"
                                                    >
                                                        <div className="grid grid-cols-12 gap-3 items-end">
                                                            <div className="col-span-4">
                                                                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                    {translations.service}
                                                                </label>
                                                                <SearchableSelect<ServiceCatalogItem>
                                                                    options={servicesCatalog}
                                                                    value={si.service_id}
                                                                    onChange={(id) => updateServiceItem(index, "service_id", id)}
                                                                    getOptionLabel={(s) => `${s.name} - ${s.price.toLocaleString("en-US")}`}
                                                                    getOptionValue={(s) => s.id}
                                                                    placeholder="انتخاب خدمت"
                                                                    searchPlaceholder="جستجوی خدمت"
                                                                    dir="rtl"
                                                                />
                                                            </div>
                                                            <div className="col-span-2">
                                                                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                    قیمت
                                                                </label>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    value={si.price ?? ""}
                                                                    onChange={(e) => updateServiceItem(index, "price", parseFloat(e.target.value) || 0)}
                                                                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                                    dir="ltr"
                                                                />
                                                            </div>
                                                            <div className="col-span-2">
                                                                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                                    {translations.amount}
                                                                </label>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    min="0.01"
                                                                    value={si.quantity ?? ""}
                                                                    onChange={(e) => updateServiceItem(index, "quantity", parseFloat(e.target.value) || 1)}
                                                                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                                    dir="ltr"
                                                                />
                                                            </div>
                                                            <div className="col-span-1">
                                                                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.discount}</label>
                                                                <select
                                                                    value={si.discount_type || ''}
                                                                    onChange={(e) => updateServiceItem(index, "discount_type", (e.target.value || "") as "" | "percent" | "fixed")}
                                                                    className="w-full px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                                    dir="rtl"
                                                                >
                                                                    <option value="">—</option>
                                                                    <option value="percent">{translations.percent}</option>
                                                                    <option value="fixed">{translations.fixed}</option>
                                                                </select>
                                                            </div>
                                                            <div className="col-span-1">
                                                                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{si.discount_type === 'percent' ? '%' : translations.fixed}</label>
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    min="0"
                                                                    value={si.discount_value ?? ''}
                                                                    onChange={(e) => updateServiceItem(index, "discount_value", parseFloat(e.target.value) || 0)}
                                                                    className="w-full px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                                    dir="ltr"
                                                                    disabled={!si.discount_type}
                                                                />
                                                            </div>
                                                            <div className="col-span-1">
                                                                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.total}</div>
                                                                <div className="px-3 py-2 bg-teal-100 dark:bg-teal-900/30 rounded-lg text-sm font-bold text-teal-700 dark:text-teal-300">
                                                                    {calculateServiceItemTotal(si).toLocaleString("en-US")}
                                                                </div>
                                                            </div>
                                                            <div className="col-span-1">
                                                                <motion.button
                                                                    type="button"
                                                                    whileHover={{ scale: 1.1 }}
                                                                    whileTap={{ scale: 0.9 }}
                                                                    onClick={() => removeServiceItem(index)}
                                                                    className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors text-sm"
                                                                >
                                                                    {translations.removeItem}
                                                                </motion.button>
                                                            </div>
                                                        </div>
                                                    </motion.div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Subtotal, order discount, total */}
                                        <div className="mt-4 p-4 bg-gradient-to-r from-purple-100 to-blue-100 dark:from-purple-900/30 dark:to-blue-900/30 rounded-xl space-y-3">
                                            <div className="flex justify-between items-center">
                                                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{translations.subtotal}:</span>
                                                <span className="text-lg font-bold text-gray-900 dark:text-white">{calculateSubtotal().toLocaleString('en-US')}</span>
                                            </div>
                                            <div className="grid grid-cols-12 gap-2 items-end mb-2">
                                                <div className="col-span-4">
                                                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.discountCode}</label>
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="text"
                                                            value={discountCodeInput}
                                                            onChange={(e) => setDiscountCodeInput(e.target.value.trim().toUpperCase())}
                                                            placeholder="کد تخفیف"
                                                            className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                            dir="ltr"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={async () => {
                                                                if (!discountCodeInput.trim()) return;
                                                                try {
                                                                    const subtotal = calculateSubtotal();
                                                                    const [type, value] = await validateDiscountCode(discountCodeInput, subtotal);
                                                                    setFormData(prev => ({ ...prev, order_discount_type: type as "percent" | "fixed", order_discount_value: value }));
                                                                    toast.success("کد تخفیف اعمال شد");
                                                                } catch (err: any) {
                                                                    toast.error(err?.message || "کد تخفیف معتبر نیست");
                                                                }
                                                            }}
                                                            className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium"
                                                        >
                                                            {translations.applyCode}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-12 gap-2 items-end">
                                                <div className="col-span-4">
                                                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.orderDiscount}</label>
                                                    <select
                                                        value={formData.order_discount_type}
                                                        onChange={(e) => setFormData({ ...formData, order_discount_type: (e.target.value || "") as "" | "percent" | "fixed" })}
                                                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                        dir="rtl"
                                                    >
                                                        <option value="">—</option>
                                                        <option value="percent">{translations.percent}</option>
                                                        <option value="fixed">{translations.fixed}</option>
                                                    </select>
                                                </div>
                                                <div className="col-span-3">
                                                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                        {formData.order_discount_type === 'percent' ? '%' : translations.fixed}
                                                    </label>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        min="0"
                                                        value={formData.order_discount_value || ''}
                                                        onChange={(e) => setFormData({ ...formData, order_discount_value: parseFloat(e.target.value) || 0 })}
                                                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                                                        dir="ltr"
                                                        disabled={!formData.order_discount_type}
                                                    />
                                                </div>
                                                <div className="col-span-5 flex justify-end items-center gap-2">
                                                    {formData.order_discount_type && formData.order_discount_value > 0 && (
                                                        <span className="text-sm text-amber-700 dark:text-amber-400">
                                                            {translations.orderDiscountAmount}: {calculateOrderDiscountAmount().toLocaleString('en-US')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            {formData.order_discount_type && formData.order_discount_value > 0 && (
                                                <div className="flex justify-between items-center text-sm">
                                                    <span className="font-semibold text-gray-700 dark:text-gray-300">{translations.totalAfterOrderDiscount}:</span>
                                                    <span className="font-bold">{(calculateSubtotal() - calculateOrderDiscountAmount()).toLocaleString('en-US')}</span>
                                                </div>
                                            )}
                                            <div className="flex justify-between items-center">
                                                <span className="text-lg font-bold text-gray-900 dark:text-white">
                                                    {translations.totalAmount}:
                                                </span>
                                                <span className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                                                    {calculateTotal().toLocaleString('en-US')}
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                        {translations.paidAmount}
                                                    </label>
                                                    <input
                                                        type="number"
                                                        value={formData.paid_amount}
                                                        onChange={(e) => setFormData({ ...formData, paid_amount: parseFloat(e.target.value) || 0 })}
                                                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-lg font-bold focus:outline-none focus:border-purple-500"
                                                        dir="ltr"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                        {translations.remainingAmount}
                                                    </label>
                                                    <div className="px-3 py-2 rounded-lg bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-white text-lg font-bold">
                                                        {calculateRemaining().toLocaleString('en-US')}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Initial payment section - only when creating new sale */}
                                    {!editingSale && (
                                        <div className="p-5 rounded-2xl bg-emerald-50/80 dark:bg-emerald-900/20 border border-emerald-200/60 dark:border-emerald-700/40">
                                            <div className="flex items-center gap-2 mb-4">
                                                <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">{translations.initialPaymentOptional}</span>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{translations.paymentAmount}</label>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={initialPaymentFormData.amount}
                                                        onChange={(e) => setInitialPaymentFormData({ ...initialPaymentFormData, amount: e.target.value })}
                                                        className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-all"
                                                        placeholder="0"
                                                        dir="ltr"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{translations.paymentCurrency}</label>
                                                    <select
                                                        value={initialPaymentFormData.currency_id}
                                                        onChange={(e) => {
                                                            const id = e.target.value;
                                                            const cur = currencies.find(c => c.id.toString() === id);
                                                            setInitialPaymentFormData({
                                                                ...initialPaymentFormData,
                                                                currency_id: id,
                                                                exchange_rate: cur?.rate ?? 1,
                                                                account_id: "",
                                                            });
                                                        }}
                                                        className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-all"
                                                        dir="rtl"
                                                    >
                                                        <option value="">انتخاب ارز</option>
                                                        {currencies.map((c) => (
                                                            <option key={c.id} value={c.id}>{c.name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">حساب {translations.optional}</label>
                                                    <select
                                                        value={initialPaymentFormData.account_id}
                                                        onChange={(e) => setInitialPaymentFormData({ ...initialPaymentFormData, account_id: e.target.value })}
                                                        className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-all disabled:opacity-50"
                                                        dir="rtl"
                                                        disabled={!initialPaymentFormData.currency_id}
                                                    >
                                                        <option value="">انتخاب حساب</option>
                                                        {getFilteredAccountsForInitialPayment().map((acc) => (
                                                            <option key={acc.id} value={acc.id}>{acc.name} {acc.account_code ? `(${acc.account_code})` : ""}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{translations.paymentRate}</label>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={initialPaymentFormData.exchange_rate}
                                                        onChange={(e) => setInitialPaymentFormData({ ...initialPaymentFormData, exchange_rate: parseFloat(e.target.value) || 1 })}
                                                        className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-all"
                                                        dir="ltr"
                                                    />
                                                </div>
                                            </div>
                                            <div className="mt-4 flex items-center gap-4 flex-wrap">
                                                <div className="flex-1 min-w-[140px]">
                                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{translations.paymentDate}</label>
                                                    <PersianDatePicker
                                                        value={initialPaymentFormData.date}
                                                        onChange={(date) => setInitialPaymentFormData({ ...initialPaymentFormData, date })}
                                                        placeholder={translations.placeholders.date}
                                                    />
                                                </div>
                                                <div className="flex-1 min-w-[140px]">
                                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">{translations.paymentNotes}</label>
                                                    <input
                                                        type="text"
                                                        value={initialPaymentFormData.notes}
                                                        onChange={(e) => setInitialPaymentFormData({ ...initialPaymentFormData, notes: e.target.value })}
                                                        className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-all"
                                                        placeholder={translations.placeholders.notes}
                                                        dir="rtl"
                                                    />
                                                </div>
                                                {parseFloat(initialPaymentFormData.amount) > 0 && (
                                                    <div className="px-4 py-3 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 border border-emerald-300/50 dark:border-emerald-700/50">
                                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{translations.paymentTotal}: </span>
                                                        <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{parseFloat(initialPaymentFormData.total || "0").toLocaleString("en-US")} افغانی</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
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

                {/* View Sale Items Modal */}
                <AnimatePresence>
                    {isViewModalOpen && viewingSale && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4"
                            onClick={() => setIsViewModalOpen(false)}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                                animate={{ scale: 1, opacity: 1, y: 0 }}
                                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-5xl max-h-[90vh] overflow-y-auto border border-purple-100 dark:border-purple-900/30"
                            >
                                {/* Header */}
                                <div className="flex justify-between items-center mb-8 pb-6 border-b border-gray-200 dark:border-gray-700">
                                    <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-blue-500 rounded-2xl flex items-center justify-center shadow-lg">
                                            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                                            </svg>
                                        </div>
                                        <div>
                                            <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                                                جزئیات فروش
                                            </h2>
                                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                                مشاهده اطلاعات کامل فروش
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => handlePrintInvoice(viewingSale)}
                                            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl shadow-md transition-all duration-200"
                                            title="چاپ فاکتور"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                            </svg>
                                            {translations.printInvoice}
                                        </motion.button>
                                        <motion.button
                                            whileHover={{ scale: 1.1, rotate: 90 }}
                                            whileTap={{ scale: 0.9 }}
                                            onClick={() => setIsViewModalOpen(false)}
                                            className="w-10 h-10 flex items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200"
                                        >
                                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </motion.button>
                                    </div>
                                </div>

                                {/* Sale Info */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                                    <motion.div
                                        whileHover={{ scale: 1.02 }}
                                        className="p-5 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-2xl border border-purple-200/50 dark:border-purple-700/30">
                                        <div className="flex items-center gap-3 mb-2">
                                            <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                            </svg>
                                            <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
                                                {translations.customer}
                                            </label>
                                        </div>
                                        <p className="text-lg font-semibold text-gray-900 dark:text-white mr-8">
                                            {getCustomerName(viewingSale.sale.customer_id)}
                                        </p>
                                    </motion.div>
                                    <motion.div
                                        whileHover={{ scale: 1.02 }}
                                        className="p-5 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-2xl border border-green-200/50 dark:border-green-700/30">
                                        <div className="flex items-center gap-3 mb-2">
                                            <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                            </svg>
                                            <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
                                                {translations.date}
                                            </label>
                                        </div>
                                        <p className="text-lg font-semibold text-gray-900 dark:text-white mr-8">
                                            {formatPersianDate(viewingSale.sale.date)}
                                        </p>
                                    </motion.div>
                                    <motion.div
                                        whileHover={{ scale: 1.02 }}
                                        className="p-5 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-2xl border border-amber-200/50 dark:border-amber-700/30">
                                        <div className="flex items-center gap-3 mb-2">
                                            <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
                                                {translations.totalAmount}
                                            </label>
                                        </div>
                                        <p className="text-lg font-semibold text-gray-900 dark:text-white mr-8">
                                            {viewingSale.sale.total_amount.toLocaleString('en-US')}
                                        </p>
                                    </motion.div>
                                    <motion.div
                                        whileHover={{ scale: 1.02 }}
                                        className="p-5 bg-gradient-to-br from-red-50 to-pink-50 dark:from-red-900/20 dark:to-pink-900/20 rounded-2xl border border-red-200/50 dark:border-red-700/30">
                                        <div className="flex items-center gap-3 mb-2">
                                            <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
                                                {translations.remainingAmount}
                                            </label>
                                        </div>
                                        <p className="text-lg font-semibold text-gray-900 dark:text-white mr-8">
                                            {(viewingSale.sale.total_amount - viewingSale.sale.paid_amount).toLocaleString('en-US')}
                                        </p>
                                    </motion.div>
                                    {viewingSale.additional_costs && viewingSale.additional_costs.length > 0 && (
                                        <motion.div
                                            whileHover={{ scale: 1.02 }}
                                            className="p-5 bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-900/20 dark:to-violet-900/20 rounded-2xl border border-indigo-200/50 dark:border-indigo-700/30">
                                            <div className="flex items-center gap-3 mb-2">
                                                <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                <label className="text-sm font-bold text-gray-700 dark:text-gray-300">
                                                    هزینه‌های اضافی
                                                </label>
                                            </div>
                                            <div className="space-y-2 mr-8">
                                                {viewingSale.additional_costs.map((cost, idx) => (
                                                    <div key={cost.id || idx} className="flex justify-between items-center">
                                                        <span className="text-gray-700 dark:text-gray-300">{cost.name}:</span>
                                                        <span className="text-lg font-semibold text-gray-900 dark:text-white">
                                                            {cost.amount.toLocaleString('en-US')} افغانی
                                                        </span>
                                                    </div>
                                                ))}
                                                <div className="pt-2 border-t border-indigo-200 dark:border-indigo-700 flex justify-between items-center">
                                                    <span className="font-bold text-gray-900 dark:text-white">مجموع:</span>
                                                    <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
                                                        {viewingSale.additional_costs.reduce((sum, cost) => sum + cost.amount, 0).toLocaleString('en-US')} افغانی
                                                    </span>
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </div>

                                {/* Items Table */}
                                <div className="bg-gray-50 dark:bg-gray-700/30 rounded-2xl border border-gray-200 dark:border-gray-600 overflow-hidden">
                                    <table className="w-full text-right">
                                        <thead className="bg-gray-100 dark:bg-gray-700">
                                            <tr>
                                                <th className="px-6 py-4 text-sm font-bold text-gray-700 dark:text-gray-300">{translations.product}</th>
                                                <th className="px-6 py-4 text-sm font-bold text-gray-700 dark:text-gray-300">{translations.unit}</th>
                                                <th className="px-6 py-4 text-sm font-bold text-gray-700 dark:text-gray-300">{translations.perPrice}</th>
                                                <th className="px-6 py-4 text-sm font-bold text-gray-700 dark:text-gray-300">{translations.amount}</th>
                                                <th className="px-6 py-4 text-sm font-bold text-gray-700 dark:text-gray-300">{translations.discount}</th>
                                                <th className="px-6 py-4 text-sm font-bold text-gray-700 dark:text-gray-300">{translations.total}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                                            {viewingSale.items.map((item) => {
                                                const lineSubtotal = item.per_price * item.amount;
                                                const lineDisc = (item.discount_type && (item.discount_type === 'percent' || item.discount_type === 'fixed') && (item.discount_value ?? 0) > 0)
                                                    ? (item.discount_type === 'percent' ? (lineSubtotal * Math.min(100, item.discount_value!) / 100) : Math.min(item.discount_value!, lineSubtotal))
                                                    : 0;
                                                return (
                                                    <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{getProductName(item.product_id)}</td>
                                                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{getUnitName(item.unit_id)}</td>
                                                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300" dir="ltr">{item.per_price.toLocaleString('en-US')}</td>
                                                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300" dir="ltr">{item.amount.toLocaleString('en-US')}</td>
                                                        <td className="px-6 py-4 text-sm text-amber-600 dark:text-amber-400" dir="ltr">{lineDisc > 0 ? `-${lineDisc.toLocaleString('en-US')}` : '—'}</td>
                                                        <td className="px-6 py-4 text-sm font-bold text-purple-600 dark:text-purple-400" dir="ltr">{item.total.toLocaleString('en-US')}</td>
                                                    </tr>
                                                );
                                            })}
                                            {(viewingSale.service_items || []).map((si) => (
                                                <tr key={`s-${si.id}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors bg-teal-50/50 dark:bg-teal-900/10">
                                                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300" colSpan={2}>{si.name} ({translations.service})</td>
                                                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300" dir="ltr">{si.price.toLocaleString('en-US')}</td>
                                                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300" dir="ltr">{si.quantity.toLocaleString('en-US')}</td>
                                                    <td className="px-6 py-4 text-sm text-amber-600 dark:text-amber-400" dir="ltr">
                                                        {((si.discount_type === 'percent' || si.discount_type === 'fixed') && (si.discount_value ?? 0) > 0)
                                                            ? `-${(si.discount_type === 'percent' ? (si.price * si.quantity * Math.min(100, si.discount_value!) / 100) : Math.min(si.discount_value!, si.price * si.quantity)).toLocaleString('en-US')}`
                                                            : '—'}
                                                    </td>
                                                    <td className="px-6 py-4 text-sm font-bold text-teal-600 dark:text-teal-400" dir="ltr">{si.total.toLocaleString('en-US')}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            {(() => {
                                                const itemsTotal = viewingSale.items.reduce((sum, item) => sum + item.total, 0);
                                                const serviceItemsTotal = (viewingSale.service_items || []).reduce((sum, si) => sum + si.total, 0);
                                                const subtotal = itemsTotal + serviceItemsTotal;
                                                const orderDisc = viewingSale.sale.order_discount_amount ?? 0;
                                                return (
                                                    <>
                                                        <tr className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
                                                            <td colSpan={5} className="px-6 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">{translations.subtotal}:</td>
                                                            <td className="px-6 py-3 text-left font-semibold">{subtotal.toLocaleString('en-US')}</td>
                                                        </tr>
                                                        {orderDisc > 0 && (
                                                            <tr className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20">
                                                                <td colSpan={5} className="px-6 py-3 text-right font-semibold text-amber-700 dark:text-amber-400">{translations.orderDiscountAmount}:</td>
                                                                <td className="px-6 py-3 text-left font-semibold text-amber-700 dark:text-amber-400">-{orderDisc.toLocaleString('en-US')}</td>
                                                            </tr>
                                                        )}
                                                        {viewingSale.additional_costs && viewingSale.additional_costs.length > 0 && viewingSale.additional_costs.map((cost, idx) => (
                                                            <tr key={cost.id || idx} className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20">
                                                                <td colSpan={5} className="px-6 py-3 text-right font-semibold text-gray-700 dark:text-gray-300">{cost.name}:</td>
                                                                <td className="px-6 py-3 text-left font-semibold text-green-700 dark:text-green-400">+{cost.amount.toLocaleString('en-US')}</td>
                                                            </tr>
                                                        ))}
                                                    </>
                                                );
                                            })()}
                                            <tr className="bg-gradient-to-r from-purple-100 to-blue-100 dark:from-purple-900/40 dark:to-blue-900/40">
                                                <td colSpan={5} className="px-6 py-5 text-right font-bold text-gray-900 dark:text-white text-lg">
                                                    {translations.totalAmount}:
                                                </td>
                                                <td className="px-6 py-5 text-left">
                                                    <span className="inline-block px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-bold text-xl rounded-xl shadow-lg">
                                                        {viewingSale.sale.total_amount.toLocaleString('en-US')} افغانی
                                                    </span>
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>

                            {/* Payments Section */}
                            <div className="mt-8">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                        <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                                        </svg>
                                        {translations.payments.history}
                                    </h3>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {/* Payments List */}
                                    <div className="md:col-span-2 space-y-3 max-h-60 overflow-y-auto">
                                        {payments.length === 0 ? (
                                            <div className="text-center py-8 bg-gray-50 dark:bg-gray-700/30 rounded-xl border border-dashed border-gray-300 dark:border-gray-600">
                                                <p className="text-gray-500 dark:text-gray-400">{translations.payments.noPayments}</p>
                                            </div>
                                        ) : (
                                            payments.map((payment) => (
                                                <div key={payment.id} className="flex justify-between items-center p-4 bg-white dark:bg-gray-700 rounded-xl border border-gray-100 dark:border-gray-600 shadow-sm">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 dark:text-green-400 font-bold text-sm">
                                                            $
                                                        </div>
                                                        <div>
                                                            <div className="font-bold text-gray-900 dark:text-white">
                                                                {payment.amount.toLocaleString('en-US')}
                                                            </div>
                                                            <div className="text-sm text-gray-500 dark:text-gray-400">
                                                                {formatPersianDate(payment.date)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleDeletePayment(payment.id)}
                                                        className="text-red-500 hover:text-red-700 p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                        title={translations.delete}
                                                    >
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    {/* Add Payment Form */}
                                    <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-xl border border-gray-200 dark:border-gray-600 h-fit">
                                        <h4 className="font-bold text-gray-900 dark:text-white mb-4 text-sm">{translations.payments.add}</h4>
                                        <form onSubmit={handleAddPayment} className="space-y-3">
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                    {translations.payments.date}
                                                </label>
                                                <PersianDatePicker
                                                    value={newPayment.date}
                                                    onChange={(date) => setNewPayment({ ...newPayment, date })}
                                                    placeholder={translations.placeholders.date}
                                                    required
                                                    className="text-sm"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                    ارز
                                                </label>
                                                <select
                                                    value={newPayment.currency_id}
                                                    onChange={(e) => {
                                                        const selectedCurrencyId = e.target.value;
                                                        const selectedCurrency = currencies.find(c => c.id.toString() === selectedCurrencyId);
                                                        setNewPayment({ 
                                                            ...newPayment, 
                                                            currency_id: selectedCurrencyId,
                                                            exchange_rate: selectedCurrency ? selectedCurrency.rate : 1,
                                                            account_id: "" // Reset account when currency changes
                                                        });
                                                    }}
                                                    required
                                                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500"
                                                    dir="rtl"
                                                >
                                                    <option value="">انتخاب ارز</option>
                                                    {currencies.map((currency) => (
                                                        <option key={currency.id} value={currency.id}>
                                                            {currency.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                    حساب
                                                </label>
                                                <select
                                                    value={newPayment.account_id}
                                                    onChange={(e) => setNewPayment({ ...newPayment, account_id: e.target.value })}
                                                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    dir="rtl"
                                                    disabled={!newPayment.currency_id}
                                                >
                                                    <option value="">انتخاب حساب (اختیاری)</option>
                                                    {getFilteredAccounts().map((account) => (
                                                        <option key={account.id} value={account.id}>
                                                            {account.name} {account.account_code ? `(${account.account_code})` : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                                {newPayment.currency_id && getFilteredAccounts().length === 0 && (
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                        هیچ حسابی با این ارز یافت نشد
                                                    </p>
                                                )}
                                                {newPayment.account_id && selectedAccountBalance !== null && (
                                                    <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                                                موجودی حساب:
                                                            </span>
                                                            <span className={`text-sm font-bold ${
                                                                selectedAccountBalance >= 0 
                                                                    ? 'text-green-600 dark:text-green-400' 
                                                                    : 'text-red-600 dark:text-red-400'
                                                            }`}>
                                                                {selectedAccountBalance.toLocaleString('en-US')} {currencies.find(c => c.id.toString() === newPayment.currency_id)?.name || ''}
                                                            </span>
                                                        </div>
                                                        {parseFloat(newPayment.amount) > 0 && (
                                                            <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-800">
                                                                <div className="flex justify-between items-center">
                                                                    <span className="text-xs text-gray-600 dark:text-gray-400">
                                                                        موجودی پس از پرداخت:
                                                                    </span>
                                                                    <span className={`text-xs font-semibold ${
                                                                        (selectedAccountBalance + parseFloat(newPayment.amount)) >= 0 
                                                                            ? 'text-green-600 dark:text-green-400' 
                                                                            : 'text-red-600 dark:text-red-400'
                                                                    }`}>
                                                                        {(selectedAccountBalance + parseFloat(newPayment.amount)).toLocaleString('en-US')} {currencies.find(c => c.id.toString() === newPayment.currency_id)?.name || ''}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                        {translations.payments.amount}
                                                    </label>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={newPayment.amount}
                                                        onChange={(e) => setNewPayment({ ...newPayment, amount: e.target.value })}
                                                        required
                                                        placeholder="0.00"
                                                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500"
                                                        dir="ltr"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                                                        نرخ تبدیل
                                                    </label>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={newPayment.exchange_rate}
                                                        onChange={(e) => setNewPayment({ ...newPayment, exchange_rate: parseFloat(e.target.value) || 1 })}
                                                        required
                                                        placeholder="1.00"
                                                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-purple-500"
                                                        dir="ltr"
                                                    />
                                                </div>
                                            </div>
                                            <button
                                                type="submit"
                                                disabled={loading}
                                                className="w-full py-2 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold rounded-lg text-sm shadow-md transition-all duration-200 flex justify-center items-center gap-2"
                                            >
                                                {loading ? (
                                                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                ) : (
                                                    <>
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                                        </svg>
                                                        {translations.payments.add}
                                                    </>
                                                )}
                                            </button>
                                        </form>
                                    </div>
                                </div>
                            </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Discount Token (Code) CRUD Modal */}
                <AnimatePresence>
                    {isDiscountTokenModalOpen && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4"
                            onClick={() => {
                                setIsDiscountTokenModalOpen(false);
                                setEditingDiscountToken(null);
                                setDiscountTokenDeleteId(null);
                            }}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                                animate={{ scale: 1, opacity: 1, y: 0 }}
                                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden border border-purple-100 dark:border-purple-900/30 flex flex-col"
                            >
                                <div className="px-8 py-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">{translations.discountTokenManage}</h2>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsDiscountTokenModalOpen(false);
                                            setEditingDiscountToken(null);
                                            setDiscountTokenDeleteId(null);
                                        }}
                                        className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
                                    >
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                                <div className="p-8 overflow-y-auto flex-1">
                                    <form onSubmit={handleDiscountTokenSubmit} className="mb-8 p-6 bg-gray-50 dark:bg-gray-700/50 rounded-2xl border border-gray-200 dark:border-gray-600">
                                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">{editingDiscountToken ? translations.edit : translations.addDiscountToken}</h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.discountCode}</label>
                                                <input
                                                    type="text"
                                                    value={discountTokenForm.code}
                                                    onChange={(e) => setDiscountTokenForm({ ...discountTokenForm, code: e.target.value })}
                                                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                    placeholder="مثلاً SUMMER20"
                                                    dir="ltr"
                                                    disabled={!!editingDiscountToken}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.discountType}</label>
                                                <select
                                                    value={discountTokenForm.type}
                                                    onChange={(e) => setDiscountTokenForm({ ...discountTokenForm, type: e.target.value as "percent" | "fixed" })}
                                                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                >
                                                    <option value="percent">{translations.percent}</option>
                                                    <option value="fixed">{translations.fixed}</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.discount}</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min={0}
                                                    value={discountTokenForm.value || ""}
                                                    onChange={(e) => setDiscountTokenForm({ ...discountTokenForm, value: parseFloat(e.target.value) || 0 })}
                                                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                    dir="ltr"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.minPurchase}</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min={0}
                                                    value={discountTokenForm.min_purchase || ""}
                                                    onChange={(e) => setDiscountTokenForm({ ...discountTokenForm, min_purchase: parseFloat(e.target.value) || 0 })}
                                                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                    dir="ltr"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.validFrom}</label>
                                                <input
                                                    type="date"
                                                    value={discountTokenForm.valid_from}
                                                    onChange={(e) => setDiscountTokenForm({ ...discountTokenForm, valid_from: e.target.value })}
                                                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.validTo}</label>
                                                <input
                                                    type="date"
                                                    value={discountTokenForm.valid_to}
                                                    onChange={(e) => setDiscountTokenForm({ ...discountTokenForm, valid_to: e.target.value })}
                                                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.maxUses}</label>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    value={discountTokenForm.max_uses === "" ? "" : discountTokenForm.max_uses}
                                                    onChange={(e) => setDiscountTokenForm({ ...discountTokenForm, max_uses: e.target.value === "" ? "" : parseInt(e.target.value, 10) })}
                                                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                                    placeholder="نامحدود"
                                                    dir="ltr"
                                                />
                                            </div>
                                        </div>
                                        <div className="mt-4 flex gap-2">
                                            <button
                                                type="submit"
                                                disabled={loading}
                                                className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-bold rounded-xl disabled:opacity-50"
                                            >
                                                {loading ? "..." : (editingDiscountToken ? translations.save : translations.addDiscountToken)}
                                            </button>
                                            {editingDiscountToken && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setEditingDiscountToken(null);
                                                        setDiscountTokenForm({ code: "", type: "percent", value: 0, min_purchase: 0, valid_from: "", valid_to: "", max_uses: "" });
                                                    }}
                                                    className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-white font-bold rounded-xl"
                                                >
                                                    {translations.cancel}
                                                </button>
                                            )}
                                        </div>
                                    </form>
                                    <div>
                                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-3">لیست کدهای تخفیف</h3>
                                        {discountCodes.length === 0 ? (
                                            <p className="text-gray-500 dark:text-gray-400 py-4">{translations.noDiscountTokens}</p>
                                        ) : (
                                            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-600">
                                                <table className="w-full text-sm">
                                                    <thead className="bg-gray-100 dark:bg-gray-700">
                                                        <tr>
                                                            <th className="px-4 py-3 text-right font-bold text-gray-700 dark:text-gray-300">کد</th>
                                                            <th className="px-4 py-3 text-right font-bold text-gray-700 dark:text-gray-300">نوع</th>
                                                            <th className="px-4 py-3 text-right font-bold text-gray-700 dark:text-gray-300">مقدار</th>
                                                            <th className="px-4 py-3 text-right font-bold text-gray-700 dark:text-gray-300">{translations.minPurchase}</th>
                                                            <th className="px-4 py-3 text-right font-bold text-gray-700 dark:text-gray-300">{translations.useCount}</th>
                                                            <th className="px-4 py-3 text-right font-bold text-gray-700 dark:text-gray-300">عملیات</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                                                        {discountCodes.map((dc) => (
                                                            <tr key={dc.id} className="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                                                <td className="px-4 py-3 font-mono text-gray-900 dark:text-white">{dc.code}</td>
                                                                <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{dc.type === "percent" ? "درصد" : "مبلغ ثابت"}</td>
                                                                <td className="px-4 py-3 text-gray-700 dark:text-gray-300" dir="ltr">{dc.type === "percent" ? `${dc.value}%` : dc.value.toLocaleString("en-US")}</td>
                                                                <td className="px-4 py-3 text-gray-700 dark:text-gray-300" dir="ltr">{dc.min_purchase.toLocaleString("en-US")}</td>
                                                                <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{dc.use_count}{dc.max_uses != null ? ` / ${dc.max_uses}` : ""}</td>
                                                                <td className="px-4 py-3 flex gap-2">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleEditDiscountToken(dc)}
                                                                        className="text-blue-600 dark:text-blue-400 hover:underline"
                                                                    >
                                                                        {translations.edit}
                                                                    </button>
                                                                    {discountTokenDeleteId === dc.id ? (
                                                                        <>
                                                                            <span className="text-amber-600 dark:text-amber-400 text-xs">{translations.confirmDeleteDiscountToken}</span>
                                                                            <button type="button" onClick={() => handleDeleteDiscountToken(dc.id)} className="text-red-600 dark:text-red-400 font-bold">بله، حذف</button>
                                                                            <button type="button" onClick={() => setDiscountTokenDeleteId(null)} className="text-gray-600 dark:text-gray-400">لغو</button>
                                                                        </>
                                                                    ) : (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setDiscountTokenDeleteId(dc.id)}
                                                                            className="text-red-600 dark:text-red-400 hover:underline"
                                                                        >
                                                                            {translations.delete}
                                                                        </button>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                </div>
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
                                    {/* Warning Icon */}
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

                                    {/* Title */}
                                    <h2 className="text-2xl font-bold text-center text-gray-900 dark:text-white mb-3">
                                        {translations.delete}
                                    </h2>

                                    {/* Message */}
                                    <p className="text-center text-gray-600 dark:text-gray-400 mb-8 leading-relaxed">
                                        {translations.confirmDelete}
                                    </p>

                                    {/* Action Buttons */}
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

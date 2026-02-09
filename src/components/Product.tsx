import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
  initProductsTable,
  createProduct,
  getProducts,
  updateProduct,
  deleteProduct,
  type Product,
} from "../utils/product";
import { getCurrencies, type Currency } from "../utils/currency";
import { getSuppliers, type Supplier } from "../utils/supplier"; // getSuppliers is now paginated
import { isDatabaseOpen, openDatabase } from "../utils/db";
import Footer from "./Footer";
import Table from "./common/Table";
import PageHeader from "./common/PageHeader";
import ViewModeToggle, { type ViewMode } from "./common/ViewModeToggle";
import ThumbnailGrid from "./common/ThumbnailGrid";
import { Search } from "lucide-react";
import JsBarcode from "jsbarcode";
import * as QRCode from "qrcode";

// Dari translations
const translations = {
  title: "جنس",
  addNew: "افزودن جنس جدید",
  edit: "ویرایش",
  delete: "حذف",
  cancel: "لغو",
  save: "ذخیره",
  name: "نام جنس",
  description: "توضیحات",
  price: "قیمت",
  currency: "ارز",
  supplier: "تمویل کننده",
  stockQuantity: "مقدار موجودی",
  unit: "واحد",
  image: "تصویر",
  barCode: "بارکد",
  selectCurrency: "انتخاب ارز",
  selectSupplier: "انتخاب تمویل کننده",
  noCurrency: "بدون ارز",
  noSupplier: "بدون تمویل کننده",
  actions: "عملیات",
  createdAt: "تاریخ ایجاد",
  updatedAt: "آخرین بروزرسانی",
  noProducts: "هیچ جنسی ثبت نشده است",
  confirmDelete: "آیا از حذف این جنس اطمینان دارید؟",
  backToDashboard: "بازگشت به داشبورد",
  selectImage: "انتخاب تصویر",
  removeImage: "حذف تصویر",
  generateBarcode: "تولید بارکد",
  autoGenerateBarcode: "تولید خودکار",
  generateQRCode: "تولید QR Code",
  downloadBarcode: "دانلود بارکد",
  downloadQRCode: "دانلود QR Code",
  barcode: "بارکد",
  qrCode: "QR Code",
  success: {
    created: "جنس با موفقیت ایجاد شد",
    updated: "جنس با موفقیت بروزرسانی شد",
    deleted: "جنس با موفقیت حذف شد",
    tableInit: "جدول اجناس با موفقیت ایجاد شد",
  },
  errors: {
    create: "خطا در ایجاد جنس",
    update: "خطا در بروزرسانی جنس",
    delete: "خطا در حذف جنس",
    fetch: "خطا در دریافت اجناس",
    nameRequired: "نام جنس الزامی است",
  },
  placeholders: {
    name: "نام جنس را وارد کنید",
    description: "توضیحات را وارد کنید (اختیاری)",
    price: "قیمت را وارد کنید (اختیاری)",
    stockQuantity: "مقدار موجودی را وارد کنید (اختیاری)",
    unit: "واحد را وارد کنید (مثال: کیلوگرم، عدد) (اختیاری)",
  },
};

interface ProductManagementProps {
  onBack?: () => void;
}

export default function ProductManagement({ onBack }: ProductManagementProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    price: "",
    currency_id: "",
    supplier_id: "",
    stock_quantity: "",
    unit: "",
    image_path: "",
    bar_code: "",
  });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [barcodeModalOpen, setBarcodeModalOpen] = useState<Product | null>(null);
  const [qrCodeModalOpen, setQrCodeModalOpen] = useState<Product | null>(null);
  const barcodeCanvasRef = useRef<HTMLCanvasElement>(null);
  const qrCodeCanvasRef = useRef<HTMLCanvasElement>(null);

  // Pagination & Search
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // View mode: table or thumbnail (persist per page)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem("productViewMode");
      return (saved === "thumbnail" ? "thumbnail" : "table") as ViewMode;
    } catch { return "table"; }
  });
  useEffect(() => {
    try { localStorage.setItem("productViewMode", viewMode); } catch { /* ignore */ }
  }, [viewMode]);

  useEffect(() => {
    loadData();
  }, [page, perPage, search, sortBy, sortOrder]);

  // Generate barcode when modal opens
  useEffect(() => {
    if (barcodeModalOpen && barcodeCanvasRef.current && barcodeModalOpen.bar_code) {
      try {
        JsBarcode(barcodeCanvasRef.current, barcodeModalOpen.bar_code, {
          format: "CODE128",
          width: 2,
          height: 100,
          displayValue: true,
          fontSize: 20,
          margin: 10,
        });
      } catch (error) {
        console.error("Error generating barcode:", error);
        toast.error("خطا در تولید بارکد");
      }
    }
  }, [barcodeModalOpen]);

  // Generate QR code when modal opens
  useEffect(() => {
    if (qrCodeModalOpen && qrCodeCanvasRef.current) {
      const qrData = JSON.stringify({
        id: qrCodeModalOpen.id,
        name: qrCodeModalOpen.name,
        bar_code: qrCodeModalOpen.bar_code || null,
        price: qrCodeModalOpen.price || null,
      });
      
      QRCode.toCanvas(qrCodeCanvasRef.current, qrData, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      }).catch((error) => {
        console.error("Error generating QR code:", error);
        toast.error("خطا در تولید QR Code");
      });
    }
  }, [qrCodeModalOpen]);

  const loadData = async () => {
    try {
      setLoading(true);
      const dbOpen = await isDatabaseOpen();
      if (!dbOpen) {
        await openDatabase("db");
      }

      try {
        await initProductsTable();
      } catch (err) {
        console.log("Table initialization:", err);
      }

      // Fetch products paginated, currencies (all), suppliers (all for dropdown - large perPage)
      const [productsResponse, currenciesData, suppliersResponse] = await Promise.all([
        getProducts(page, perPage, search, sortBy, sortOrder),
        getCurrencies().catch(() => []),
        getSuppliers(1, 1000).catch(() => ({ items: [] } as any)),
      ]);

      setProducts(productsResponse.items);
      setTotalItems(productsResponse.total);
      setCurrencies(currenciesData);
      setSuppliers(suppliersResponse.items || []);
    } catch (error: any) {
      toast.error(translations.errors.fetch);
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast.error("لطفاً یک فایل تصویری انتخاب کنید");
        return;
      }
      
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast.error("حجم فایل نباید بیشتر از 5 مگابایت باشد");
        return;
      }

      // Create a local URL for preview
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setImagePreview(result);
        // Store as data URL (base64)
        setFormData({ ...formData, image_path: result });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setImagePreview(null);
    setFormData({ ...formData, image_path: "" });
  };

  const handleOpenModal = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      setFormData({
        name: product.name,
        description: product.description || "",
        price: product.price?.toString() || "",
        currency_id: product.currency_id?.toString() || "",
        supplier_id: product.supplier_id?.toString() || "",
        stock_quantity: product.stock_quantity?.toString() || "",
        unit: product.unit || "",
        image_path: product.image_path || "",
        bar_code: product.bar_code || "",
      });
      setImagePreview(product.image_path || null);
    } else {
      setEditingProduct(null);
      setFormData({
        name: "",
        description: "",
        price: "",
        currency_id: "",
        supplier_id: "",
        stock_quantity: "",
        unit: "",
        image_path: "",
        bar_code: "",
      });
      setImagePreview(null);
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
    setFormData({
      name: "",
      description: "",
      price: "",
      currency_id: "",
      supplier_id: "",
      stock_quantity: "",
      unit: "",
      image_path: "",
      bar_code: "",
    });
    setImagePreview(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error(translations.errors.nameRequired);
      return;
    }

    try {
      setLoading(true);
      const productData = {
        name: formData.name,
        description: formData.description || null,
        price: formData.price ? parseFloat(formData.price) : null,
        currency_id: formData.currency_id ? parseInt(formData.currency_id) : null,
        supplier_id: formData.supplier_id ? parseInt(formData.supplier_id) : null,
        stock_quantity: formData.stock_quantity ? parseFloat(formData.stock_quantity) : null,
        unit: formData.unit || null,
        image_path: formData.image_path || null,
        bar_code: formData.bar_code || null,
      };

      if (editingProduct) {
        await updateProduct(
          editingProduct.id,
          productData.name,
          productData.description,
          productData.price,
          productData.currency_id,
          productData.supplier_id,
          productData.stock_quantity,
          productData.unit,
          productData.image_path,
          productData.bar_code
        );
        toast.success(translations.success.updated);
      } else {
        await createProduct(
          productData.name,
          productData.description,
          productData.price,
          productData.currency_id,
          productData.supplier_id,
          productData.stock_quantity,
          productData.unit,
          productData.image_path,
          productData.bar_code
        );
        toast.success(translations.success.created);
      }
      handleCloseModal();
      await loadData();
    } catch (error: any) {
      toast.error(editingProduct ? translations.errors.update : translations.errors.create);
      console.error("Error saving product:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      setLoading(true);
      await deleteProduct(id);
      toast.success(translations.success.deleted);
      setDeleteConfirm(null);
      await loadData();
    } catch (error: any) {
      toast.error(translations.errors.delete);
      console.error("Error deleting product:", error);
    } finally {
      setLoading(false);
    }
  };

  const getCurrencyName = (currencyId: number | null | undefined) => {
    if (!currencyId) return null;
    const currency = currencies.find((c) => c.id === currencyId);
    return currency?.name || null;
  };

  const getSupplierName = (supplierId: number | null | undefined) => {
    if (!supplierId) return null;
    const supplier = suppliers.find((s) => s.id === supplierId);
    return supplier?.full_name || null;
  };

  const columns = [
    {
      key: "name", label: translations.name, sortable: true,
      render: (p: Product) => (
        <div className="flex items-center gap-4">
          {p.image_path ? (
            <motion.div
              whileHover={{ scale: 1.1, rotate: 5 }}
              className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 shadow-lg border-2 border-white dark:border-gray-700"
            >
              <img
                src={p.image_path}
                alt={p.name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = "none";
                  const parent = target.parentElement;
                  if (parent) {
                    parent.innerHTML = `<div class="w-full h-full bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-lg">${p.name.charAt(0)}</div>`;
                  }
                }}
              />
            </motion.div>
          ) : (
            <motion.div
              whileHover={{ scale: 1.1, rotate: 5 }}
              className="w-14 h-14 bg-gradient-to-br from-purple-500 via-blue-500 to-indigo-500 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg"
            >
              {p.name.charAt(0)}
            </motion.div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-bold text-gray-900 dark:text-white text-base mb-1">{p.name}</div>
            {p.description && (
              <div className="text-sm text-gray-600 dark:text-gray-400 truncate max-w-[200px] mb-1">
                {p.description}
              </div>
            )}
            {p.bar_code && (
              <div className="text-xs text-gray-500 dark:text-gray-500 font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-lg inline-block">
                🏷️ {p.bar_code}
              </div>
            )}
          </div>
        </div>
      )
    },
    {
      key: "price", label: translations.price, sortable: true,
      render: (p: Product) => p.price ? (
        <div className="flex items-center gap-2">
          <span className="font-bold text-lg text-gray-900 dark:text-white">
            {p.price.toLocaleString('en-US')}
          </span>
          {getCurrencyName(p.currency_id) && (
            <span className="text-xs font-semibold px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-lg">
              {getCurrencyName(p.currency_id)}
            </span>
          )}
        </div>
      ) : (
        <span className="text-gray-400 dark:text-gray-600">-</span>
      )
    },
    {
      key: "stock_quantity", label: translations.stockQuantity, sortable: true,
      render: (p: Product) => p.stock_quantity ? (
        <div className="flex items-center gap-2">
          <span className="font-bold text-lg text-gray-900 dark:text-white">
            {p.stock_quantity.toLocaleString('en-US')}
          </span>
          {p.unit && (
            <span className="text-xs font-semibold px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg">
              {p.unit}
            </span>
          )}
        </div>
      ) : (
        <span className="text-gray-400 dark:text-gray-600">-</span>
      )
    },
    {
      key: "supplier_id", label: translations.supplier, sortable: false,
      render: (p: Product) => (
        <span className="text-sm text-gray-700 dark:text-gray-300">{getSupplierName(p.supplier_id) || "-"}</span>
      )
    },
    {
      key: "created_at", label: translations.createdAt, sortable: true,
      render: (p: Product) => (
        <span className="text-gray-600 dark:text-gray-400 text-sm">
          {new Date(p.created_at).toLocaleDateString('fa-IR')}
        </span>
      )
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 relative overflow-hidden" dir="rtl">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-300 dark:bg-purple-900 rounded-full mix-blend-multiply dark:mix-blend-soft-light filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-300 dark:bg-blue-900 rounded-full mix-blend-multiply dark:mix-blend-soft-light filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-indigo-300 dark:bg-indigo-900 rounded-full mix-blend-multiply dark:mix-blend-soft-light filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <div className="relative max-w-7xl mx-auto p-6 z-10">
        <PageHeader
          title={translations.title}
          onBack={onBack}
          backLabel={translations.backToDashboard}
          actions={[
            {
              label: translations.addNew,
              onClick: () => handleOpenModal(),
              variant: "primary" as const
            }
          ]}
        >
          <ViewModeToggle
            viewMode={viewMode}
            onChange={setViewMode}
            tableLabel="لیست"
            thumbnailLabel="کارت"
          />
        </PageHeader>

        {/* Enhanced Search Bar */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="relative max-w-md w-full mb-6"
        >
          <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none z-10">
            <Search className="h-5 w-5 text-gray-400 dark:text-gray-500" />
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="block w-full pr-12 pl-4 py-4 border-2 border-gray-200 dark:border-gray-700 rounded-2xl leading-5 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:placeholder-gray-400 focus:border-purple-500 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 sm:text-sm transition-all shadow-lg hover:shadow-xl"
            placeholder="جستجو بر اساس نام، بارکد یا توضیحات..."
          />
        </motion.div>

        {/* Table or Thumbnail Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl shadow-2xl border border-purple-100/50 dark:border-purple-900/30 overflow-hidden"
        >
          {viewMode === "table" ? (
            <Table
              data={products}
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
              actions={(product) => (
                <div className="flex items-center gap-2">
                  <motion.button
                    whileHover={{ scale: 1.15, rotate: 5 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => handleOpenModal(product)}
                    className="p-2.5 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-md hover:shadow-lg"
                    title={translations.edit}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.15, rotate: -5 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setBarcodeModalOpen(product)}
                    className="p-2.5 bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-xl hover:from-green-600 hover:to-emerald-700 transition-all duration-200 shadow-md hover:shadow-lg"
                    title={translations.generateBarcode}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.15, rotate: 5 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setQrCodeModalOpen(product)}
                    className="p-2.5 bg-gradient-to-br from-purple-500 to-indigo-600 text-white rounded-xl hover:from-purple-600 hover:to-indigo-700 transition-all duration-200 shadow-md hover:shadow-lg"
                    title={translations.generateQRCode}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.15, rotate: -5 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setDeleteConfirm(product.id)}
                    className="p-2.5 bg-gradient-to-br from-red-500 to-pink-600 text-white rounded-xl hover:from-red-600 hover:to-pink-700 transition-all duration-200 shadow-md hover:shadow-lg"
                    title={translations.delete}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </motion.button>
                </div>
              )}
            />
          ) : (
            <ThumbnailGrid
              data={products}
              total={totalItems}
              page={page}
              perPage={perPage}
              onPageChange={setPage}
              onPerPageChange={setPerPage}
              loading={loading}
              renderCard={(p) => (
                <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800/80 p-4 shadow-lg hover:shadow-xl hover:border-purple-300 dark:hover:border-purple-600 transition-all h-full flex flex-col">
                  <div className="flex justify-center mb-3">
                    {p.image_path ? (
                      <div className="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 shadow-md border border-gray-200 dark:border-gray-600">
                        <img src={p.image_path} alt={p.name} className="w-full h-full object-cover" onError={(e) => {
                          const t = e.target as HTMLImageElement;
                          t.style.display = "none";
                          const par = t.parentElement;
                          if (par) par.innerHTML = `<div class="w-full h-full bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl flex items-center justify-center text-white font-bold text-lg">${p.name.charAt(0)}</div>`;
                        }} />
                      </div>
                    ) : (
                      <div className="w-20 h-20 bg-gradient-to-br from-purple-500 via-blue-500 to-indigo-500 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-md">
                        {p.name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div className="font-bold text-gray-900 dark:text-white text-center mb-1 truncate" title={p.name}>{p.name}</div>
                  {p.description && <div className="text-xs text-gray-600 dark:text-gray-400 text-center truncate mb-1">{p.description}</div>}
                  <div className="flex flex-wrap justify-center gap-1 mb-2">
                    {p.price != null && (
                      <span className="text-sm font-semibold text-gray-800 dark:text-white">
                        {p.price.toLocaleString("en-US")}
                        {getCurrencyName(p.currency_id) && <span className="text-xs text-amber-600 dark:text-amber-400"> {getCurrencyName(p.currency_id)}</span>}
                      </span>
                    )}
                    {p.stock_quantity != null && (
                      <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">{p.stock_quantity.toLocaleString("en-US")}{p.unit ? ` ${p.unit}` : ""}</span>
                    )}
                  </div>
                  {p.bar_code && <div className="text-xs text-gray-500 font-mono mb-2 text-center">🏷️ {p.bar_code}</div>}
                  <div className="flex items-center justify-center gap-1.5 mt-auto pt-2">
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => handleOpenModal(p)} className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg" title={translations.edit}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></motion.button>
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setBarcodeModalOpen(p)} className="p-2 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg" title={translations.generateBarcode}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg></motion.button>
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setQrCodeModalOpen(p)} className="p-2 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-lg" title={translations.generateQRCode}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg></motion.button>
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => setDeleteConfirm(p.id)} className="p-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg" title={translations.delete}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></motion.button>
                  </div>
                </div>
              )}
            />
          )}
        </motion.div>

        {/* Modal for Add/Edit */}
        <AnimatePresence>
          {isModalOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 overflow-y-auto"
              onClick={handleCloseModal}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
                className="relative bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-5xl my-8 overflow-hidden border border-purple-100/50 dark:border-purple-900/30"
              >
                {/* Header with gradient */}
                <div className="relative bg-gradient-to-r from-purple-600 via-blue-600 to-indigo-600 p-8 pb-6">
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-600/90 via-blue-600/90 to-indigo-600/90"></div>
                  <div className="relative flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 bg-white/20 backdrop-blur-xl rounded-2xl flex items-center justify-center border border-white/30">
                        <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-3xl font-extrabold text-white mb-1">
                          {editingProduct ? translations.edit : translations.addNew}
                        </h2>
                        <p className="text-purple-100 text-sm">
                          {editingProduct ? "ویرایش اطلاعات جنس" : "افزودن جنس جدید به سیستم"}
                        </p>
                      </div>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.1, rotate: 90 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={handleCloseModal}
                      className="w-10 h-10 bg-white/20 hover:bg-white/30 backdrop-blur-xl rounded-xl flex items-center justify-center text-white transition-all duration-200 border border-white/30"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </motion.button>
                  </div>
                </div>

                {/* Form Content */}
                <div className="p-8 max-h-[calc(100vh-200px)] overflow-y-auto">
                  <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Main Info Section */}
                    <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-800/50 dark:to-gray-700/50 rounded-2xl p-6 border border-purple-100 dark:border-purple-900/30">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        اطلاعات اصلی
                      </h3>
                      <div className="space-y-5">
                        <div>
                          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                            {translations.name} <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            required
                            className="w-full px-5 py-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all duration-200 text-lg"
                            placeholder={translations.placeholders.name}
                            dir="rtl"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                            {translations.description}
                          </label>
                          <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            rows={4}
                            className="w-full px-5 py-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all duration-200 resize-none"
                            placeholder={translations.placeholders.description}
                            dir="rtl"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Price & Stock Section */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Price & Currency Card */}
                      <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-2xl p-6 border border-amber-200 dark:border-amber-800/30">
                        <h4 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                          <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          قیمت و ارز
                        </h4>
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                              {translations.price}
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              value={formData.price}
                              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                              className="w-full px-5 py-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-amber-500 dark:focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 transition-all duration-200 text-lg"
                              placeholder={translations.placeholders.price}
                              dir="ltr"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                              {translations.currency}
                            </label>
                            <select
                              value={formData.currency_id}
                              onChange={(e) => setFormData({ ...formData, currency_id: e.target.value })}
                              className="w-full px-5 py-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-amber-500 dark:focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20 transition-all duration-200"
                              dir="rtl"
                            >
                              <option value="">{translations.noCurrency}</option>
                              {currencies.map((currency) => (
                                <option key={currency.id} value={currency.id}>
                                  {currency.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Stock & Unit Card */}
                      <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-2xl p-6 border border-green-200 dark:border-green-800/30">
                        <h4 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                          <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                          </svg>
                          موجودی و واحد
                        </h4>
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                              {translations.stockQuantity}
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              value={formData.stock_quantity}
                              onChange={(e) => setFormData({ ...formData, stock_quantity: e.target.value })}
                              className="w-full px-5 py-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-green-500 dark:focus:border-green-400 focus:ring-2 focus:ring-green-500/20 transition-all duration-200 text-lg"
                              placeholder={translations.placeholders.stockQuantity}
                              dir="ltr"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                              {translations.unit}
                            </label>
                            <input
                              type="text"
                              value={formData.unit}
                              onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                              className="w-full px-5 py-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-green-500 dark:focus:border-green-400 focus:ring-2 focus:ring-green-500/20 transition-all duration-200"
                              placeholder={translations.placeholders.unit}
                              dir="rtl"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Supplier & Barcode Section */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-2xl p-6 border border-blue-200 dark:border-blue-800/30">
                        <h4 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                          <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          تمویل کننده
                        </h4>
                        <select
                          value={formData.supplier_id}
                          onChange={(e) => setFormData({ ...formData, supplier_id: e.target.value })}
                          className="w-full px-5 py-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 transition-all duration-200"
                          dir="rtl"
                        >
                          <option value="">{translations.noSupplier}</option>
                          {suppliers.map((supplier) => (
                            <option key={supplier.id} value={supplier.id}>
                              {supplier.full_name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-2xl p-6 border border-purple-200 dark:border-purple-800/30">
                        <h4 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                          <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          بارکد
                        </h4>
                        <div className="flex gap-3">
                          <input
                            type="text"
                            value={formData.bar_code}
                            onChange={(e) => setFormData({ ...formData, bar_code: e.target.value })}
                            className="flex-1 min-w-0 px-5 py-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 transition-all duration-200 font-mono text-lg"
                            placeholder="بارکد را وارد کنید (اختیاری)"
                            dir="ltr"
                          />
                          <motion.button
                            type="button"
                            onClick={() => setFormData({ ...formData, bar_code: String(Math.floor(100000000000 + Math.random() * 900000000000)) })}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className="shrink-0 px-5 py-4 rounded-xl border-2 border-purple-300 dark:border-purple-600 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2 whitespace-nowrap"
                            title={translations.autoGenerateBarcode}
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {translations.autoGenerateBarcode}
                          </motion.button>
                        </div>
                      </div>
                    </div>

                    {/* Image Upload Section */}
                    <div className="bg-gradient-to-br from-cyan-50 to-teal-50 dark:from-cyan-900/20 dark:to-teal-900/20 rounded-2xl p-6 border border-cyan-200 dark:border-cyan-800/30">
                      <h4 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        <svg className="w-5 h-5 text-cyan-600 dark:text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {translations.image}
                      </h4>
                      <div className="space-y-4">
                        <div className="relative">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleSelectImage}
                            className="w-full px-5 py-4 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-cyan-500 dark:focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-200 cursor-pointer hover:border-cyan-400 dark:hover:border-cyan-500"
                          />
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="text-center">
                              <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                              </svg>
                              <p className="text-sm text-gray-500 dark:text-gray-400">{translations.selectImage}</p>
                            </div>
                          </div>
                        </div>
                        {imagePreview && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="relative inline-block"
                          >
                            <div className="relative w-48 h-48 border-4 border-white dark:border-gray-700 rounded-2xl overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 shadow-xl flex items-center justify-center group">
                              <img
                                src={imagePreview}
                                alt="Preview"
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = "none";
                                  const parent = target.parentElement;
                                  if (parent) {
                                    parent.innerHTML = '<p class="text-gray-400 text-sm">خطا در بارگذاری تصویر</p>';
                                  }
                                }}
                              />
                              <motion.button
                                type="button"
                                onClick={handleRemoveImage}
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                className="absolute top-2 left-2 w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </motion.button>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    </div>
                    {/* Action Buttons */}
                    <div className="flex gap-4 pt-6 border-t border-gray-200 dark:border-gray-700">
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.02, x: -2 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={handleCloseModal}
                        className="flex-1 px-6 py-4 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-bold rounded-xl transition-all duration-200 border-2 border-gray-200 dark:border-gray-700 shadow-md hover:shadow-lg"
                      >
                        <span className="flex items-center justify-center gap-2">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          {translations.cancel}
                        </span>
                      </motion.button>
                      <motion.button
                        type="submit"
                        disabled={loading}
                        whileHover={{ scale: loading ? 1 : 1.02, x: 2 }}
                        whileTap={{ scale: loading ? 1 : 0.98 }}
                        className="flex-1 px-6 py-4 bg-gradient-to-r from-purple-600 via-blue-600 to-indigo-600 hover:from-purple-700 hover:via-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl relative overflow-hidden group"
                      >
                        <span className="relative z-10 flex items-center justify-center gap-2">
                          {loading ? (
                            <>
                              <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                              />
                              {translations.save}
                            </>
                          ) : (
                            <>
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              {translations.save}
                            </>
                          )}
                        </span>
                        <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
                      </motion.button>
                    </div>
                  </form>
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

        {/* Barcode Modal */}
        <AnimatePresence>
          {barcodeModalOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4"
              onClick={() => setBarcodeModalOpen(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-green-200/50 dark:border-green-900/30"
              >
                {/* Header */}
                <div className="bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600 p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-white/20 backdrop-blur-xl rounded-xl flex items-center justify-center border border-white/30">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold text-white">{translations.barcode}</h2>
                        <p className="text-green-100 text-sm">{barcodeModalOpen.name}</p>
                      </div>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.1, rotate: 90 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setBarcodeModalOpen(null)}
                      className="w-10 h-10 bg-white/20 hover:bg-white/30 backdrop-blur-xl rounded-xl flex items-center justify-center text-white transition-all duration-200"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </motion.button>
                  </div>
                </div>

                {/* Content */}
                <div className="p-8">
                  <div className="flex flex-col items-center gap-6 mb-6">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border-2 border-gray-200 dark:border-gray-700 shadow-lg">
                      <canvas
                        ref={barcodeCanvasRef}
                        className="bg-white"
                      />
                    </div>
                    {!barcodeModalOpen.bar_code && (
                      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-center">
                        <p className="text-sm text-amber-700 dark:text-amber-400">
                          بارکد برای این جنس تنظیم نشده است. لطفاً ابتدا بارکد را در فرم ویرایش تنظیم کنید.
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setBarcodeModalOpen(null)}
                      className="flex-1 px-6 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-bold rounded-xl transition-all duration-200 border-2 border-gray-200 dark:border-gray-700"
                    >
                      {translations.cancel}
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        if (barcodeCanvasRef.current) {
                          const link = document.createElement('a');
                          link.download = `barcode-${barcodeModalOpen.name}-${barcodeModalOpen.bar_code || 'no-code'}.png`;
                          link.href = barcodeCanvasRef.current.toDataURL();
                          link.click();
                          toast.success("بارکد با موفقیت دانلود شد");
                        }
                      }}
                      disabled={!barcodeModalOpen.bar_code}
                      className="flex-1 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
                    >
                      {translations.downloadBarcode}
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* QR Code Modal */}
        <AnimatePresence>
          {qrCodeModalOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4"
              onClick={() => setQrCodeModalOpen(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-purple-200/50 dark:border-purple-900/30"
              >
                {/* Header */}
                <div className="bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-white/20 backdrop-blur-xl rounded-xl flex items-center justify-center border border-white/30">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                        </svg>
                      </div>
                      <div>
                        <h2 className="text-2xl font-bold text-white">{translations.qrCode}</h2>
                        <p className="text-purple-100 text-sm">{qrCodeModalOpen.name}</p>
                      </div>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.1, rotate: 90 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setQrCodeModalOpen(null)}
                      className="w-10 h-10 bg-white/20 hover:bg-white/30 backdrop-blur-xl rounded-xl flex items-center justify-center text-white transition-all duration-200"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </motion.button>
                  </div>
                </div>

                {/* Content */}
                <div className="p-8">
                  <div className="flex flex-col items-center gap-6 mb-6">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border-2 border-gray-200 dark:border-gray-700 shadow-lg">
                      <canvas
                        ref={qrCodeCanvasRef}
                        className="bg-white"
                      />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setQrCodeModalOpen(null)}
                      className="flex-1 px-6 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-bold rounded-xl transition-all duration-200 border-2 border-gray-200 dark:border-gray-700"
                    >
                      {translations.cancel}
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        if (qrCodeCanvasRef.current) {
                          const link = document.createElement('a');
                          link.download = `qrcode-${qrCodeModalOpen.name}-${qrCodeModalOpen.id}.png`;
                          link.href = qrCodeCanvasRef.current.toDataURL();
                          link.click();
                          toast.success("QR Code با موفقیت دانلود شد");
                        }
                      }}
                      className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 hover:from-purple-700 hover:via-indigo-700 hover:to-blue-700 text-white font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl"
                    >
                      {translations.downloadQRCode}
                    </motion.button>
                  </div>
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

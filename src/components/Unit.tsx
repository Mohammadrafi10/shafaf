import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
  initUnitsTable,
  createUnit,
  getUnits,
  updateUnit,
  deleteUnit,
  type Unit,
} from "../utils/unit";
import {
  initUnitGroupsTable,
  getUnitGroups,
  createUnitGroup,
  type UnitGroup,
} from "../utils/unit_group";
import { isDatabaseOpen, openDatabase } from "../utils/db";
import Footer from "./Footer";
import PageHeader from "./common/PageHeader";

// Dari translations
const translations = {
  title: "واحد",
  addNew: "افزودن واحد جدید",
  edit: "ویرایش",
  delete: "حذف",
  cancel: "لغو",
  save: "ذخیره",
  name: "نام واحد",
  actions: "عملیات",
  createdAt: "تاریخ ایجاد",
  updatedAt: "آخرین بروزرسانی",
  noUnits: "هیچ واحدی ثبت نشده است",
  confirmDelete: "آیا از حذف این واحد اطمینان دارید؟",
  backToDashboard: "بازگشت به داشبورد",
  placeholders: {
    name: "نام واحد را وارد کنید (مثال: کیلوگرم، متر، عدد)",
    unitGroupName: "نام گروه (مثال: وزن، طول)",
    ratio: "۱",
  },
  group: "گروه",
  ratio: "نسبت",
  isBase: "واحد پایه",
  addGroup: "افزودن گروه",
  baseBadge: "پایه",
  noGroup: "—",
  success: {
    created: "واحد با موفقیت ایجاد شد",
    updated: "واحد با موفقیت بروزرسانی شد",
    deleted: "واحد با موفقیت حذف شد",
    tableInit: "جدول واحدها با موفقیت ایجاد شد",
    groupCreated: "گروه با موفقیت اضافه شد",
  },
  errors: {
    create: "خطا در ایجاد واحد",
    update: "خطا در بروزرسانی واحد",
    delete: "خطا در حذف واحد",
    fetch: "خطا در دریافت واحدها",
    nameRequired: "نام واحد الزامی است",
    groupCreate: "خطا در ایجاد گروه",
  },
  converter: {
    title: "تبدیل واحد",
    amount: "مقدار",
    from: "از",
    to: "به",
    result: "نتیجه",
    selectUnit: "واحد را انتخاب کنید",
    multiply: "ضرب در",
    divide: "تقسیم بر",
    extraOp: "عملیات دستی",
    none: "—",
  },
};

interface UnitManagementProps {
  onBack?: () => void;
}

export default function UnitManagement({ onBack }: UnitManagementProps) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitGroups, setUnitGroups] = useState<UnitGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAddGroupModalOpen, setIsAddGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    group_id: number | null;
    ratio: string;
    is_base: boolean;
  }>({ name: "", group_id: null, ratio: "1", is_base: false });
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  // Unit converter state
  const [converterAmount, setConverterAmount] = useState("");
  const [fromUnitId, setFromUnitId] = useState<number | "">("");
  const [toUnitId, setToUnitId] = useState<number | "">("");
  const [manualOp, setManualOp] = useState<"" | "multiply" | "divide">("");
  const [manualFactor, setManualFactor] = useState("");

  // Get units available for "to" (same group as "from")
  const fromUnit = units.find((u) => u.id === fromUnitId);
  const toUnits = fromUnit?.group_id != null
    ? units.filter((u) => u.group_id === fromUnit.group_id)
    : units;

  // Conversion: value_in_B = value_in_A * (ratio_A / ratio_B)
  const baseConverted = (() => {
    const amt = parseFloat(converterAmount);
    if (Number.isNaN(amt) || fromUnitId === "" || toUnitId === "") return null;
    const fromU = units.find((u) => u.id === fromUnitId);
    const toU = units.find((u) => u.id === toUnitId);
    if (!fromU || !toU || (fromU.ratio ?? 1) === 0) return null;
    return amt * ((fromU.ratio ?? 1) / (toU.ratio ?? 1));
  })();

  // Apply manual multiply/divide to the converted value
  const convertedValue = (() => {
    if (baseConverted == null) return null;
    if (manualOp === "multiply") {
      const f = parseFloat(manualFactor);
      return baseConverted * (Number.isNaN(f) ? 1 : f);
    }
    if (manualOp === "divide") {
      const f = parseFloat(manualFactor);
      return f != null && !Number.isNaN(f) && f !== 0 ? baseConverted / f : baseConverted;
    }
    return baseConverted;
  })();

  useEffect(() => {
    loadUnits();
  }, []);

  const loadUnits = async () => {
    try {
      setLoading(true);
      const dbOpen = await isDatabaseOpen();
      if (!dbOpen) {
        await openDatabase("db");
      }

      try {
        await initUnitGroupsTable();
      } catch (err) {
        console.log("Unit groups table initialization:", err);
      }
      try {
        await initUnitsTable();
      } catch (err) {
        console.log("Units table initialization:", err);
      }

      const [unitsData, groupsData] = await Promise.all([getUnits(), getUnitGroups()]);
      setUnits(unitsData);
      setUnitGroups(groupsData);
    } catch (error: any) {
      toast.error(translations.errors.fetch);
      console.error("Error loading units:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (unit?: Unit) => {
    if (unit) {
      setEditingUnit(unit);
      setFormData({
        name: unit.name,
        group_id: unit.group_id ?? null,
        ratio: String(unit.ratio ?? 1),
        is_base: unit.is_base ?? false,
      });
    } else {
      setEditingUnit(null);
      setFormData({ name: "", group_id: null, ratio: "1", is_base: false });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingUnit(null);
    setFormData({ name: "", group_id: null, ratio: "1", is_base: false });
  };

  const handleAddGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      const g = await createUnitGroup(newGroupName.trim());
      const groups = await getUnitGroups();
      setUnitGroups(groups);
      setFormData((prev) => ({ ...prev, group_id: g.id }));
      setNewGroupName("");
      setIsAddGroupModalOpen(false);
      toast.success(translations.success.groupCreated);
    } catch (e) {
      toast.error(translations.errors.groupCreate);
      console.error(e);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error(translations.errors.nameRequired);
      return;
    }

    try {
      setLoading(true);
      const ratio = parseFloat(formData.ratio) || 1;
      if (editingUnit) {
        await updateUnit(
          editingUnit.id,
          formData.name,
          formData.group_id,
          ratio,
          formData.is_base
        );
        toast.success(translations.success.updated);
      } else {
        await createUnit(formData.name, formData.group_id, ratio, formData.is_base);
        toast.success(translations.success.created);
      }
      handleCloseModal();
      await loadUnits();
    } catch (error: any) {
      toast.error(editingUnit ? translations.errors.update : translations.errors.create);
      console.error("Error saving unit:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      setLoading(true);
      await deleteUnit(id);
      toast.success(translations.success.deleted);
      setDeleteConfirm(null);
      await loadUnits();
    } catch (error: any) {
      toast.error(translations.errors.delete);
      console.error("Error deleting unit:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-6" dir="rtl">
      <div className="w-full">
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
        />

        {/* Unit Converter */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-2xl shadow-lg border border-indigo-100 dark:border-indigo-900/30 p-6 mb-6"
        >
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            {translations.converter.title}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.converter.amount}</label>
              <input
                type="number"
                min="0"
                step="any"
                value={converterAmount}
                onChange={(e) => setConverterAmount(e.target.value)}
                placeholder="۰"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400"
                dir="rtl"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.converter.from}</label>
              <select
                value={fromUnitId === "" ? "" : fromUnitId}
                onChange={(e) => {
                  const v = e.target.value === "" ? "" : Number(e.target.value);
                  setFromUnitId(v);
                  setToUnitId("");
                }}
                className="w-full px-4 py-2.5 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400"
                dir="rtl"
              >
                <option value="">{translations.converter.selectUnit}</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.group_name ? ` (${u.group_name})` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.converter.to}</label>
              <select
                value={toUnitId === "" ? "" : toUnitId}
                onChange={(e) => setToUnitId(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full px-4 py-2.5 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400"
                dir="rtl"
              >
                <option value="">{translations.converter.selectUnit}</option>
                {toUnits.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.group_name ? ` (${u.group_name})` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.converter.extraOp}</label>
              <div className="flex gap-2">
                <select
                  value={manualOp}
                  onChange={(e) => {
                    const v = e.target.value as "" | "multiply" | "divide";
                    setManualOp(v);
                    if (!v) setManualFactor("");
                  }}
                  className="flex-1 min-w-0 px-4 py-2.5 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400"
                  dir="rtl"
                >
                  <option value="">{translations.converter.none}</option>
                  <option value="multiply">{translations.converter.multiply}</option>
                  <option value="divide">{translations.converter.divide}</option>
                </select>
                {(manualOp === "multiply" || manualOp === "divide") && (
                  <input
                    type="number"
                    step="any"
                    value={manualFactor}
                    onChange={(e) => setManualFactor(e.target.value)}
                    placeholder={manualOp === "multiply" ? "×" : "÷"}
                    className="w-24 px-3 py-2.5 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400"
                    dir="rtl"
                  />
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{translations.converter.result}</label>
              <div
                className="w-full px-4 py-2.5 rounded-xl border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/20 text-gray-900 dark:text-white font-semibold min-h-[42px] flex items-center justify-end"
                dir="rtl"
              >
                {convertedValue != null
                  ? convertedValue.toLocaleString("fa-IR", { minimumFractionDigits: 0, maximumFractionDigits: 6 })
                  : "—"}
              </div>
              {convertedValue != null && toUnitId !== "" && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-left">
                  {units.find((u) => u.id === toUnitId)?.name}
                </p>
              )}
            </div>
          </div>
        </motion.div>

        {loading && units.length === 0 ? (
          <div className="flex justify-center items-center h-64">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full"
            />
          </div>
        ) : units.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-20 bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl rounded-3xl shadow-2xl border border-pink-100 dark:border-pink-900/30"
          >
            <div className="flex flex-col items-center gap-4">
              <motion.div
                animate={{
                  y: [0, -10, 0],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className="w-24 h-24 bg-gradient-to-br from-pink-100 to-rose-100 dark:from-pink-900/30 dark:to-rose-900/30 rounded-full flex items-center justify-center"
              >
                <svg className="w-12 h-12 text-pink-500 dark:text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </motion.div>
              <p className="text-gray-600 dark:text-gray-400 text-xl font-semibold">
                {translations.noUnits}
              </p>
              <p className="text-gray-500 dark:text-gray-500 text-sm">
                برای شروع، یک واحد جدید اضافه کنید
              </p>
            </div>
          </motion.div>
        ) : (
          <div className="grid gap-5">
            <AnimatePresence>
              {units.map((unit, index) => (
                <motion.div
                  key={unit.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: index * 0.05 }}
                  whileHover={{ y: -4, transition: { duration: 0.2 } }}
                  className="group bg-gradient-to-br from-white to-pink-50/30 dark:from-gray-800 dark:to-gray-800/50 backdrop-blur-xl rounded-2xl shadow-lg hover:shadow-2xl p-6 border border-pink-100/50 dark:border-pink-900/30 transition-all duration-300"
                >
                  <div className="flex justify-between items-center gap-6">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="w-14 h-14 bg-gradient-to-br from-pink-500 to-rose-500 rounded-xl flex items-center justify-center shadow-lg">
                        <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
                            {unit.name}
                          </h3>
                          {(unit.is_base ?? false) && (
                            <span className="px-2 py-0.5 text-xs font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 rounded-lg">
                              {translations.baseBadge}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-500 mt-1 flex-wrap">
                          <span>{unit.group_name ?? translations.noGroup}</span>
                          <span>نسبت: {unit.ratio ?? 1}</span>
                          <div className="flex items-center gap-1">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>{new Date(unit.created_at).toLocaleDateString('fa-IR')}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => handleOpenModal(unit)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-xl shadow-md hover:shadow-lg transition-all duration-200 font-semibold"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        {translations.edit}
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setDeleteConfirm(unit.id)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white rounded-xl shadow-md hover:shadow-lg transition-all duration-200 font-semibold"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        {translations.delete}
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

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
                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-md"
              >
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
                  {editingUnit ? translations.edit : translations.addNew}
                </h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {translations.name}
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                      className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                      placeholder={translations.placeholders.name}
                      dir="rtl"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {translations.group}
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={formData.group_id ?? ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            group_id: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        className="flex-1 px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                        dir="rtl"
                      >
                        <option value="">{translations.noGroup}</option>
                        {unitGroups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setIsAddGroupModalOpen(true)}
                        className="px-4 py-3 bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 text-white rounded-xl font-semibold whitespace-nowrap"
                      >
                        + {translations.addGroup}
                      </motion.button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {translations.ratio}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={formData.ratio}
                      onChange={(e) => setFormData({ ...formData, ratio: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 transition-all duration-200"
                      placeholder={translations.placeholders.ratio}
                      dir="rtl"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="unit-is-base"
                      checked={formData.is_base}
                      onChange={(e) =>
                        setFormData({ ...formData, is_base: e.target.checked })
                      }
                      className="w-5 h-5 rounded border-2 border-gray-200 dark:border-gray-600 text-purple-600 focus:ring-purple-500"
                    />
                    <label
                      htmlFor="unit-is-base"
                      className="text-sm font-semibold text-gray-700 dark:text-gray-300"
                    >
                      {translations.isBase}
                    </label>
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

        {/* Add Group Modal */}
        <AnimatePresence>
          {isAddGroupModalOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
              onClick={() => { setIsAddGroupModalOpen(false); setNewGroupName(""); }}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl p-8 w-full max-w-sm"
              >
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                  {translations.addGroup}
                </h2>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder={translations.placeholders.unitGroupName}
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-purple-500 dark:focus:border-purple-400 mb-6"
                  dir="rtl"
                />
                <div className="flex gap-3">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => { setIsAddGroupModalOpen(false); setNewGroupName(""); }}
                    className="flex-1 px-4 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-bold rounded-xl"
                  >
                    {translations.cancel}
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleAddGroup}
                    disabled={!newGroupName.trim()}
                    className="flex-1 px-4 py-3 bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {translations.save}
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

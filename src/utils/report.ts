import { queryDatabase, resultToObjects } from "./db";
import { georgianToPersian } from "./date";
import { formatPersianNumber } from "./dashboard";

export interface ReportData {
  title: string;
  type: string;
  dateRange: { from: string; to: string };
  summary: {
    totalAmount?: number;
    totalCount?: number;
    paidAmount?: number;
    remainingAmount?: number;
    [key: string]: any;
  };
  sections: ReportSection[];
}

export interface ReportSection {
  title: string;
  type: "table" | "summary";
  data: any[];
  columns?: { key: string; label: string }[];
}

/**
 * Generate Sales Report filtered by date range
 */
export async function generateSalesReport(
  fromDate: string,
  toDate: string
): Promise<ReportData> {
  // Convert dates to Georgian format if needed (assuming they're already in YYYY-MM-DD)
  const from = fromDate;
  const to = toDate;

  // Query sales with customer and currency info
  const salesQuery = `
    SELECT 
      s.id,
      s.date,
      c.full_name as customer_name,
      s.total_amount,
      s.base_amount,
      s.paid_amount,
      (s.base_amount - s.paid_amount) as remaining_amount,
      s.notes,
      curr.name as currency_name,
      s.exchange_rate
    FROM sales s
    LEFT JOIN customers c ON s.customer_id = c.id
    LEFT JOIN currencies curr ON s.currency_id = curr.id
    WHERE s.date >= ? AND s.date <= ?
    ORDER BY s.date DESC, s.id DESC
  `;

  const salesResult = await queryDatabase(salesQuery, [from, to]);
  const sales = resultToObjects(salesResult);

  // Get sale items for each sale
  const saleIds = sales.map((s: any) => s.id);
  let saleItems: any[] = [];
  if (saleIds.length > 0) {
    const placeholders = saleIds.map(() => "?").join(",");
    const itemsQuery = `
      SELECT 
        si.sale_id,
        si.product_id,
        p.name as product_name,
        si.per_price,
        si.amount,
        si.total,
        u.name as unit_name
      FROM sale_items si
      LEFT JOIN products p ON si.product_id = p.id
      LEFT JOIN units u ON si.unit_id = u.id
      WHERE si.sale_id IN (${placeholders})
      ORDER BY si.sale_id, si.id
    `;
    const itemsResult = await queryDatabase(itemsQuery, saleIds);
    saleItems = resultToObjects(itemsResult);
  }

  // Get sale payments
  let salePayments: any[] = [];
  if (saleIds.length > 0) {
    const placeholders = saleIds.map(() => "?").join(",");
    const paymentsQuery = `
      SELECT 
        sp.sale_id,
        sp.amount,
        sp.base_amount,
        sp.date as payment_date,
        a.name as account_name,
        curr.name as currency_name
      FROM sale_payments sp
      LEFT JOIN accounts a ON sp.account_id = a.id
      LEFT JOIN currencies curr ON sp.currency_id = curr.id
      WHERE sp.sale_id IN (${placeholders})
      ORDER BY sp.sale_id, sp.date
    `;
    const paymentsResult = await queryDatabase(paymentsQuery, saleIds);
    salePayments = resultToObjects(paymentsResult);
  }

  // Calculate summary
  const totalAmount = sales.reduce((sum: number, s: any) => sum + (s.base_amount || 0), 0);
  const paidAmount = sales.reduce((sum: number, s: any) => sum + (s.paid_amount || 0), 0);
  const remainingAmount = totalAmount - paidAmount;

  // Format sales data for display
  const formattedSales = sales.map((sale: any) => ({
    ...sale,
    date_persian: georgianToPersian(sale.date),
    total_amount_formatted: formatPersianNumber(sale.total_amount || 0),
    base_amount_formatted: formatPersianNumber(sale.base_amount || 0),
    paid_amount_formatted: formatPersianNumber(sale.paid_amount || 0),
    remaining_amount_formatted: formatPersianNumber(sale.remaining_amount || 0),
  }));

  return {
    title: "گزارش فروشات",
    type: "sales",
    dateRange: { from, to },
    summary: {
      totalCount: sales.length,
      totalAmount,
      paidAmount,
      remainingAmount,
    },
    sections: [
      {
        title: "خلاصه گزارش",
        type: "summary",
        data: [
          { label: "تعداد کل فروشات", value: formatPersianNumber(sales.length) },
          { label: "مجموع مبلغ", value: formatPersianNumber(totalAmount) },
          { label: "مبلغ پرداخت شده", value: formatPersianNumber(paidAmount) },
          { label: "مبلغ باقیمانده", value: formatPersianNumber(remainingAmount) },
        ],
      },
      {
        title: "لیست فروشات",
        type: "table",
        columns: [
          { key: "id", label: "شماره" },
          { key: "date_persian", label: "تاریخ" },
          { key: "customer_name", label: "مشتری" },
          { key: "base_amount_formatted", label: "مبلغ کل" },
          { key: "paid_amount_formatted", label: "پرداخت شده" },
          { key: "remaining_amount_formatted", label: "باقیمانده" },
          { key: "currency_name", label: "ارز" },
        ],
        data: formattedSales,
      },
      {
        title: "اقلام فروش",
        type: "table",
        columns: [
          { key: "sale_id", label: "شماره فروش" },
          { key: "product_name", label: "محصول" },
          { key: "amount", label: "تعداد" },
          { key: "unit_name", label: "واحد" },
          { key: "per_price", label: "قیمت واحد" },
          { key: "total", label: "جمع" },
        ],
        data: saleItems.map((item: any) => ({
          ...item,
          per_price: formatPersianNumber(item.per_price || 0),
          amount: formatPersianNumber(item.amount || 0),
          total: formatPersianNumber(item.total || 0),
        })),
      },
      {
        title: "پرداخت‌های فروش",
        type: "table",
        columns: [
          { key: "sale_id", label: "شماره فروش" },
          { key: "payment_date", label: "تاریخ پرداخت" },
          { key: "amount", label: "مبلغ" },
          { key: "base_amount", label: "مبلغ پایه" },
          { key: "account_name", label: "حساب" },
          { key: "currency_name", label: "ارز" },
        ],
        data: salePayments.map((payment: any) => ({
          ...payment,
          payment_date: georgianToPersian(payment.payment_date),
          amount: formatPersianNumber(payment.amount || 0),
          base_amount: formatPersianNumber(payment.base_amount || 0),
        })),
      },
    ],
  };
}

/**
 * Generate Services Report filtered by date range
 */
export async function generateServicesReport(
  fromDate: string,
  toDate: string
): Promise<ReportData> {
  const from = fromDate;
  const to = toDate;

  const servicesQuery = `
    SELECT 
      s.id,
      s.date,
      c.full_name as customer_name,
      s.total_amount,
      s.base_amount,
      s.paid_amount,
      (s.base_amount - s.paid_amount) as remaining_amount,
      s.notes,
      curr.name as currency_name,
      s.exchange_rate
    FROM services s
    LEFT JOIN customers c ON s.customer_id = c.id
    LEFT JOIN currencies curr ON s.currency_id = curr.id
    WHERE s.date >= ? AND s.date <= ?
    ORDER BY s.date DESC, s.id DESC
  `;

  const servicesResult = await queryDatabase(servicesQuery, [from, to]);
  const services = resultToObjects(servicesResult);

  const serviceIds = services.map((s: any) => s.id);
  let serviceItems: any[] = [];
  if (serviceIds.length > 0) {
    const placeholders = serviceIds.map(() => "?").join(",");
    const itemsQuery = `
      SELECT 
        si.service_id,
        si.name as item_name,
        si.price,
        si.quantity,
        si.total
      FROM service_items si
      WHERE si.service_id IN (${placeholders})
      ORDER BY si.service_id, si.id
    `;
    const itemsResult = await queryDatabase(itemsQuery, serviceIds);
    serviceItems = resultToObjects(itemsResult);
  }

  let servicePayments: any[] = [];
  if (serviceIds.length > 0) {
    const placeholders = serviceIds.map(() => "?").join(",");
    const paymentsQuery = `
      SELECT 
        sp.service_id,
        sp.amount,
        sp.base_amount,
        sp.date as payment_date,
        a.name as account_name,
        curr.name as currency_name
      FROM service_payments sp
      LEFT JOIN accounts a ON sp.account_id = a.id
      LEFT JOIN currencies curr ON sp.currency_id = curr.id
      WHERE sp.service_id IN (${placeholders})
      ORDER BY sp.service_id, sp.date
    `;
    const paymentsResult = await queryDatabase(paymentsQuery, serviceIds);
    servicePayments = resultToObjects(paymentsResult);
  }

  const totalAmount = services.reduce((sum: number, s: any) => sum + (s.base_amount || 0), 0);
  const paidAmount = services.reduce((sum: number, s: any) => sum + (s.paid_amount || 0), 0);
  const remainingAmount = totalAmount - paidAmount;

  const formattedServices = services.map((svc: any) => ({
    ...svc,
    date_persian: georgianToPersian(svc.date),
    total_amount_formatted: formatPersianNumber(svc.total_amount || 0),
    base_amount_formatted: formatPersianNumber(svc.base_amount || 0),
    paid_amount_formatted: formatPersianNumber(svc.paid_amount || 0),
    remaining_amount_formatted: formatPersianNumber(svc.remaining_amount || 0),
  }));

  return {
    title: "گزارش خدمات",
    type: "services",
    dateRange: { from, to },
    summary: {
      totalCount: services.length,
      totalAmount,
      paidAmount,
      remainingAmount,
    },
    sections: [
      {
        title: "خلاصه گزارش",
        type: "summary",
        data: [
          { label: "تعداد کل خدمات", value: formatPersianNumber(services.length) },
          { label: "مجموع مبلغ", value: formatPersianNumber(totalAmount) },
          { label: "مبلغ پرداخت شده", value: formatPersianNumber(paidAmount) },
          { label: "مبلغ باقیمانده", value: formatPersianNumber(remainingAmount) },
        ],
      },
      {
        title: "لیست خدمات",
        type: "table",
        columns: [
          { key: "id", label: "شماره" },
          { key: "date_persian", label: "تاریخ" },
          { key: "customer_name", label: "مشتری" },
          { key: "base_amount_formatted", label: "مبلغ کل" },
          { key: "paid_amount_formatted", label: "پرداخت شده" },
          { key: "remaining_amount_formatted", label: "باقیمانده" },
          { key: "currency_name", label: "ارز" },
        ],
        data: formattedServices,
      },
      {
        title: "اقلام خدمات",
        type: "table",
        columns: [
          { key: "service_id", label: "شماره خدمت" },
          { key: "item_name", label: "نام آیتم" },
          { key: "quantity", label: "مقدار" },
          { key: "price", label: "قیمت واحد" },
          { key: "total", label: "جمع" },
        ],
        data: serviceItems.map((item: any) => ({
          ...item,
          price: formatPersianNumber(item.price || 0),
          quantity: formatPersianNumber(item.quantity || 0),
          total: formatPersianNumber(item.total || 0),
        })),
      },
      {
        title: "پرداخت‌های خدمات",
        type: "table",
        columns: [
          { key: "service_id", label: "شماره خدمت" },
          { key: "payment_date", label: "تاریخ پرداخت" },
          { key: "amount", label: "مبلغ" },
          { key: "base_amount", label: "مبلغ پایه" },
          { key: "account_name", label: "حساب" },
          { key: "currency_name", label: "ارز" },
        ],
        data: servicePayments.map((payment: any) => ({
          ...payment,
          payment_date: georgianToPersian(payment.payment_date),
          amount: formatPersianNumber(payment.amount || 0),
          base_amount: formatPersianNumber(payment.base_amount || 0),
        })),
      },
    ],
  };
}

/**
 * Generate Purchase Report filtered by date range
 */
export async function generatePurchaseReport(
  fromDate: string,
  toDate: string
): Promise<ReportData> {
  const from = fromDate;
  const to = toDate;

  const purchasesQuery = `
    SELECT 
      p.id,
      p.date,
      s.full_name as supplier_name,
      p.total_amount,
      p.notes,
      curr.name as currency_name
    FROM purchases p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    LEFT JOIN currencies curr ON p.currency_id = curr.id
    WHERE p.date >= ? AND p.date <= ?
    ORDER BY p.date DESC, p.id DESC
  `;

  const purchasesResult = await queryDatabase(purchasesQuery, [from, to]);
  const purchases = resultToObjects(purchasesResult);

  const purchaseIds = purchases.map((p: any) => p.id);
  let purchaseItems: any[] = [];
  if (purchaseIds.length > 0) {
    const placeholders = purchaseIds.map(() => "?").join(",");
    const itemsQuery = `
      SELECT 
        pi.purchase_id,
        pi.product_id,
        pr.name as product_name,
        pi.per_price,
        pi.amount,
        pi.total,
        u.name as unit_name
      FROM purchase_items pi
      LEFT JOIN products pr ON pi.product_id = pr.id
      LEFT JOIN units u ON pi.unit_id = u.id
      WHERE pi.purchase_id IN (${placeholders})
      ORDER BY pi.purchase_id, pi.id
    `;
    const itemsResult = await queryDatabase(itemsQuery, purchaseIds);
    purchaseItems = resultToObjects(itemsResult);
  }

  let purchasePayments: any[] = [];
  if (purchaseIds.length > 0) {
    const placeholders = purchaseIds.map(() => "?").join(",");
    const paymentsQuery = `
      SELECT 
        pp.purchase_id,
        pp.amount,
        pp.total,
        pp.date as payment_date,
        a.name as account_name,
        pp.currency
      FROM purchase_payments pp
      LEFT JOIN accounts a ON pp.account_id = a.id
      WHERE pp.purchase_id IN (${placeholders})
      ORDER BY pp.purchase_id, pp.date
    `;
    const paymentsResult = await queryDatabase(paymentsQuery, purchaseIds);
    purchasePayments = resultToObjects(paymentsResult);
  }

  const totalAmount = purchases.reduce((sum: number, p: any) => sum + (p.total_amount || 0), 0);

  const formattedPurchases = purchases.map((purchase: any) => ({
    ...purchase,
    date_persian: georgianToPersian(purchase.date),
    total_amount_formatted: formatPersianNumber(purchase.total_amount || 0),
  }));

  return {
    title: "گزارش خریداری‌ها",
    type: "purchases",
    dateRange: { from, to },
    summary: {
      totalCount: purchases.length,
      totalAmount,
    },
    sections: [
      {
        title: "خلاصه گزارش",
        type: "summary",
        data: [
          { label: "تعداد کل خریداری‌ها", value: formatPersianNumber(purchases.length) },
          { label: "مجموع مبلغ", value: formatPersianNumber(totalAmount) },
        ],
      },
      {
        title: "لیست خریداری‌ها",
        type: "table",
        columns: [
          { key: "id", label: "شماره" },
          { key: "date_persian", label: "تاریخ" },
          { key: "supplier_name", label: "تمویل‌کننده" },
          { key: "total_amount_formatted", label: "مبلغ کل" },
          { key: "currency_name", label: "ارز" },
        ],
        data: formattedPurchases,
      },
      {
        title: "اقلام خریداری",
        type: "table",
        columns: [
          { key: "purchase_id", label: "شماره خریداری" },
          { key: "product_name", label: "محصول" },
          { key: "amount", label: "تعداد" },
          { key: "unit_name", label: "واحد" },
          { key: "per_price", label: "قیمت واحد" },
          { key: "total", label: "جمع" },
        ],
        data: purchaseItems.map((item: any) => ({
          ...item,
          per_price: formatPersianNumber(item.per_price || 0),
          amount: formatPersianNumber(item.amount || 0),
          total: formatPersianNumber(item.total || 0),
        })),
      },
      {
        title: "پرداخت‌های خریداری",
        type: "table",
        columns: [
          { key: "purchase_id", label: "شماره خریداری" },
          { key: "payment_date", label: "تاریخ پرداخت" },
          { key: "amount", label: "مبلغ" },
          { key: "total", label: "جمع" },
          { key: "account_name", label: "حساب" },
          { key: "currency", label: "ارز" },
        ],
        data: purchasePayments.map((payment: any) => ({
          ...payment,
          payment_date: georgianToPersian(payment.payment_date),
          amount: formatPersianNumber(payment.amount || 0),
          total: formatPersianNumber(payment.total || 0),
        })),
      },
    ],
  };
}

/**
 * Generate Expense Report filtered by date range
 */
export async function generateExpenseReport(
  fromDate: string,
  toDate: string
): Promise<ReportData> {
  const from = fromDate;
  const to = toDate;

  const expensesQuery = `
    SELECT 
      e.id,
      e.date,
      et.name as expense_type_name,
      e.amount,
      e.currency,
      e.rate,
      e.total,
      e.bill_no,
      e.description
    FROM expenses e
    LEFT JOIN expense_types et ON e.expense_type_id = et.id
    WHERE e.date >= ? AND e.date <= ?
    ORDER BY e.date DESC, e.id DESC
  `;

  const expensesResult = await queryDatabase(expensesQuery, [from, to]);
  const expenses = resultToObjects(expensesResult);

  // Group by expense type
  const groupedByType: Record<string, any[]> = {};
  expenses.forEach((expense: any) => {
    const typeName = expense.expense_type_name || "بدون دسته‌بندی";
    if (!groupedByType[typeName]) {
      groupedByType[typeName] = [];
    }
    groupedByType[typeName].push(expense);
  });

  const totalAmount = expenses.reduce((sum: number, e: any) => sum + (e.total || 0), 0);

  const formattedExpenses = expenses.map((expense: any) => ({
    ...expense,
    date_persian: georgianToPersian(expense.date),
    amount_formatted: formatPersianNumber(expense.amount || 0),
    total_formatted: formatPersianNumber(expense.total || 0),
  }));

  // Create summary by type
  const typeSummary = Object.entries(groupedByType).map(([typeName, typeExpenses]) => {
    const typeTotal = typeExpenses.reduce((sum: number, e: any) => sum + (e.total || 0), 0);
    return {
      expense_type: typeName,
      count: typeExpenses.length,
      total: formatPersianNumber(typeTotal),
    };
  });

  return {
    title: "گزارش مصارف",
    type: "expenses",
    dateRange: { from, to },
    summary: {
      totalCount: expenses.length,
      totalAmount,
    },
    sections: [
      {
        title: "خلاصه گزارش",
        type: "summary",
        data: [
          { label: "تعداد کل مصارف", value: formatPersianNumber(expenses.length) },
          { label: "مجموع مبلغ", value: formatPersianNumber(totalAmount) },
        ],
      },
      {
        title: "خلاصه بر اساس نوع",
        type: "table",
        columns: [
          { key: "expense_type", label: "نوع مصارف" },
          { key: "count", label: "تعداد" },
          { key: "total", label: "مجموع" },
        ],
        data: typeSummary,
      },
      {
        title: "لیست مصارف",
        type: "table",
        columns: [
          { key: "id", label: "شماره" },
          { key: "date_persian", label: "تاریخ" },
          { key: "expense_type_name", label: "نوع" },
          { key: "amount_formatted", label: "مبلغ" },
          { key: "currency", label: "ارز" },
          { key: "total_formatted", label: "جمع" },
          { key: "bill_no", label: "شماره بیل" },
          { key: "description", label: "توضیحات" },
        ],
        data: formattedExpenses,
      },
    ],
  };
}

/**
 * Generate Account Report filtered by date range
 */
export async function generateAccountReport(
  fromDate: string,
  toDate: string
): Promise<ReportData> {
  const from = fromDate;
  const to = toDate;

  const transactionsQuery = `
    SELECT 
      at.id,
      at.transaction_date,
      a.name as account_name,
      at.transaction_type,
      at.amount,
      at.currency,
      at.rate,
      at.total,
      at.notes
    FROM account_transactions at
    LEFT JOIN accounts a ON at.account_id = a.id
    WHERE at.transaction_date >= ? AND at.transaction_date <= ?
    ORDER BY at.transaction_date DESC, at.id DESC
  `;

  const transactionsResult = await queryDatabase(transactionsQuery, [from, to]);
  const transactions = resultToObjects(transactionsResult);

  const deposits = transactions.filter((t: any) => t.transaction_type === "deposit");
  const withdrawals = transactions.filter((t: any) => t.transaction_type === "withdraw");

  const totalDeposits = deposits.reduce((sum: number, t: any) => sum + (t.total || 0), 0);
  const totalWithdrawals = withdrawals.reduce((sum: number, t: any) => sum + (t.total || 0), 0);

  const formattedTransactions = transactions.map((transaction: any) => ({
    ...transaction,
    transaction_date_persian: georgianToPersian(transaction.transaction_date),
    amount_formatted: formatPersianNumber(transaction.amount || 0),
    total_formatted: formatPersianNumber(transaction.total || 0),
    transaction_type_label: transaction.transaction_type === "deposit" ? "واریز" : "برداشت",
  }));

  return {
    title: "گزارش حساب‌ها",
    type: "accounts",
    dateRange: { from, to },
    summary: {
      totalCount: transactions.length,
      totalDeposits,
      totalWithdrawals,
    },
    sections: [
      {
        title: "خلاصه گزارش",
        type: "summary",
        data: [
          { label: "تعداد کل تراکنش‌ها", value: formatPersianNumber(transactions.length) },
          { label: "مجموع واریزها", value: formatPersianNumber(totalDeposits) },
          { label: "مجموع برداشت‌ها", value: formatPersianNumber(totalWithdrawals) },
        ],
      },
      {
        title: "لیست تراکنش‌ها",
        type: "table",
        columns: [
          { key: "id", label: "شماره" },
          { key: "transaction_date_persian", label: "تاریخ" },
          { key: "account_name", label: "حساب" },
          { key: "transaction_type_label", label: "نوع" },
          { key: "amount_formatted", label: "مبلغ" },
          { key: "currency", label: "ارز" },
          { key: "total_formatted", label: "جمع" },
          { key: "notes", label: "توضیحات" },
        ],
        data: formattedTransactions,
      },
    ],
  };
}

/**
 * Generate Product Report filtered by date range
 */
export async function generateProductReport(
  fromDate: string,
  toDate: string
): Promise<ReportData> {
  const from = fromDate;
  const to = toDate;

  // Get product sales summary
  const salesQuery = `
    SELECT 
      p.id as product_id,
      p.name as product_name,
      SUM(si.amount) as total_sold,
      SUM(si.total) as total_sales_amount,
      COUNT(DISTINCT si.sale_id) as sale_count
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    JOIN products p ON si.product_id = p.id
    WHERE s.date >= ? AND s.date <= ?
    GROUP BY p.id, p.name
    ORDER BY total_sales_amount DESC
  `;

  const salesResult = await queryDatabase(salesQuery, [from, to]);
  const productSales = resultToObjects(salesResult);

  // Get product purchases summary
  const purchasesQuery = `
    SELECT 
      p.id as product_id,
      p.name as product_name,
      SUM(pi.amount) as total_purchased,
      SUM(pi.total) as total_purchase_amount,
      COUNT(DISTINCT pi.purchase_id) as purchase_count
    FROM purchase_items pi
    JOIN purchases pur ON pi.purchase_id = pur.id
    JOIN products p ON pi.product_id = p.id
    WHERE pur.date >= ? AND pur.date <= ?
    GROUP BY p.id, p.name
    ORDER BY total_purchase_amount DESC
  `;

  const purchasesResult = await queryDatabase(purchasesQuery, [from, to]);
  const productPurchases = resultToObjects(purchasesResult);

  const totalSalesAmount = productSales.reduce((sum: number, ps: any) => sum + (ps.total_sales_amount || 0), 0);
  const totalPurchaseAmount = productPurchases.reduce((sum: number, pp: any) => sum + (pp.total_purchase_amount || 0), 0);

  const formattedSales = productSales.map((ps: any) => ({
    ...ps,
    total_sold_formatted: formatPersianNumber(ps.total_sold || 0),
    total_sales_amount_formatted: formatPersianNumber(ps.total_sales_amount || 0),
  }));

  const formattedPurchases = productPurchases.map((pp: any) => ({
    ...pp,
    total_purchased_formatted: formatPersianNumber(pp.total_purchased || 0),
    total_purchase_amount_formatted: formatPersianNumber(pp.total_purchase_amount || 0),
  }));

  return {
    title: "گزارش محصولات",
    type: "products",
    dateRange: { from, to },
    summary: {
      totalSalesAmount,
      totalPurchaseAmount,
    },
    sections: [
      {
        title: "خلاصه گزارش",
        type: "summary",
        data: [
          { label: "مجموع فروش محصولات", value: formatPersianNumber(totalSalesAmount) },
          { label: "مجموع خرید محصولات", value: formatPersianNumber(totalPurchaseAmount) },
        ],
      },
      {
        title: "فروش محصولات",
        type: "table",
        columns: [
          { key: "product_name", label: "محصول" },
          { key: "total_sold_formatted", label: "تعداد فروخته شده" },
          { key: "total_sales_amount_formatted", label: "مبلغ فروش" },
          { key: "sale_count", label: "تعداد فروشات" },
        ],
        data: formattedSales,
      },
      {
        title: "خرید محصولات",
        type: "table",
        columns: [
          { key: "product_name", label: "محصول" },
          { key: "total_purchased_formatted", label: "تعداد خریداری شده" },
          { key: "total_purchase_amount_formatted", label: "مبلغ خرید" },
          { key: "purchase_count", label: "تعداد خریداری‌ها" },
        ],
        data: formattedPurchases,
      },
    ],
  };
}

/**
 * Generate Customer Report filtered by date range and optionally by customer ID
 */
export async function generateCustomerReport(
  fromDate: string,
  toDate: string,
  customerId: number | null = null
): Promise<ReportData> {
  const from = fromDate;
  const to = toDate;

  // Get customer name if specific customer is selected
  let customerName: string | null = null;
  if (customerId !== null) {
    const customerNameQuery = `SELECT full_name FROM customers WHERE id = ?`;
    const nameResult = await queryDatabase(customerNameQuery, [customerId]);
    const nameRows = resultToObjects(nameResult);
    if (nameRows.length > 0) {
      customerName = nameRows[0].full_name;
    }
  }

  let customersQuery = `
    SELECT 
      c.id,
      c.full_name,
      COUNT(DISTINCT s.id) as sale_count,
      SUM(s.base_amount) as total_sales,
      SUM(s.paid_amount) as total_paid,
      SUM(s.base_amount - s.paid_amount) as total_remaining
    FROM customers c
    LEFT JOIN sales s ON c.id = s.customer_id AND s.date >= ? AND s.date <= ?
  `;
  
  const params: any[] = [from, to];
  
  if (customerId !== null) {
    customersQuery += ` WHERE c.id = ?`;
    params.push(customerId);
  }
  
  customersQuery += `
    GROUP BY c.id, c.full_name
    HAVING sale_count > 0
    ORDER BY total_sales DESC
  `;

  const customersResult = await queryDatabase(customersQuery, params);
  const customers = resultToObjects(customersResult);

  const totalSales = customers.reduce((sum: number, c: any) => sum + (c.total_sales || 0), 0);
  const totalPaid = customers.reduce((sum: number, c: any) => sum + (c.total_paid || 0), 0);
  const totalRemaining = customers.reduce((sum: number, c: any) => sum + (c.total_remaining || 0), 0);

  const formattedCustomers = customers.map((customer: any) => ({
    ...customer,
    sale_count_formatted: formatPersianNumber(customer.sale_count || 0),
    total_sales_formatted: formatPersianNumber(customer.total_sales || 0),
    total_paid_formatted: formatPersianNumber(customer.total_paid || 0),
    total_remaining_formatted: formatPersianNumber(customer.total_remaining || 0),
  }));

  const reportTitle = customerId !== null && customerName 
    ? `گزارش مشتری: ${customerName}`
    : "گزارش مشتریان";

  return {
    title: reportTitle,
    type: "customers",
    dateRange: { from, to },
    summary: {
      totalCount: customers.length,
      totalSales,
      totalPaid,
      totalRemaining,
    },
    sections: [
      {
        title: "خلاصه گزارش",
        type: "summary",
        data: [
          { label: "تعداد مشتریان", value: formatPersianNumber(customers.length) },
          { label: "مجموع فروشات", value: formatPersianNumber(totalSales) },
          { label: "مجموع پرداخت شده", value: formatPersianNumber(totalPaid) },
          { label: "مجموع باقیمانده", value: formatPersianNumber(totalRemaining) },
        ],
      },
      {
        title: "لیست مشتریان",
        type: "table",
        columns: [
          { key: "full_name", label: "نام مشتری" },
          { key: "sale_count_formatted", label: "تعداد فروشات" },
          { key: "total_sales_formatted", label: "مجموع فروشات" },
          { key: "total_paid_formatted", label: "پرداخت شده" },
          { key: "total_remaining_formatted", label: "باقیمانده" },
        ],
        data: formattedCustomers,
      },
    ],
  };
}

/**
 * Generate Supplier Report filtered by date range and optionally by supplier ID
 */
export async function generateSupplierReport(
  fromDate: string,
  toDate: string,
  supplierId: number | null = null
): Promise<ReportData> {
  const from = fromDate;
  const to = toDate;

  // Get supplier name if specific supplier is selected
  let supplierName: string | null = null;
  if (supplierId !== null) {
    const supplierNameQuery = `SELECT full_name FROM suppliers WHERE id = ?`;
    const nameResult = await queryDatabase(supplierNameQuery, [supplierId]);
    const nameRows = resultToObjects(nameResult);
    if (nameRows.length > 0) {
      supplierName = nameRows[0].full_name;
    }
  }

  let suppliersQuery = `
    SELECT 
      s.id,
      s.full_name,
      COUNT(DISTINCT p.id) as purchase_count,
      SUM(p.total_amount) as total_purchases
    FROM suppliers s
    LEFT JOIN purchases p ON s.id = p.supplier_id AND p.date >= ? AND p.date <= ?
  `;
  
  const params: any[] = [from, to];
  
  if (supplierId !== null) {
    suppliersQuery += ` WHERE s.id = ?`;
    params.push(supplierId);
  }
  
  suppliersQuery += `
    GROUP BY s.id, s.full_name
    HAVING purchase_count > 0
    ORDER BY total_purchases DESC
  `;

  const suppliersResult = await queryDatabase(suppliersQuery, params);
  const suppliers = resultToObjects(suppliersResult);

  const totalPurchases = suppliers.reduce((sum: number, s: any) => sum + (s.total_purchases || 0), 0);

  const formattedSuppliers = suppliers.map((supplier: any) => ({
    ...supplier,
    purchase_count_formatted: formatPersianNumber(supplier.purchase_count || 0),
    total_purchases_formatted: formatPersianNumber(supplier.total_purchases || 0),
  }));

  const reportTitle = supplierId !== null && supplierName 
    ? `گزارش تمویل‌کننده: ${supplierName}`
    : "گزارش تمویل‌کنندگان";

  return {
    title: reportTitle,
    type: "suppliers",
    dateRange: { from, to },
    summary: {
      totalCount: suppliers.length,
      totalPurchases,
    },
    sections: [
      {
        title: "خلاصه گزارش",
        type: "summary",
        data: [
          { label: "تعداد تمویل‌کنندگان", value: formatPersianNumber(suppliers.length) },
          { label: "مجموع خریداری‌ها", value: formatPersianNumber(totalPurchases) },
        ],
      },
      {
        title: "لیست تمویل‌کنندگان",
        type: "table",
        columns: [
          { key: "full_name", label: "نام تمویل‌کننده" },
          { key: "purchase_count_formatted", label: "تعداد خریداری‌ها" },
          { key: "total_purchases_formatted", label: "مجموع خریداری‌ها" },
        ],
        data: formattedSuppliers,
      },
    ],
  };
}

/**
 * Generate Receivables Report (Customers who owe us) – balance as of toDate.
 * Lists customers with total_remaining > 0 (total sales - total paid).
 */
export async function generateReceivablesReport(
  fromDate: string,
  toDate: string,
  customerId: number | null = null
): Promise<ReportData> {
  const to = toDate;

  // Get customer name if specific customer is selected
  let customerName: string | null = null;
  if (customerId !== null) {
    const customerNameQuery = `SELECT full_name FROM customers WHERE id = ?`;
    const nameResult = await queryDatabase(customerNameQuery, [customerId]);
    const nameRows = resultToObjects(nameResult);
    if (nameRows.length > 0) {
      customerName = nameRows[0].full_name;
    }
  }

  let receivablesQuery = `
    SELECT 
      c.id,
      c.full_name,
      COALESCE(SUM(s.base_amount), 0) as total_sales,
      COALESCE(SUM(s.paid_amount), 0) as total_paid,
      COALESCE(SUM(s.base_amount - s.paid_amount), 0) as total_remaining
    FROM customers c
    LEFT JOIN sales s ON c.id = s.customer_id AND s.date <= ?
  `;
  
  const params: any[] = [to];
  
  if (customerId !== null) {
    receivablesQuery += ` WHERE c.id = ?`;
    params.push(customerId);
  }
  
  receivablesQuery += `
    GROUP BY c.id, c.full_name
    HAVING total_remaining > 0
    ORDER BY total_remaining DESC
  `;

  const receivablesResult = await queryDatabase(receivablesQuery, params);
  const receivables = resultToObjects(receivablesResult);

  const totalReceivables = receivables.reduce((sum: number, r: any) => sum + (r.total_remaining || 0), 0);
  const totalSales = receivables.reduce((sum: number, r: any) => sum + (r.total_sales || 0), 0);
  const totalPaid = receivables.reduce((sum: number, r: any) => sum + (r.total_paid || 0), 0);

  const formatted = receivables.map((row: any) => ({
    ...row,
    total_sales_formatted: formatPersianNumber(row.total_sales || 0),
    total_paid_formatted: formatPersianNumber(row.total_paid || 0),
    total_remaining_formatted: formatPersianNumber(row.total_remaining || 0),
  }));

  const reportTitle = customerId !== null && customerName 
    ? `لیست مطالبات: ${customerName}`
    : "لیست مطالبات (مشتریان)";

  return {
    title: reportTitle,
    type: "receivables",
    dateRange: { from: fromDate, to },
    summary: {
      totalCount: receivables.length,
      totalSales,
      totalPaid,
      totalRemaining: totalReceivables,
    },
    sections: [
      {
        title: "خلاصه",
        type: "summary",
        data: [
          { label: "تعداد مشتریان با مانده", value: formatPersianNumber(receivables.length) },
          { label: "مجموع فروشات", value: formatPersianNumber(totalSales) },
          { label: "مجموع پرداخت شده", value: formatPersianNumber(totalPaid) },
          { label: "مجموع مطالبات (باقیمانده)", value: formatPersianNumber(totalReceivables) },
        ],
      },
      {
        title: "لیست مطالبات (مشتریان)",
        type: "table",
        columns: [
          { key: "full_name", label: "نام مشتری" },
          { key: "total_sales_formatted", label: "مجموع فروشات" },
          { key: "total_paid_formatted", label: "پرداخت شده" },
          { key: "total_remaining_formatted", label: "باقیمانده (مطالبه)" },
        ],
        data: formatted,
      },
    ],
  };
}

/**
 * Generate Payables Report (Vendors we owe) – balance as of toDate.
 * Lists suppliers with total_remaining > 0 (total purchases - total paid).
 */
export async function generatePayablesReport(
  fromDate: string,
  toDate: string,
  supplierId: number | null = null
): Promise<ReportData> {
  const to = toDate;

  // Get supplier name if specific supplier is selected
  let supplierName: string | null = null;
  if (supplierId !== null) {
    const supplierNameQuery = `SELECT full_name FROM suppliers WHERE id = ?`;
    const nameResult = await queryDatabase(supplierNameQuery, [supplierId]);
    const nameRows = resultToObjects(nameResult);
    if (nameRows.length > 0) {
      supplierName = nameRows[0].full_name;
    }
  }

  let payablesQuery = `
    SELECT 
      sup.id,
      sup.full_name,
      COALESCE(SUM(p.total_amount), 0) as total_purchases,
      COALESCE(paid.total_paid, 0) as total_paid,
      COALESCE(SUM(p.total_amount), 0) - COALESCE(paid.total_paid, 0) as total_remaining
    FROM suppliers sup
    LEFT JOIN purchases p ON sup.id = p.supplier_id AND p.date <= ?
    LEFT JOIN (
      SELECT p2.supplier_id, SUM(pp.total) as total_paid
      FROM purchases p2
      JOIN purchase_payments pp ON pp.purchase_id = p2.id
      WHERE p2.date <= ?
      GROUP BY p2.supplier_id
    ) paid ON paid.supplier_id = sup.id
  `;
  
  const params: any[] = [to, to];
  
  if (supplierId !== null) {
    payablesQuery += ` WHERE sup.id = ?`;
    params.push(supplierId);
  }
  
  payablesQuery += `
    GROUP BY sup.id, sup.full_name, paid.total_paid
    HAVING total_remaining > 0
    ORDER BY total_remaining DESC
  `;

  const payablesResult = await queryDatabase(payablesQuery, params);
  const payables = resultToObjects(payablesResult);

  const totalPayables = payables.reduce((sum: number, p: any) => sum + (p.total_remaining || 0), 0);
  const totalPurchases = payables.reduce((sum: number, p: any) => sum + (p.total_purchases || 0), 0);
  const totalPaid = payables.reduce((sum: number, p: any) => sum + (p.total_paid || 0), 0);

  const formatted = payables.map((row: any) => ({
    ...row,
    total_purchases_formatted: formatPersianNumber(row.total_purchases || 0),
    total_paid_formatted: formatPersianNumber(row.total_paid || 0),
    total_remaining_formatted: formatPersianNumber(row.total_remaining || 0),
  }));

  const reportTitle = supplierId !== null && supplierName 
    ? `لیست بدهی‌ها: ${supplierName}`
    : "لیست بدهی‌ها (تمویل‌کنندگان)";

  return {
    title: reportTitle,
    type: "payables",
    dateRange: { from: fromDate, to },
    summary: {
      totalCount: payables.length,
      totalPurchases,
      totalPaid,
      totalRemaining: totalPayables,
    },
    sections: [
      {
        title: "خلاصه",
        type: "summary",
        data: [
          { label: "تعداد تمویل‌کنندگان با مانده", value: formatPersianNumber(payables.length) },
          { label: "مجموع خریداری‌ها", value: formatPersianNumber(totalPurchases) },
          { label: "مجموع پرداخت شده", value: formatPersianNumber(totalPaid) },
          { label: "مجموع بدهی‌ها (باقیمانده)", value: formatPersianNumber(totalPayables) },
        ],
      },
      {
        title: "لیست بدهی‌ها (تمویل‌کنندگان)",
        type: "table",
        columns: [
          { key: "full_name", label: "نام تمویل‌کننده" },
          { key: "total_purchases_formatted", label: "مجموع خریداری‌ها" },
          { key: "total_paid_formatted", label: "پرداخت شده" },
          { key: "total_remaining_formatted", label: "باقیمانده (بدهی)" },
        ],
        data: formatted,
      },
    ],
  };
}

export type ProfitReportOptions = {
  includeExpenses?: boolean;
  groupBy?: "none" | "product" | "month";
};

/**
 * Generate Profit Report filtered by date range
 * Revenue = sales.base_amount, Cost = purchases.total_amount, Gross = Revenue - Cost
 * Net = Gross - Expenses when includeExpenses is true
 */
export async function generateProfitReport(
  fromDate: string,
  toDate: string,
  options?: ProfitReportOptions
): Promise<ReportData> {
  const from = fromDate;
  const to = toDate;
  const includeExpenses = options?.includeExpenses !== false;
  const groupBy = options?.groupBy ?? "none";

  // Totals: sales (revenue), purchases (cost), expenses
  const salesTotalQuery = `
    SELECT COALESCE(SUM(base_amount), 0) as total
    FROM sales WHERE date >= ? AND date <= ?
  `;
  const purchasesTotalQuery = `
    SELECT COALESCE(SUM(total_amount), 0) as total
    FROM purchases WHERE date >= ? AND date <= ?
  `;
  const expensesTotalQuery = `
    SELECT COALESCE(SUM(total), 0) as total
    FROM expenses WHERE date >= ? AND date <= ?
  `;

  const [salesResult, purchasesResult, expensesResult] = await Promise.all([
    queryDatabase(salesTotalQuery, [from, to]),
    queryDatabase(purchasesTotalQuery, [from, to]),
    includeExpenses ? queryDatabase(expensesTotalQuery, [from, to]) : Promise.resolve(null),
  ]);

  const revenue = (resultToObjects(salesResult)[0] as any)?.total ?? 0;
  const cost = (resultToObjects(purchasesResult)[0] as any)?.total ?? 0;
  const expensesTotal = includeExpenses && expensesResult
    ? (resultToObjects(expensesResult)[0] as any)?.total ?? 0
    : 0;

  const grossProfit = revenue - cost;
  const netProfit = grossProfit - expensesTotal;
  const marginGross = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const marginNet = revenue > 0 ? (netProfit / revenue) * 100 : 0;

  const summaryData: { label: string; value: string }[] = [
    { label: "درآمد", value: formatPersianNumber(revenue) },
    { label: "هزینه خرید", value: formatPersianNumber(cost) },
    { label: "سود ناخالص", value: formatPersianNumber(grossProfit) },
  ];
  if (includeExpenses) {
    summaryData.push({ label: "مصارف", value: formatPersianNumber(expensesTotal) });
    summaryData.push({ label: "سود خالص", value: formatPersianNumber(netProfit) });
    summaryData.push({
      label: "درصد سود (خالص)",
      value: revenue > 0 ? `${formatPersianNumber(Math.round(marginNet * 10) / 10)}٪` : "-",
    });
  } else {
    summaryData.push({
      label: "درصد سود",
      value: revenue > 0 ? `${formatPersianNumber(Math.round(marginGross * 10) / 10)}٪` : "-",
    });
  }

  const sections: ReportSection[] = [
    {
      title: "خلاصه گزارش",
      type: "summary",
      data: summaryData,
    },
  ];

  if (groupBy === "product") {
    const productSalesQuery = `
      SELECT
        p.id as product_id,
        p.name as product_name,
        COALESCE(SUM(si.total), 0) as total_sales_amount
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      WHERE s.date >= ? AND s.date <= ?
      GROUP BY p.id, p.name
    `;
    const productPurchasesQuery = `
      SELECT
        p.id as product_id,
        p.name as product_name,
        COALESCE(SUM(pi.total), 0) as total_purchase_amount
      FROM purchase_items pi
      JOIN purchases pur ON pi.purchase_id = pur.id
      JOIN products p ON pi.product_id = p.id
      WHERE pur.date >= ? AND pur.date <= ?
      GROUP BY p.id, p.name
    `;
    const [productSalesRes, productPurchasesRes] = await Promise.all([
      queryDatabase(productSalesQuery, [from, to]),
      queryDatabase(productPurchasesQuery, [from, to]),
    ]);
    const productSalesList = resultToObjects(productSalesRes) as any[];
    const productPurchasesList = resultToObjects(productPurchasesRes) as any[];

    const salesByProduct: Record<number, { name: string; sales: number }> = {};
    productSalesList.forEach((row: any) => {
      salesByProduct[row.product_id] = { name: row.product_name, sales: row.total_sales_amount || 0 };
    });
    const purchasesByProduct: Record<number, number> = {};
    productPurchasesList.forEach((row: any) => {
      purchasesByProduct[row.product_id] = row.total_purchase_amount || 0;
    });

    const allProductIds = new Set([
      ...Object.keys(salesByProduct).map(Number),
      ...Object.keys(purchasesByProduct).map(Number),
    ]);
    const productRows = Array.from(allProductIds).map((productId) => {
      const salesRow = salesByProduct[productId];
      const purchaseRow = productPurchasesList.find((p: any) => p.product_id === productId);
      const purchaseCost = purchasesByProduct[productId] ?? 0;
      const salesAmount = salesRow?.sales ?? 0;
      const productName = salesRow?.name ?? purchaseRow?.product_name ?? "-";
      const profit = salesAmount - purchaseCost;
      const marginPct = salesAmount > 0 ? (profit / salesAmount) * 100 : 0;
      return {
        product_name: productName,
        sales_formatted: formatPersianNumber(salesAmount),
        purchases_formatted: formatPersianNumber(purchaseCost),
        profit_formatted: formatPersianNumber(profit),
        margin_formatted: salesAmount > 0 ? `${formatPersianNumber(Math.round(marginPct * 10) / 10)}٪` : "-",
      };
    });

    sections.push({
      title: "سود بر اساس محصول",
      type: "table",
      columns: [
        { key: "product_name", label: "محصول" },
        { key: "sales_formatted", label: "درآمد" },
        { key: "purchases_formatted", label: "هزینه" },
        { key: "profit_formatted", label: "سود" },
        { key: "margin_formatted", label: "درصد سود" },
      ],
      data: productRows,
    });
  }

  if (groupBy === "month") {
    const monthSalesQuery = `
      SELECT strftime('%Y-%m', date) as month, COALESCE(SUM(base_amount), 0) as total
      FROM sales WHERE date >= ? AND date <= ?
      GROUP BY strftime('%Y-%m', date) ORDER BY month
    `;
    const monthPurchasesQuery = `
      SELECT strftime('%Y-%m', date) as month, COALESCE(SUM(total_amount), 0) as total
      FROM purchases WHERE date >= ? AND date <= ?
      GROUP BY strftime('%Y-%m', date) ORDER BY month
    `;
    const monthExpensesQuery = includeExpenses
      ? `
      SELECT strftime('%Y-%m', date) as month, COALESCE(SUM(total), 0) as total
      FROM expenses WHERE date >= ? AND date <= ?
      GROUP BY strftime('%Y-%m', date) ORDER BY month
    `
      : null;

    const [monthSalesRes, monthPurchasesRes, monthExpensesRes] = await Promise.all([
      queryDatabase(monthSalesQuery, [from, to]),
      queryDatabase(monthPurchasesQuery, [from, to]),
      monthExpensesQuery ? queryDatabase(monthExpensesQuery, [from, to]) : Promise.resolve(null),
    ]);

    const monthSales = (resultToObjects(monthSalesRes) as any[]).reduce((acc: Record<string, number>, r: any) => {
      acc[r.month] = r.total ?? 0;
      return acc;
    }, {});
    const monthPurchases = (resultToObjects(monthPurchasesRes) as any[]).reduce((acc: Record<string, number>, r: any) => {
      acc[r.month] = r.total ?? 0;
      return acc;
    }, {});
    const monthExpenses: Record<string, number> = {};
    if (monthExpensesRes) {
      (resultToObjects(monthExpensesRes) as any[]).forEach((r: any) => {
        monthExpenses[r.month] = r.total ?? 0;
      });
    }

    const allMonths = new Set([
      ...Object.keys(monthSales),
      ...Object.keys(monthPurchases),
      ...Object.keys(monthExpenses),
    ]);
    const monthRows = Array.from(allMonths)
      .sort()
      .map((month) => {
        const rev = monthSales[month] ?? 0;
        const costM = monthPurchases[month] ?? 0;
        const expM = monthExpenses[month] ?? 0;
        const grossM = rev - costM;
        const netM = grossM - expM;
        const monthDisplay = month ? georgianToPersian(month + "-01") : "-";
        const monthLabel = monthDisplay ? monthDisplay.slice(0, 7) : month;
        return {
          month_label: monthLabel,
          revenue_formatted: formatPersianNumber(rev),
          cost_formatted: formatPersianNumber(costM),
          gross_formatted: formatPersianNumber(grossM),
          ...(includeExpenses
            ? {
                expenses_formatted: formatPersianNumber(expM),
                net_formatted: formatPersianNumber(netM),
              }
            : {}),
        };
      });

    const monthColumns = [
      { key: "month_label", label: "ماه" },
      { key: "revenue_formatted", label: "درآمد" },
      { key: "cost_formatted", label: "هزینه خرید" },
      { key: "gross_formatted", label: "سود ناخالص" },
    ];
    if (includeExpenses) {
      monthColumns.push({ key: "expenses_formatted", label: "مصارف" });
      monthColumns.push({ key: "net_formatted", label: "سود خالص" });
    }
    sections.push({
      title: "سود بر اساس ماه",
      type: "table",
      columns: monthColumns,
      data: monthRows,
    });
  }

  return {
    title: "گزارش سود",
    type: "profit",
    dateRange: { from, to },
    summary: {
      revenue,
      cost,
      grossProfit,
      expensesTotal: includeExpenses ? expensesTotal : undefined,
      netProfit: includeExpenses ? netProfit : undefined,
      marginGross: revenue > 0 ? marginGross : undefined,
      marginNet: revenue > 0 && includeExpenses ? marginNet : undefined,
    },
    sections,
  };
}

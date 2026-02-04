import { invoke } from "@tauri-apps/api/core";

export interface Sale {
    id: number;
    customer_id: number;
    date: string;
    notes?: string | null;
    currency_id: number | null;
    exchange_rate: number;
    total_amount: number;
    base_amount: number;
    paid_amount: number;
    remaining_amount?: number; // Calculated on client side if needed, but useful in UI
    order_discount_type?: string | null;
    order_discount_value?: number;
    order_discount_amount?: number;
    discount_code_id?: number | null;
    created_at: string;
    updated_at: string;
}

export interface SaleItem {
    id: number;
    sale_id: number;
    product_id: number;
    unit_id: number;
    per_price: number;
    amount: number;
    total: number;
    purchase_item_id?: number | null;
    sale_type?: string | null;
    discount_type?: string | null;
    discount_value?: number;
    created_at: string;
}

export interface SaleAdditionalCost {
    id: number;
    sale_id: number;
    name: string;
    amount: number;
    created_at: string;
}

export interface SaleServiceItem {
    id: number;
    sale_id: number;
    service_id: number;
    name: string;
    price: number;
    quantity: number;
    total: number;
    discount_type?: string | null;
    discount_value?: number;
    created_at: string;
}

export interface SaleWithItems {
    sale: Sale;
    items: SaleItem[];
    service_items?: SaleServiceItem[];
    additional_costs?: SaleAdditionalCost[];
}

export interface SalePayment {
    id: number;
    sale_id: number;
    account_id: number | null;
    currency_id: number | null;
    exchange_rate: number;
    amount: number;
    base_amount: number;
    date: string;
    created_at: string;
}

export interface SaleItemInput {
    product_id: number;
    unit_id: number;
    per_price: number;
    amount: number;
    purchase_item_id?: number | null;
    sale_type?: 'retail' | 'wholesale' | null;
    discount_type?: 'percent' | 'fixed' | null;
    discount_value?: number;
}

export interface SaleServiceItemInput {
    service_id: number;
    name: string;
    price: number;
    quantity: number;
    discount_type?: 'percent' | 'fixed' | null;
    discount_value?: number;
}

export interface ProductBatch {
    purchase_item_id: number;
    purchase_id: number;
    batch_number?: string | null;
    purchase_date: string;
    expiry_date?: string | null;
    per_price: number;
    per_unit?: number | null;
    wholesale_price?: number | null;
    retail_price?: number | null;
    amount: number;
    remaining_quantity: number;
}

export interface SaleAdditionalCostInput {
    name: string;
    amount: number;
}

/**
 * Initialize the sales table schema
 * @returns Promise with success message
 */
export async function initSalesTable(): Promise<string> {
    return await invoke<string>("init_sales_table");
}

/**
 * Initialize the sale_discount_codes table (for existing DBs)
 * @returns Promise with success message
 */
export async function initSaleDiscountCodesTable(): Promise<string> {
    return await invoke<string>("init_sale_discount_codes_table");
}

/**
 * Validate a discount code and return (type, value) or throw
 * @param code Discount code
 * @param subtotal Items + services subtotal before order discount
 * @returns Promise with [type, value] e.g. ["percent", 10] or ["fixed", 50]
 */
export async function validateDiscountCode(code: string, subtotal: number): Promise<[string, number]> {
    return await invoke<[string, number]>("validate_discount_code", { code, subtotal });
}

/** Discount code / token for sales (coupon/promo). */
export interface SaleDiscountCode {
    id: number;
    code: string;
    type: "percent" | "fixed";
    value: number;
    min_purchase: number;
    valid_from: string | null;
    valid_to: string | null;
    max_uses: number | null;
    use_count: number;
    created_at: string;
}

/**
 * Get all discount codes, optionally filtered by search.
 */
export async function getDiscountCodes(search?: string): Promise<SaleDiscountCode[]> {
    return await invoke<SaleDiscountCode[]>("get_discount_codes", { search: search ?? null });
}

/**
 * Create a new discount code.
 */
export async function createDiscountCode(params: {
    code: string;
    type: "percent" | "fixed";
    value: number;
    min_purchase: number;
    valid_from?: string | null;
    valid_to?: string | null;
    max_uses?: number | null;
}): Promise<SaleDiscountCode> {
    const payload = {
        code: params.code.trim().toUpperCase(),
        type: params.type,
        value: params.value,
        min_purchase: params.min_purchase,
        valid_from: params.valid_from ?? null,
        valid_to: params.valid_to ?? null,
        max_uses: params.max_uses ?? null,
    };
    return await invoke<SaleDiscountCode>("create_discount_code", { payload });
}

/**
 * Update a discount code.
 */
export async function updateDiscountCode(id: number, params: {
    code: string;
    type: "percent" | "fixed";
    value: number;
    min_purchase: number;
    valid_from?: string | null;
    valid_to?: string | null;
    max_uses?: number | null;
}): Promise<SaleDiscountCode> {
    const payload = {
        code: params.code.trim().toUpperCase(),
        type: params.type,
        value: params.value,
        min_purchase: params.min_purchase,
        valid_from: params.valid_from ?? null,
        valid_to: params.valid_to ?? null,
        max_uses: params.max_uses ?? null,
    };
    return await invoke<SaleDiscountCode>("update_discount_code", { id, payload });
}

/**
 * Delete a discount code.
 */
export async function deleteDiscountCode(id: number): Promise<string> {
    return await invoke<string>("delete_discount_code", { id });
}

/**
 * Create a new sale with items and optional service items
 * @param customer_id Customer ID
 * @param date Sale date
 * @param notes Optional notes
 * @param currency_id Currency ID (optional)
 * @param exchange_rate Exchange rate
 * @param paid_amount Amount paid
 * @param additional_costs Array of additional costs
 * @param items Array of sale items
 * @param service_items Array of sale service items
 * @param order_discount_type 'percent' | 'fixed' | null
 * @param order_discount_value Value for order-level discount
 * @returns Promise with Sale
 */
export async function createSale(
    customer_id: number,
    date: string,
    notes: string | null,
    currency_id: number | null,
    exchange_rate: number,
    paid_amount: number,
    additional_costs: SaleAdditionalCostInput[],
    items: SaleItemInput[],
    service_items: SaleServiceItemInput[] = [],
    order_discount_type: 'percent' | 'fixed' | null = null,
    order_discount_value: number = 0
): Promise<Sale> {
    // Convert items to tuple: (product_id, unit_id, per_price, amount, purchase_item_id, sale_type, discount_type, discount_value)
    const itemsTuple: [number, number, number, number, number | null, string | null, string | null, number][] = items.map(item => [
        item.product_id,
        item.unit_id,
        item.per_price,
        item.amount,
        item.purchase_item_id ?? null,
        item.sale_type ?? null,
        (item.discount_type === 'percent' || item.discount_type === 'fixed') ? item.discount_type : null,
        item.discount_value ?? 0,
    ]);

    // Convert service_items to tuple: (service_id, name, price, quantity, discount_type, discount_value)
    const serviceItemsTuple: [number, string, number, number, string | null, number][] = service_items.map(si => [
        si.service_id,
        si.name,
        si.price,
        si.quantity,
        (si.discount_type === 'percent' || si.discount_type === 'fixed') ? si.discount_type : null,
        si.discount_value ?? 0,
    ]);

    const additionalCostsTuple: [string, number][] = additional_costs.map(cost => [
        cost.name,
        cost.amount,
    ]);

    return await invoke<Sale>("create_sale", {
        customerId: customer_id,
        date,
        notes: notes || null,
        currencyId: currency_id,
        exchangeRate: exchange_rate,
        paidAmount: paid_amount,
        additionalCosts: additionalCostsTuple,
        items: itemsTuple,
        serviceItems: serviceItemsTuple,
        orderDiscountType: order_discount_type,
        orderDiscountValue: order_discount_value,
    });
}

export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
}

/**
 * Get all sales with pagination
 * @param page Page number
 * @param perPage Items per page
 * @param search Search query
 * @param sortBy Sort column
 * @param sortOrder Sort order
 * @returns Promise with paginated sales
 */
export async function getSales(
    page: number = 1,
    perPage: number = 10,
    search: string = "",
    sortBy: string = "date",
    sortOrder: "asc" | "desc" = "desc"
): Promise<PaginatedResponse<Sale>> {
    return await invoke<PaginatedResponse<Sale>>("get_sales", {
        page,
        perPage,
        search: search || null,
        sortBy: sortBy || null,
        sortOrder: sortOrder || null,
    });
}

/**
 * Get a single sale with its items and service items
 * @param id Sale ID
 * @returns Promise with Sale, SaleItems, and SaleServiceItems
 */
export async function getSale(id: number): Promise<SaleWithItems> {
    const result = await invoke<[Sale, SaleItem[], SaleServiceItem[]]>("get_sale", { id });
    return {
        sale: result[0],
        items: result[1],
        service_items: result[2],
    };
}

/**
 * Update a sale
 * @param id Sale ID
 * @param customer_id Customer ID
 * @param date Sale date
 * @param notes Optional notes
 * @param currency_id Currency ID (optional)
 * @param exchange_rate Exchange rate
 * @param paid_amount Amount paid
 * @param additional_costs Array of additional costs
 * @param items Array of sale items
 * @param service_items Array of sale service items
 * @param order_discount_type 'percent' | 'fixed' | null
 * @param order_discount_value Value for order-level discount
 * @returns Promise with Sale
 */
export async function updateSale(
    id: number,
    customer_id: number,
    date: string,
    notes: string | null,
    currency_id: number | null,
    exchange_rate: number,
    paid_amount: number,
    additional_costs: SaleAdditionalCostInput[],
    items: SaleItemInput[],
    service_items: SaleServiceItemInput[] = [],
    order_discount_type: 'percent' | 'fixed' | null = null,
    order_discount_value: number = 0
): Promise<Sale> {
    const itemsTuple: [number, number, number, number, number | null, string | null, string | null, number][] = items.map(item => [
        item.product_id,
        item.unit_id,
        item.per_price,
        item.amount,
        item.purchase_item_id ?? null,
        item.sale_type ?? null,
        (item.discount_type === 'percent' || item.discount_type === 'fixed') ? item.discount_type : null,
        item.discount_value ?? 0,
    ]);

    const serviceItemsTuple: [number, string, number, number, string | null, number][] = service_items.map(si => [
        si.service_id,
        si.name,
        si.price,
        si.quantity,
        (si.discount_type === 'percent' || si.discount_type === 'fixed') ? si.discount_type : null,
        si.discount_value ?? 0,
    ]);

    const additionalCostsTuple: [string, number][] = additional_costs.map(cost => [
        cost.name,
        cost.amount,
    ]);

    return await invoke<Sale>("update_sale", {
        id,
        customerId: customer_id,
        date,
        notes: notes || null,
        currencyId: currency_id,
        exchangeRate: exchange_rate,
        paidAmount: paid_amount,
        additionalCosts: additionalCostsTuple,
        items: itemsTuple,
        serviceItems: serviceItemsTuple,
        orderDiscountType: order_discount_type,
        orderDiscountValue: order_discount_value,
    });
}

/**
 * Delete a sale
 * @param id Sale ID
 * @returns Promise with success message
 */
export async function deleteSale(id: number): Promise<string> {
    return await invoke<string>("delete_sale", { id });
}

/**
 * Create a sale item
 * @param sale_id Sale ID
 * @param product_id Product ID
 * @param unit_id Unit ID
 * @param per_price Price per unit
 * @param amount Quantity
 * @param purchase_item_id Optional purchase item ID
 * @param sale_type 'retail' | 'wholesale' | null
 * @param discount_type 'percent' | 'fixed' | null
 * @param discount_value Line discount value
 * @returns Promise with SaleItem
 */
export async function createSaleItem(
    sale_id: number,
    product_id: number,
    unit_id: number,
    per_price: number,
    amount: number,
    purchase_item_id?: number | null,
    sale_type?: 'retail' | 'wholesale' | null,
    discount_type?: 'percent' | 'fixed' | null,
    discount_value?: number
): Promise<SaleItem> {
    return await invoke<SaleItem>("create_sale_item", {
        saleId: sale_id,
        productId: product_id,
        unitId: unit_id,
        perPrice: per_price,
        amount,
        purchaseItemId: purchase_item_id ?? null,
        saleType: sale_type ?? null,
        discountType: discount_type ?? null,
        discountValue: discount_value ?? 0,
    });
}

/**
 * Get sale items for a sale
 * @param sale_id Sale ID
 * @returns Promise with array of SaleItem
 */
export async function getSaleItems(sale_id: number): Promise<SaleItem[]> {
    return await invoke<SaleItem[]>("get_sale_items", { saleId: sale_id });
}

/**
 * Update a sale item
 * @param id SaleItem ID
 * @param product_id Product ID
 * @param unit_id Unit ID
 * @param per_price Price per unit
 * @param amount Quantity
 * @param purchase_item_id Optional purchase item ID
 * @param sale_type 'retail' | 'wholesale' | null
 * @param discount_type 'percent' | 'fixed' | null
 * @param discount_value Line discount value
 * @returns Promise with SaleItem
 */
export async function updateSaleItem(
    id: number,
    product_id: number,
    unit_id: number,
    per_price: number,
    amount: number,
    purchase_item_id?: number | null,
    sale_type?: 'retail' | 'wholesale' | null,
    discount_type?: 'percent' | 'fixed' | null,
    discount_value?: number
): Promise<SaleItem> {
    return await invoke<SaleItem>("update_sale_item", {
        id,
        productId: product_id,
        unitId: unit_id,
        perPrice: per_price,
        amount,
        purchaseItemId: purchase_item_id ?? null,
        saleType: sale_type ?? null,
        discountType: discount_type ?? null,
        discountValue: discount_value ?? 0,
    });
}

/**
 * Delete a sale item
 * @param id SaleItem ID
 * @returns Promise with success message
 */
export async function deleteSaleItem(id: number): Promise<string> {
    return await invoke<string>("delete_sale_item", { id });
}

/**
 * Create a sale payment
 * @param sale_id Sale ID
 * @param account_id Account ID (optional)
 * @param currency_id Currency ID (optional)
 * @param exchange_rate Exchange rate
 * @param amount Payment Amount
 * @param date Payment Date
 * @returns Promise with SalePayment
 */
export async function createSalePayment(
    sale_id: number,
    account_id: number | null,
    currency_id: number | null,
    exchange_rate: number,
    amount: number,
    date: string
): Promise<SalePayment> {
    return await invoke<SalePayment>("create_sale_payment", {
        saleId: sale_id,
        accountId: account_id,
        currencyId: currency_id,
        exchangeRate: exchange_rate,
        amount,
        date,
    });
}

/**
 * Get payments for a sale
 * @param sale_id Sale ID
 * @returns Promise with array of SalePayment
 */
export async function getSalePayments(sale_id: number): Promise<SalePayment[]> {
    return await invoke<SalePayment[]>("get_sale_payments", { saleId: sale_id });
}

/**
 * Delete a sale payment
 * @param id Payment ID
 * @returns Promise with success message
 */
export async function deleteSalePayment(id: number): Promise<string> {
    return await invoke<string>("delete_sale_payment", { id });
}

/**
 * Get sale additional costs
 * @param sale_id Sale ID
 * @returns Promise with array of SaleAdditionalCost
 */
export async function getSaleAdditionalCosts(sale_id: number): Promise<SaleAdditionalCost[]> {
    return await invoke<SaleAdditionalCost[]>("get_sale_additional_costs", { saleId: sale_id });
}

/**
 * Create a sale additional cost
 * @param sale_id Sale ID
 * @param name Cost name
 * @param amount Cost amount
 * @returns Promise with SaleAdditionalCost
 */
export async function createSaleAdditionalCost(
    sale_id: number,
    name: string,
    amount: number
): Promise<SaleAdditionalCost> {
    return await invoke<SaleAdditionalCost>("create_sale_additional_cost", {
        saleId: sale_id,
        name,
        amount,
    });
}

/**
 * Update a sale additional cost
 * @param id Additional cost ID
 * @param name Cost name
 * @param amount Cost amount
 * @returns Promise with SaleAdditionalCost
 */
export async function updateSaleAdditionalCost(
    id: number,
    name: string,
    amount: number
): Promise<SaleAdditionalCost> {
    return await invoke<SaleAdditionalCost>("update_sale_additional_cost", {
        id,
        name,
        amount,
    });
}

/**
 * Delete a sale additional cost
 * @param id Additional cost ID
 * @returns Promise with success message
 */
export async function deleteSaleAdditionalCost(id: number): Promise<string> {
    return await invoke<string>("delete_sale_additional_cost", { id });
}

/**
 * Get all batches for a product
 * @param productId Product ID
 * @returns Promise with array of ProductBatch
 */
export async function getProductBatches(productId: number): Promise<ProductBatch[]> {
    return await invoke<ProductBatch[]>("get_product_batches", { productId });
}

export interface ProductStock {
    product_id: number;
    total_base: number;
    total_in_unit: number | null;
}

/**
 * Get product-level stock (sum of batch remaining). If unitId is provided, total_in_unit is set.
 */
export async function getProductStock(productId: number, unitId?: number | null): Promise<ProductStock> {
    return await invoke<ProductStock>("get_product_stock", {
        productId,
        unitId: unitId ?? undefined,
    });
}

export interface StockBatchRow {
    product_id: number;
    product_name: string;
    purchase_item_id: number;
    purchase_id: number;
    batch_number: string | null;
    purchase_date: string;
    expiry_date: string | null;
    unit_name: string;
    amount: number;
    remaining_quantity: number;
    per_price: number;
    total_purchase_cost: number;
    cost_price: number;
    retail_price: number | null;
    wholesale_price: number | null;
    stock_value: number;
    potential_revenue_retail: number;
    potential_profit: number;
    margin_percent: number;
}

/**
 * Get stock report: all batches with remaining > 0.
 */
export async function getStockByBatches(): Promise<StockBatchRow[]> {
    return await invoke<StockBatchRow[]>("get_stock_by_batches");
}

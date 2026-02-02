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
}

export interface SaleServiceItemInput {
    service_id: number;
    name: string;
    price: number;
    quantity: number;
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
    service_items: SaleServiceItemInput[] = []
): Promise<Sale> {
    // Convert items to tuple format expected by Rust: (product_id, unit_id, per_price, amount, purchase_item_id, sale_type)
    const itemsTuple: [number, number, number, number, number | null, string | null][] = items.map(item => [
        item.product_id,
        item.unit_id,
        item.per_price,
        item.amount,
        item.purchase_item_id ?? null,
        item.sale_type ?? null,
    ]);

    // Convert service_items to tuple format expected by Rust: (service_id, name, price, quantity)
    const serviceItemsTuple: [number, string, number, number][] = service_items.map(si => [
        si.service_id,
        si.name,
        si.price,
        si.quantity,
    ]);

    // Convert additional_costs to tuple format expected by Rust: (name, amount)
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
        service_items: serviceItemsTuple,
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
 * Get a single sale with its items
 * @param id Sale ID
 * @returns Promise with Sale and SaleItems
 */
export async function getSale(id: number): Promise<SaleWithItems> {
    const result = await invoke<[Sale, SaleItem[]]>("get_sale", { id });
    return {
        sale: result[0],
        items: result[1],
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
    service_items: SaleServiceItemInput[] = []
): Promise<Sale> {
    // Convert items to tuple format expected by Rust: (product_id, unit_id, per_price, amount, purchase_item_id, sale_type)
    const itemsTuple: [number, number, number, number, number | null, string | null][] = items.map(item => [
        item.product_id,
        item.unit_id,
        item.per_price,
        item.amount,
        item.purchase_item_id ?? null,
        item.sale_type ?? null,
    ]);

    // Convert service_items to tuple format expected by Rust: (service_id, name, price, quantity)
    const serviceItemsTuple: [number, string, number, number][] = service_items.map(si => [
        si.service_id,
        si.name,
        si.price,
        si.quantity,
    ]);

    // Convert additional_costs to tuple format expected by Rust: (name, amount)
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
        service_items: serviceItemsTuple,
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
 * @returns Promise with SaleItem
 */
export async function createSaleItem(
    sale_id: number,
    product_id: number,
    unit_id: number,
    per_price: number,
    amount: number,
    purchase_item_id?: number | null,
    sale_type?: 'retail' | 'wholesale' | null
): Promise<SaleItem> {
    return await invoke<SaleItem>("create_sale_item", {
        saleId: sale_id,
        productId: product_id,
        unitId: unit_id,
        perPrice: per_price,
        amount,
        purchaseItemId: purchase_item_id ?? null,
        saleType: sale_type ?? null,
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
 * @returns Promise with SaleItem
 */
export async function updateSaleItem(
    id: number,
    product_id: number,
    unit_id: number,
    per_price: number,
    amount: number,
    purchase_item_id?: number | null,
    sale_type?: 'retail' | 'wholesale' | null
): Promise<SaleItem> {
    return await invoke<SaleItem>("update_sale_item", {
        id,
        productId: product_id,
        unitId: unit_id,
        perPrice: per_price,
        amount,
        purchaseItemId: purchase_item_id ?? null,
        saleType: sale_type ?? null,
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

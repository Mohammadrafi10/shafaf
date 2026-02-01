import { invoke } from "@tauri-apps/api/core";

export interface Service {
    id: number;
    customer_id: number;
    date: string;
    notes?: string | null;
    currency_id: number | null;
    exchange_rate: number;
    total_amount: number;
    base_amount: number;
    paid_amount: number;
    created_at: string;
    updated_at: string;
}

export interface ServiceItem {
    id: number;
    service_id: number;
    name: string;
    price: number;
    quantity: number;
    total: number;
    created_at: string;
}

export interface ServicePayment {
    id: number;
    service_id: number;
    account_id: number | null;
    currency_id: number | null;
    exchange_rate: number;
    amount: number;
    base_amount: number;
    date: string;
    created_at: string;
}

export interface ServiceItemInput {
    name: string;
    price: number;
    quantity: number;
}

export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
}

/**
 * Initialize the services table schema
 * @returns Promise with success message
 */
export async function initServicesTable(): Promise<string> {
    return await invoke<string>("init_services_table");
}

/**
 * Create a new service with items
 * @param customer_id Customer ID
 * @param date Service date
 * @param notes Optional notes
 * @param currency_id Currency ID (optional)
 * @param exchange_rate Exchange rate
 * @param paid_amount Amount paid
 * @param items Array of service items (name, price, quantity)
 * @returns Promise with Service
 */
export async function createService(
    customer_id: number,
    date: string,
    notes: string | null,
    currency_id: number | null,
    exchange_rate: number,
    paid_amount: number,
    items: ServiceItemInput[]
): Promise<Service> {
    const itemsTuple: [string, number, number][] = items.map((item) => [
        item.name,
        item.price,
        item.quantity,
    ]);

    return await invoke<Service>("create_service", {
        customerId: customer_id,
        date,
        notes: notes || null,
        currencyId: currency_id,
        exchangeRate: exchange_rate,
        paidAmount: paid_amount,
        items: itemsTuple,
    });
}

/**
 * Update a service with items
 * @param id Service ID
 * @param customer_id Customer ID
 * @param date Service date
 * @param notes Optional notes
 * @param currency_id Currency ID (optional)
 * @param exchange_rate Exchange rate
 * @param paid_amount Amount paid
 * @param items Array of service items
 * @returns Promise with Service
 */
export async function updateService(
    id: number,
    customer_id: number,
    date: string,
    notes: string | null,
    currency_id: number | null,
    exchange_rate: number,
    paid_amount: number,
    items: ServiceItemInput[]
): Promise<Service> {
    const itemsTuple: [string, number, number][] = items.map((item) => [
        item.name,
        item.price,
        item.quantity,
    ]);

    return await invoke<Service>("update_service", {
        id,
        customerId: customer_id,
        date,
        notes: notes || null,
        currencyId: currency_id,
        exchangeRate: exchange_rate,
        paidAmount: paid_amount,
        items: itemsTuple,
    });
}

/**
 * Delete a service
 * @param id Service ID
 * @returns Promise with success message
 */
export async function deleteService(id: number): Promise<string> {
    return await invoke<string>("delete_service", { id });
}

/**
 * Get services with pagination
 * @param page Page number
 * @param perPage Items per page
 * @param search Search term
 * @param sortBy Sort column
 * @param sortOrder Sort direction
 * @returns Promise with paginated services
 */
export async function getServices(
    page: number = 1,
    perPage: number = 10,
    search: string = "",
    sortBy: string = "date",
    sortOrder: "asc" | "desc" = "desc"
): Promise<PaginatedResponse<Service>> {
    return await invoke<PaginatedResponse<Service>>("get_services", {
        page,
        perPage,
        search: search || null,
        sortBy: sortBy || null,
        sortOrder: sortOrder || null,
    });
}

/**
 * Get a single service by ID with its items
 * @param id Service ID
 * @returns Promise with [Service, ServiceItem[]]
 */
export async function getService(
    id: number
): Promise<[Service, ServiceItem[]]> {
    return await invoke<[Service, ServiceItem[]]>("get_service", { id });
}

/**
 * Get service items for a service
 * @param service_id Service ID
 * @returns Promise with array of ServiceItem
 */
export async function getServiceItems(service_id: number): Promise<ServiceItem[]> {
    return await invoke<ServiceItem[]>("get_service_items", {
        serviceId: service_id,
    });
}

/**
 * Create a service item
 * @param service_id Service ID
 * @param name Item name
 * @param price Price per unit
 * @param quantity Quantity
 * @returns Promise with ServiceItem
 */
export async function createServiceItem(
    service_id: number,
    name: string,
    price: number,
    quantity: number
): Promise<ServiceItem> {
    return await invoke<ServiceItem>("create_service_item", {
        serviceId: service_id,
        name,
        price,
        quantity,
    });
}

/**
 * Update a service item
 * @param id ServiceItem ID
 * @param name Item name
 * @param price Price per unit
 * @param quantity Quantity
 * @returns Promise with ServiceItem
 */
export async function updateServiceItem(
    id: number,
    name: string,
    price: number,
    quantity: number
): Promise<ServiceItem> {
    return await invoke<ServiceItem>("update_service_item", {
        id,
        name,
        price,
        quantity,
    });
}

/**
 * Delete a service item
 * @param id ServiceItem ID
 * @returns Promise with success message
 */
export async function deleteServiceItem(id: number): Promise<string> {
    return await invoke<string>("delete_service_item", { id });
}

/**
 * Create a service payment (optional account deposit)
 * @param service_id Service ID
 * @param account_id Account ID (optional, for deposit)
 * @param currency_id Currency ID (optional)
 * @param exchange_rate Exchange rate
 * @param amount Payment amount
 * @param date Payment date
 * @returns Promise with ServicePayment
 */
export async function createServicePayment(
    service_id: number,
    account_id: number | null,
    currency_id: number | null,
    exchange_rate: number,
    amount: number,
    date: string
): Promise<ServicePayment> {
    return await invoke<ServicePayment>("create_service_payment", {
        serviceId: service_id,
        accountId: account_id,
        currencyId: currency_id,
        exchangeRate: exchange_rate,
        amount,
        date,
    });
}

/**
 * Get payments for a service
 * @param service_id Service ID
 * @returns Promise with array of ServicePayment
 */
export async function getServicePayments(
    service_id: number
): Promise<ServicePayment[]> {
    return await invoke<ServicePayment[]>("get_service_payments", {
        serviceId: service_id,
    });
}

/**
 * Delete a service payment
 * @param id Payment ID
 * @returns Promise with success message
 */
export async function deleteServicePayment(id: number): Promise<string> {
    return await invoke<string>("delete_service_payment", { id });
}

import { invoke } from "@tauri-apps/api/core";

export interface Service {
    id: number;
    name: string;
    price: number;
    currency_id: number | null;
    description: string | null;
    created_at: string;
    updated_at: string;
}

export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
}

/**
 * Initialize the services table schema (catalog)
 * @returns Promise with success message
 */
export async function initServicesTable(): Promise<string> {
    return await invoke<string>("init_services_table");
}

/**
 * Create a new service (catalog entry)
 * @param name Service name
 * @param price Default price
 * @param currency_id Currency ID (optional)
 * @param description Optional description
 * @returns Promise with Service
 */
export async function createService(
    name: string,
    price: number,
    currency_id: number | null,
    description: string | null
): Promise<Service> {
    return await invoke<Service>("create_service", {
        name,
        price,
        currencyId: currency_id,
        description: description || null,
    });
}

/**
 * Update a service (catalog entry)
 * @param id Service ID
 * @param name Service name
 * @param price Default price
 * @param currency_id Currency ID (optional)
 * @param description Optional description
 * @returns Promise with Service
 */
export async function updateService(
    id: number,
    name: string,
    price: number,
    currency_id: number | null,
    description: string | null
): Promise<Service> {
    return await invoke<Service>("update_service", {
        id,
        name,
        price,
        currencyId: currency_id,
        description: description || null,
    });
}

/**
 * Delete a service (catalog entry)
 * @param id Service ID
 * @returns Promise with success message
 */
export async function deleteService(id: number): Promise<string> {
    return await invoke<string>("delete_service", { id });
}

/**
 * Get services (catalog) with pagination
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
    sortBy: string = "name",
    sortOrder: "asc" | "desc" = "asc"
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
 * Get a single service (catalog entry) by ID
 * @param id Service ID
 * @returns Promise with Service
 */
export async function getService(id: number): Promise<Service> {
    return await invoke<Service>("get_service", { id });
}

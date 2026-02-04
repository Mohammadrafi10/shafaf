import { invoke } from "@tauri-apps/api/core";

export interface CompanySettings {
    id: number;
    name: string;
    logo?: string;
    phone?: string;
    address?: string;
    font?: string;
    auto_backup_dir?: string | null;
    created_at: string;
    updated_at: string;
}

export interface CompanySettingsFormData {
    name: string;
    logo?: string;
    phone?: string;
    address?: string;
    font?: string;
    auto_backup_dir?: string | null;
}

/**
 * Initialize the company_settings table
 * @returns Promise with success message
 */
export async function initCompanySettingsTable(): Promise<string> {
    return await invoke<string>("init_company_settings_table");
}

/**
 * Get company settings
 * @returns Promise with company settings
 */
export async function getCompanySettings(): Promise<CompanySettings> {
    return await invoke<CompanySettings>("get_company_settings");
}

/**
 * Update company settings
 * @param settings Company settings data
 * @returns Promise with updated company settings
 */
export async function updateCompanySettings(
    settings: CompanySettingsFormData
): Promise<CompanySettings> {
    return await invoke<CompanySettings>("update_company_settings", {
        name: settings.name,
        logo: settings.logo || null,
        phone: settings.phone || null,
        address: settings.address || null,
        font: settings.font || null,
        auto_backup_dir: settings.auto_backup_dir ?? null,
    });
}

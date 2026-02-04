import { invoke } from "@tauri-apps/api/core";

export interface ThermalReceiptItem {
    name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
}

export interface ThermalReceiptPayload {
    company_name: string | null;
    sale_id: number;
    sale_date: string;
    total_amount: number;
    paid_amount: number;
    order_discount_amount: number;
    notes: string | null;
    customer_name: string;
    items: ThermalReceiptItem[];
    currency_label: string;
}

const STORAGE_KEY_IP = "shafaf_thermal_printer_ip";
const STORAGE_KEY_PORT = "shafaf_thermal_printer_port";
const DEFAULT_PORT = 9100;

export function getStoredThermalPrinter(): { ip: string; port: number } | null {
    try {
        const ip = localStorage.getItem(STORAGE_KEY_IP)?.trim();
        if (!ip) return null;
        const portStr = localStorage.getItem(STORAGE_KEY_PORT);
        const port = portStr ? parseInt(portStr, 10) : DEFAULT_PORT;
        return { ip, port: isNaN(port) ? DEFAULT_PORT : port };
    } catch {
        return null;
    }
}

export function setStoredThermalPrinter(ip: string, port: number): void {
    localStorage.setItem(STORAGE_KEY_IP, ip.trim());
    localStorage.setItem(STORAGE_KEY_PORT, String(port));
}

/**
 * Send sale receipt to thermal printer (ESC/POS over network).
 */
export async function printSaleReceiptThermal(
    payload: ThermalReceiptPayload,
    printerIp: string,
    printerPort?: number
): Promise<void> {
    await invoke("print_sale_receipt_thermal", {
        payload: {
            company_name: payload.company_name ?? null,
            sale_id: payload.sale_id,
            sale_date: payload.sale_date,
            total_amount: payload.total_amount,
            paid_amount: payload.paid_amount,
            order_discount_amount: payload.order_discount_amount,
            notes: payload.notes ?? null,
            customer_name: payload.customer_name,
            items: payload.items,
            currency_label: payload.currency_label,
        },
        printerIp: printerIp.trim(),
        printerPort: printerPort ?? DEFAULT_PORT,
    });
}

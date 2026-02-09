import { queryDatabase } from "./db";
import { REPORT_SCHEMA } from "./reportSchema";

declare global {
  interface Window {
    puter?: {
      ai?: {
        chat: (
          prompt: string | { role: string; content: string }[],
          options?: { tools?: unknown[]; model?: string }
        ) => Promise<{ message?: { content?: string; tool_calls?: PuterToolCall[] }; text?: string }>;
      };
    };
  }
}

interface PuterToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface ReportTableColumn {
  key: string;
  label: string;
}

export interface ReportTable {
  columns: ReportTableColumn[];
  rows: Record<string, unknown>[];
}

export interface ReportChartSeries {
  name: string;
  data: number[];
}

export interface ReportChart {
  type: "line" | "bar" | "area" | "pie" | "donut";
  categories?: string[];
  series: ReportChartSeries[];
  labels?: string[];
}

export interface ReportSection {
  type: "table" | "chart";
  title: string;
  table?: ReportTable;
  chart?: ReportChart;
}

export interface ReportJson {
  title: string;
  summary?: string;
  sections: ReportSection[];
}

export interface GenerateReportOptions {
  model?: string;
  previousMessages?: { role: string; content: string }[];
  refinementText?: string;
}

export interface GenerateReportResult {
  report: ReportJson;
  messages: { role: string; content: string }[];
}

const TABLE_WHITELIST = new Set([
  "users", "currencies", "suppliers", "customers", "unit_groups", "units", "products",
  "purchases", "purchase_items", "purchase_additional_costs", "purchase_payments",
  "sales", "sale_items", "sale_payments", "sale_additional_costs",
  "services", "service_items", "service_payments",
  "expense_types", "expenses",
  "employees", "salaries", "deductions", "company_settings", "coa_categories",
  "account_currency_balances", "journal_entries", "journal_entry_lines", "currency_exchange_rates",
  "accounts", "account_transactions"
]);

const SYSTEM_PROMPT = `You are a report generator for a Persian/English finance and inventory app using MySQL database.

Tools:
- Use describe_table when unsure about a table's columns before writing SQL. This returns column names and types.
- Use run_query to fetch data. SQL must be SELECT only (or WITH for CTEs). If run_query returns an error, analyze the error message and try a simpler or corrected query.
- Use SUM, COUNT, AVG, GROUP BY, JOIN across tables. Prefer LIMIT 500 for large listings.
- MySQL syntax: Use backticks for table/column names if they contain special characters. Use DATE() function for date comparisons. Use DATE_FORMAT() for date formatting.

Common joins: 
- sales + sale_items + products (sale_items.sale_id=sales.id, sale_items.product_id=products.id)
- purchases + purchase_items + products (purchase_items.purchase_id=purchases.id, purchase_items.product_id=products.id)
- expenses + expense_types (expenses.expense_type_id=expense_types.id)
- sales + customers (sales.customer_id=customers.id)
- purchases + suppliers (purchases.supplier_id=suppliers.id)

For comparable amounts across currencies, prefer base_amount or total in base currency.

Chart types: use "line" for time series, "bar" for categories, "pie"/"donut" for composition shares.

If a query returns no rows, still return valid JSON: use empty rows [] and add a short summary like "در این بازه داده‌ای ثبت نشده."

Privacy: do not include full_name, email, or phone in report rows unless the user explicitly asks.

Database schema:
${REPORT_SCHEMA}

Your final response must be ONLY a valid JSON object (no markdown, no \`\`\`json, no extra text):
{
  "title": "string",
  "summary": "string or omit",
  "sections": [
    {
      "type": "table",
      "title": "string",
      "table": {
        "columns": [{"key": "colKey", "label": "Display Label"}],
        "rows": [{"colKey": "value", ...}]
      }
    },
    {
      "type": "chart",
      "title": "string",
      "chart": {
        "type": "line"|"bar"|"area"|"pie"|"donut",
        "categories": ["cat1","cat2"],
        "series": [{"name": "string", "data": [1,2,3]}],
        "labels": ["l1","l2"]
      }
    }
  ]
}
- Table: key=column name, label=human label, rows as objects keyed by column.
- line/bar/area: categories=x-axis, series=[{name, data}]. Ensure series[0].data.length === categories.length.
- pie/donut: series[0].data = values, labels = slice labels. Ensure labels.length === series[0].data.length.
Respond ONLY with the JSON object.`;

const RUN_QUERY_TOOL = {
  type: "function" as const,
  function: {
    name: "run_query",
    description:
      "Execute a read-only SELECT query on the database. Use for report data. SQL must be SELECT only. params: JSON array string, e.g. '[]' or '[\"2024-01-01\"]'.",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SELECT query" },
        params: { type: "string", description: "JSON array of parameters" }
      },
      required: ["sql"] as const
    }
  }
};

const DESCRIBE_TABLE_TOOL = {
  type: "function" as const,
  function: {
    name: "describe_table",
    description: "Get column names and types for a table. Use when unsure about a table's schema before writing SQL.",
    parameters: {
      type: "object",
      properties: { table: { type: "string", description: "Table name" } },
      required: ["table"] as const
    }
  }
};

function isSelectOnly(sql: string): boolean {
  const t = sql.trim().toUpperCase();
  // Check for SELECT statements, allow WITH clauses (CTEs) and subqueries
  const normalized = t.replace(/\s+/g, " ");
  // Block dangerous keywords
  const dangerousKeywords = ["DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "CREATE", "TRUNCATE", "EXEC", "EXECUTE"];
  for (const keyword of dangerousKeywords) {
    if (normalized.includes(` ${keyword} `) || normalized.startsWith(`${keyword} `)) {
      return false;
    }
  }
  // Must start with SELECT or WITH (for CTEs)
  return normalized.startsWith("SELECT") || normalized.startsWith("WITH");
}

async function handleRunQuery(args: { sql?: string; params?: string }): Promise<string> {
  const sql = args?.sql;
  if (!sql || typeof sql !== "string") {
    return JSON.stringify({ error: "Missing sql" });
  }
  if (!isSelectOnly(sql)) {
    return JSON.stringify({ error: "Only SELECT queries are allowed. Dangerous operations like DROP, DELETE, UPDATE, INSERT, ALTER are blocked." });
  }
  let params: unknown[] = [];
  try {
    params = JSON.parse(args?.params || "[]");
  } catch {
    params = [];
  }
  if (!Array.isArray(params)) params = [];
  try {
    const res = await queryDatabase(sql, params);
    return JSON.stringify({ columns: res.columns, rows: res.rows });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ 
      error: `Query execution failed: ${errorMsg}. Check SQL syntax, table names, column names, and parameter types.`,
      columns: [],
      rows: []
    });
  }
}

async function handleDescribeTable(args: { table?: string }): Promise<string> {
  const table = args?.table && String(args.table).trim().toLowerCase();
  if (!table || !TABLE_WHITELIST.has(table)) {
    return JSON.stringify({ error: "Unknown or disallowed table. Use one of: " + [...TABLE_WHITELIST].slice(0, 10).join(", ") + ", ..." });
  }
  try {
    // Use MySQL DESCRIBE syntax instead of SQLite PRAGMA
    const res = await queryDatabase(`DESCRIBE ${table}`, []);
    // MySQL DESCRIBE returns: Field, Type, Null, Key, Default, Extra
    const fieldIdx = res.columns.indexOf("Field");
    const typeIdx = res.columns.indexOf("Type");
    const columns = res.rows.map((row) => ({ 
      name: fieldIdx >= 0 ? row[fieldIdx] : null, 
      type: typeIdx >= 0 ? row[typeIdx] : null 
    }));
    return JSON.stringify({ columns });
  } catch (error) {
    // Fallback: try SHOW COLUMNS if DESCRIBE fails
    try {
      const res = await queryDatabase(`SHOW COLUMNS FROM ${table}`, []);
      const fieldIdx = res.columns.indexOf("Field");
      const typeIdx = res.columns.indexOf("Type");
      const columns = res.rows.map((row) => ({ 
        name: fieldIdx >= 0 ? row[fieldIdx] : null, 
        type: typeIdx >= 0 ? row[typeIdx] : null 
      }));
      return JSON.stringify({ columns });
    } catch (fallbackError) {
      return JSON.stringify({ 
        error: `Could not get schema for table: ${table}. Refer to the system schema. Details: ${(fallbackError as Error).message}` 
      });
    }
  }
}

function extractJson(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  return text.trim();
}

export function isPuterAvailable(): boolean {
  return typeof window !== "undefined" && !!window.puter?.ai?.chat;
}

export async function generateReport(
  userPrompt: string,
  options?: GenerateReportOptions
): Promise<GenerateReportResult> {
  const puter = (typeof window !== "undefined" && window.puter) || undefined;
  if (!puter?.ai?.chat) {
    throw new Error("Puter SDK بارگذاری نشده. شناسه اپ و توکن Puter را وارد کرده و «اعمال» بزنید.");
  }

  let messages: { role: string; content: string }[];

  if (options?.previousMessages?.length && options?.refinementText) {
    messages = [
      ...options.previousMessages,
      { role: "user", content: `بر اساس گزارش قبلی، این تغییر را اعمال کن: ${options.refinementText}` }
    ];
  } else {
    messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ];
  }

  const tools = [RUN_QUERY_TOOL, DESCRIBE_TABLE_TOOL];
  const chatOpts: { tools: unknown[]; model?: string } = { tools };
  if (options?.model) chatOpts.model = options.model;

  let response = await puter.ai.chat(messages, chatOpts);

  while (response?.message?.tool_calls?.length) {
    const msg = response.message;
    const assistantMsg: Record<string, unknown> = { role: "assistant", content: msg.content || "" };
    if (msg.tool_calls?.length) assistantMsg.tool_calls = msg.tool_calls;
    messages.push(assistantMsg as { role: string; content: string });

    for (const tc of msg.tool_calls ?? []) {
      const name = tc.function?.name;
      let content: string;
      if (name === "run_query") {
        let args: { sql?: string; params?: string } = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }
        content = await handleRunQuery(args);
      } else if (name === "describe_table") {
        let args: { table?: string } = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }
        content = await handleDescribeTable(args);
      } else {
        content = JSON.stringify({ error: "Unknown tool: " + name });
      }
      messages.push({ role: "tool", content, tool_call_id: tc.id } as { role: string; content: string; tool_call_id: string });
    }

    response = await puter.ai.chat(messages, chatOpts);
  }

  const raw = (response?.message?.content ?? response?.text ?? "").trim();
  if (!raw) throw new Error("Empty response from AI.");

  const jsonStr = extractJson(raw);
  let report: ReportJson;

  function tryParse(): ReportJson {
    const parsed = JSON.parse(jsonStr) as ReportJson;
    if (!parsed || typeof parsed.title !== "string" || !Array.isArray(parsed.sections)) {
      throw new Error("Report must have title and sections array.");
    }
    return parsed;
  }

  try {
    report = tryParse();
    messages.push({ role: "assistant", content: raw });
  } catch (e) {
    // Retry once: ask for valid JSON only
    messages.push({ role: "assistant", content: raw });
    messages.push({ role: "user", content: "پاسخ قبلی JSON معتبر نبود. فقط آبجکت JSON را بدون markdown یا متن اضافه برگردان." });
    const retry = await puter.ai.chat(messages, chatOpts);
    const retryRaw = (retry?.message?.content ?? retry?.text ?? "").trim();
    if (!retryRaw) throw new Error(`Invalid report JSON: ${(e as Error).message}. Raw: ${raw.slice(0, 500)}`);
    const retryStr = extractJson(retryRaw);
    try {
      report = JSON.parse(retryStr) as ReportJson;
      if (!report || typeof report.title !== "string" || !Array.isArray(report.sections)) {
        throw new Error("Report must have title and sections array.");
      }
    } catch (e2) {
      throw new Error(`Invalid report JSON after retry: ${(e2 as Error).message}. Raw: ${retryRaw.slice(0, 500)}`);
    }
    messages.push({ role: "assistant", content: retryRaw });
  }

  return { report, messages };
}

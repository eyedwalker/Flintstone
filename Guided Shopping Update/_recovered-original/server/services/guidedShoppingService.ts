/**
 * Guided Shopping Service — Postgres (pg)
 *
 * DB introspection + read-only query helpers. Main guided-shopping
 * endpoints use mock data (routes/guidedShopping.ts); this service
 * powers the /api/database/* debug endpoints.
 */

import { query } from '../config/database';

export interface TableInfo {
  tableName?: string;
  columnName: string;
  dataType: string;
  isNullable: string;
  columnDefault: string | null;
  maxLength?: number | null;
}

export interface GuidedShoppingData {
  [key: string]: any;
}

const VALID_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export class GuidedShoppingService {
  /**
   * Get tables that might be related to guided shopping
   */
  async getGuidedShoppingTables(): Promise<string[]> {
    const rows = await query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND (
          table_name ILIKE '%guided%'
          OR table_name ILIKE '%shopping%'
          OR table_name ILIKE '%lens%'
          OR table_name ILIKE '%treatment%'
          OR table_name ILIKE '%package%'
          OR table_name ILIKE '%tile%'
          OR table_name ILIKE '%product%'
          OR table_name ILIKE '%solution%'
        )
      ORDER BY table_name
    `);
    return rows.map(r => r.table_name);
  }

  /**
   * Get all tables in the current database
   */
  async getAllTables(): Promise<string[]> {
    const rows = await query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    return rows.map(r => r.table_name);
  }

  /**
   * Get column information for a specific table
   */
  async getTableSchema(tableName: string): Promise<TableInfo[]> {
    const rows = await query<any>(
      `
        SELECT
          column_name   AS "columnName",
          data_type     AS "dataType",
          is_nullable   AS "isNullable",
          column_default AS "columnDefault",
          character_maximum_length AS "maxLength"
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `,
      [tableName]
    );
    return rows;
  }

  /**
   * Query data from a specific table with optional limit
   */
  async queryTable(tableName: string, limit: number = 100): Promise<GuidedShoppingData[]> {
    if (!VALID_IDENT.test(tableName)) {
      throw new Error('Invalid table name');
    }
    const safeLimit = Math.min(Math.max(parseInt(String(limit)) || 100, 1), 1000);
    // Identifier cannot be parameterized; we validated the format above.
    const rows = await query<GuidedShoppingData>(
      `SELECT * FROM "${tableName}" LIMIT ${safeLimit}`
    );
    return rows;
  }

  /**
   * Search for tables by pattern (ILIKE)
   */
  async searchTables(searchPattern: string): Promise<string[]> {
    const rows = await query<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name ILIKE $1
        ORDER BY table_name
      `,
      [`%${searchPattern}%`]
    );
    return rows.map(r => r.table_name);
  }

  /**
   * Execute custom SQL query (read-only SELECT only)
   */
  async executeQuery(sqlText: string): Promise<any[]> {
    const lower = sqlText.toLowerCase().trim();
    if (
      lower.includes('insert') ||
      lower.includes('update') ||
      lower.includes('delete') ||
      lower.includes('drop') ||
      lower.includes('alter') ||
      lower.includes('create') ||
      lower.includes('truncate') ||
      lower.includes('grant') ||
      lower.includes('revoke')
    ) {
      throw new Error('Only SELECT queries are allowed');
    }
    const rows = await query<any>(sqlText);
    return rows;
  }

  /**
   * Test database connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await query('SELECT 1');
      return true;
    } catch (error) {
      console.error('[DB] Connection test failed:', error);
      return false;
    }
  }
}

export const guidedShoppingService = new GuidedShoppingService();

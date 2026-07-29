import express, { Request, Response } from 'express';
import { guidedShoppingService } from '../services/guidedShoppingService';

const router = express.Router();

/**
 * Test database connection
 */
router.get('/test', async (req: Request, res: Response) => {
  try {
    const isConnected = await guidedShoppingService.testConnection();
    res.json({
      success: isConnected,
      message: isConnected ? 'Database connection successful' : 'Database connection failed'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Connection test failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get all tables
 */
router.get('/tables', async (req: Request, res: Response) => {
  try {
    const tables = await guidedShoppingService.getAllTables();
    res.json({
      success: true,
      count: tables.length,
      tables
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tables',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get guided shopping related tables
 */
router.get('/tables/guided-shopping', async (req: Request, res: Response) => {
  try {
    const tables = await guidedShoppingService.getGuidedShoppingTables();
    res.json({
      success: true,
      count: tables.length,
      tables
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch guided shopping tables',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Search tables by pattern
 */
router.get('/tables/search/:pattern', async (req: Request, res: Response) => {
  try {
    const { pattern } = req.params;
    const tables = await guidedShoppingService.searchTables(pattern);
    res.json({
      success: true,
      count: tables.length,
      tables
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to search tables',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get table schema
 */
router.get('/tables/:tableName/schema', async (req: Request, res: Response) => {
  try {
    const { tableName } = req.params;
    const schema = await guidedShoppingService.getTableSchema(tableName);
    res.json({
      success: true,
      tableName,
      columns: schema
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch table schema',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Query table data
 */
router.get('/tables/:tableName/data', async (req: Request, res: Response) => {
  try {
    const { tableName } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;
    const data = await guidedShoppingService.queryTable(tableName, limit);
    res.json({
      success: true,
      tableName,
      count: data.length,
      data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to query table data',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Execute custom query (read-only)
 */
router.post('/query', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Query is required'
      });
    }
    
    const results = await guidedShoppingService.executeQuery(query);
    res.json({
      success: true,
      count: results.length,
      results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to execute query',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;

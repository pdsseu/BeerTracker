import { promises as fs } from 'fs';
import { join } from 'path';
import { ScrapedProduct } from '../types';
import { Logger } from './logger';

const RESULTS_FILE = join(process.cwd(), 'results.json');

interface StoredResults {
  results: ScrapedProduct[];
  lastUpdated: string;
}

/**
 * Save scraping results to disk
 */
export async function saveResults(results: ScrapedProduct[]): Promise<void> {
  try {
    const data: StoredResults = {
      results: results.map((result) => ({
        ...result,
        timestamp: result.timestamp instanceof Date ? result.timestamp.toISOString() : result.timestamp,
      })) as any,
      lastUpdated: new Date().toISOString(),
    };

    await fs.writeFile(RESULTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    Logger.success(`Results saved to ${RESULTS_FILE} (${results.length} products)`);
  } catch (error) {
    Logger.error('Failed to save results:', error);
    throw error;
  }
}

/**
 * Load scraping results from disk
 */
export async function loadResults(): Promise<ScrapedProduct[]> {
  try {
    const fileContent = await fs.readFile(RESULTS_FILE, 'utf-8');
    const data: StoredResults = JSON.parse(fileContent);

    // Convert timestamp strings back to Date objects
    const results: ScrapedProduct[] = data.results.map((result) => ({
      ...result,
      timestamp: new Date(result.timestamp as any),
    }));

    Logger.info(`Loaded ${results.length} results from ${RESULTS_FILE}`);
    Logger.info(`Last updated: ${data.lastUpdated}`);
    return results;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, return empty array
      Logger.info('No previous results found, starting fresh');
      return [];
    }
    Logger.error('Failed to load results:', error);
    return [];
  }
}

/**
 * Get the last update timestamp
 */
export async function getLastUpdateTime(): Promise<Date | null> {
  try {
    const fileContent = await fs.readFile(RESULTS_FILE, 'utf-8');
    const data: StoredResults = JSON.parse(fileContent);
    return new Date(data.lastUpdated);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    Logger.error('Failed to get last update time:', error);
    return null;
  }
}


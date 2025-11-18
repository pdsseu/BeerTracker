import { ScrapedProduct } from '../types';
import { Logger } from './logger';
import { getSupabaseClient } from './supabase-client';
import { randomUUID } from 'crypto';

/**
 * Save scraping results to Supabase database
 */
export async function saveResults(results: ScrapedProduct[]): Promise<void> {
  const supabase = getSupabaseClient();
  
  if (!supabase) {
    Logger.warn('Supabase client not available. Results will only be kept in memory.');
    return;
  }

  try {
    // Generate a unique session ID for this scraping run
    const scrapingSessionId = randomUUID();
    const sessionTimestamp = new Date();

    // Prepare products for insertion
    const productsToInsert = results.map((result) => ({
      product_name: result.productName,
      supermarket: result.supermarket,
      price: result.price,
      price_value: result.priceValue ?? null,
      target_product: result.targetProduct,
      link: result.link,
      timestamp: result.timestamp instanceof Date ? result.timestamp.toISOString() : result.timestamp,
      available: result.available,
      image_url: result.imageUrl ?? null,
      promo_tag: result.promoTag ?? null,
      scraping_session_id: scrapingSessionId,
    }));

    // Insert all products in a single batch operation
    const { error } = await supabase
      .from('scraped_products')
      .insert(productsToInsert);

    if (error) {
      Logger.error('Failed to save results to Supabase:', error);
      throw error;
    }

    Logger.success(`Results saved to Supabase (${results.length} products, session: ${scrapingSessionId})`);
  } catch (error) {
    Logger.error('Failed to save results:', error);
    throw error;
  }
}

/**
 * Load scraping results from Supabase database
 * Returns the latest scraping session's results
 */
export async function loadResults(): Promise<ScrapedProduct[]> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    Logger.warn('Supabase client not available. No results loaded from database.');
    return [];
  }

  try {
    // First, get the latest scraping session ID
    const { data: latestSession, error: sessionError } = await supabase
      .from('scraped_products')
      .select('scraping_session_id, timestamp')
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    if (sessionError || !latestSession) {
      Logger.info('No previous results found in Supabase, starting fresh');
      return [];
    }

    // Get all products from the latest session
    const { data: products, error } = await supabase
      .from('scraped_products')
      .select('*')
      .eq('scraping_session_id', latestSession.scraping_session_id)
      .order('timestamp', { ascending: true });

    if (error) {
      Logger.error('Failed to load results from Supabase:', error);
      return [];
    }

    if (!products || products.length === 0) {
      Logger.info('No products found for latest session');
      return [];
    }

    // Convert database records back to ScrapedProduct format
    const results: ScrapedProduct[] = products.map((product: any) => ({
      productName: product.product_name,
      supermarket: product.supermarket,
      price: product.price,
      priceValue: product.price_value ? parseFloat(product.price_value) : undefined,
      targetProduct: product.target_product,
      link: product.link,
      timestamp: new Date(product.timestamp),
      available: product.available,
      imageUrl: product.image_url ?? undefined,
      promoTag: product.promo_tag ?? undefined,
    }));

    Logger.info(`Loaded ${results.length} results from Supabase (session: ${latestSession.scraping_session_id})`);
    Logger.info(`Last updated: ${latestSession.timestamp}`);
    
    return results;
  } catch (error: any) {
    Logger.error('Failed to load results:', error);
    return [];
  }
}

/**
 * Get the last update timestamp from the latest scraping session
 */
export async function getLastUpdateTime(): Promise<Date | null> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('scraped_products')
      .select('timestamp')
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return new Date(data.timestamp);
  } catch (error) {
    Logger.error('Failed to get last update time:', error);
    return null;
  }
}

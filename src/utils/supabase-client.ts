import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Logger } from './logger';

let supabase: SupabaseClient | null = null;

/**
 * Get or create Supabase client instance
 * Uses service role key for server-side operations (bypasses RLS)
 */
export function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    Logger.warn('Supabase environment variables are missing. Results will only be kept in memory.');
    return null;
  }

  if (!supabase) {
    supabase = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return supabase;
}


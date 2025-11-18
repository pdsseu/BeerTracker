# Database Schema for BeerTracker

This document describes the Supabase database schema for storing scraped product data.

## Environment Variables

Set these environment variables in your Supabase project or deployment environment:

- `SUPABASE_URL`: Your Supabase project URL (e.g., `https://xxxxx.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key (found in Project Settings > API)

## Table: `scraped_products`

This table stores all scraped product information.

### SQL Schema

```sql
-- Create the scraped_products table
CREATE TABLE IF NOT EXISTS scraped_products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_name TEXT NOT NULL,
  supermarket TEXT NOT NULL,
  price TEXT NOT NULL,
  price_value NUMERIC(10, 2),
  target_product TEXT NOT NULL,
  link TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  available BOOLEAN NOT NULL DEFAULT true,
  image_url TEXT,
  promo_tag TEXT,
  scraping_session_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_scraped_products_session ON scraped_products(scraping_session_id);
CREATE INDEX IF NOT EXISTS idx_scraped_products_timestamp ON scraped_products(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_scraped_products_target_product ON scraped_products(target_product);
CREATE INDEX IF NOT EXISTS idx_scraped_products_supermarket ON scraped_products(supermarket);
CREATE INDEX IF NOT EXISTS idx_scraped_products_product_supermarket ON scraped_products(product_name, supermarket);

-- Create index for latest results query
CREATE INDEX IF NOT EXISTS idx_scraped_products_latest ON scraped_products(scraping_session_id DESC, timestamp DESC);

-- Enable Row Level Security (optional, but recommended)
ALTER TABLE scraped_products ENABLE ROW LEVEL SECURITY;

-- Create policy to allow service role to do everything
-- (This is safe because we use SERVICE_ROLE_KEY which bypasses RLS anyway)
CREATE POLICY "Service role can do everything"
  ON scraped_products
  FOR ALL
  USING (true)
  WITH CHECK (true);
```

### Columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key, auto-generated |
| `product_name` | TEXT | Name of the product as found on the website |
| `supermarket` | TEXT | Name of the supermarket (e.g., "Delhaize", "Colruyt") |
| `price` | TEXT | Price as displayed on the website (e.g., "€2.50") |
| `price_value` | NUMERIC(10,2) | Parsed numeric price value (nullable) |
| `target_product` | TEXT | The target product we were searching for |
| `link` | TEXT | URL to the product page |
| `timestamp` | TIMESTAMPTZ | When the product was scraped |
| `available` | BOOLEAN | Whether the product is currently available |
| `image_url` | TEXT | URL to product image (nullable) |
| `promo_tag` | TEXT | Promotional tag if any (nullable) |
| `scraping_session_id` | UUID | Unique ID for a scraping session (groups results together) |
| `created_at` | TIMESTAMPTZ | When the record was inserted into database |

### Usage

The application will:
1. Generate a unique `scraping_session_id` for each scraping run
2. Store all products from that session with the same `scraping_session_id`
3. When loading results, fetch the latest session's products
4. Optionally keep historical data for price tracking

## Setup Instructions

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Run the SQL schema above to create the table and indexes
4. Add the environment variables `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to your deployment environment

## Notes

- The service role key bypasses Row Level Security (RLS), so the RLS policies are optional
- Historical data is preserved, allowing for future price history tracking
- The `scraping_session_id` allows grouping results from the same scraping run
- Indexes are optimized for common queries (latest results, by product, by supermarket)


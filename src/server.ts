import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { ConfigLoader } from './config/loader';
import { ScraperFactory } from './scrapers';
import { Logger } from './utils/logger';
import { saveResults, loadResults, getLastUpdateTime } from './utils/storage';
import { ScrapedProduct, Config, Supermarket } from './types';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store active scraping status
let isScraping = false;
let currentResults: ScrapedProduct[] = [];

// Broadcast to all connected clients
function broadcast(data: any) {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      // WebSocket.OPEN
      client.send(JSON.stringify(data));
    }
  });
}

// Group and sort results by product
function processResults(results: ScrapedProduct[]): Record<string, ScrapedProduct[]> {
  const grouped: Record<string, ScrapedProduct[]> = {};

  for (const result of results) {
    const key = result.targetProduct || result.productName;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(result);
  }

  // Sort each product group by price (cheapest first)
  for (const productName in grouped) {
    grouped[productName].sort((a, b) => {
      const priceA = a.priceValue || Infinity;
      const priceB = b.priceValue || Infinity;
      return priceA - priceB;
    });
  }

  return grouped;
}

// API endpoint to start scraping
app.post('/api/scrape', async (req, res) => {
  if (isScraping) {
    return res.status(400).json({ error: 'Scraping already in progress' });
  }

  let config: Config;
  let supermarketsToScrape: Supermarket[];

  try {
    config = ConfigLoader.load();
    const enabledSupermarkets = config.supermarkets.filter((s) => s.enabled);

      const parseStoreList = (input: unknown): string[] => {
        if (!input) return [];
        if (Array.isArray(input)) {
          return input.flatMap((item) => parseStoreList(item));
        }
        if (typeof input === 'string') {
          return input
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }
        return [];
      };

      const requestedStores = [
        ...parseStoreList(req.body?.stores),
        ...parseStoreList(req.body?.store),
        ...parseStoreList(req.body?.storeNames),
        ...parseStoreList(req.body?.supermarkets),
        ...parseStoreList(req.query?.store as any),
        ...parseStoreList(req.query?.stores as any),
      ];

      supermarketsToScrape = enabledSupermarkets;
      if (requestedStores.length > 0) {
        const requestedLower = new Set(
          requestedStores.map((name) => name.toLowerCase())
        );
        supermarketsToScrape = enabledSupermarkets.filter((s) =>
          requestedLower.has(s.name.toLowerCase())
        );

        if (supermarketsToScrape.length === 0) {
          return res.status(400).json({
            error: `No enabled supermarkets matched the requested list: ${requestedStores.join(
              ', '
            )}`,
          });
        }
        Logger.info(
          `Filtering supermarkets to: ${supermarketsToScrape
            .map((s) => s.name)
            .join(', ')}`
        );
      }
  } catch (error) {
    Logger.error('Failed to prepare scraping job:', error);
    return res.status(500).json({
      error: 'Failed to load configuration or filter supermarkets',
    });
  }

  isScraping = true;
  currentResults = [];

  // Start scraping in background
  (async () => {
    try {
      Logger.info('Starting price comparison scraper...');
      broadcast({ type: 'status', status: 'started', message: 'Scraping started...' });

      Logger.info(`Found ${supermarketsToScrape.length} supermarket(s) to scrape`);
      Logger.info(`Found ${config.products.length} product(s) to search`);

      const allResults: ScrapedProduct[] = [];

      for (const supermarket of supermarketsToScrape) {
        try {
          Logger.info(`\n=== Processing ${supermarket.name} ===`);
          broadcast({
            type: 'status',
            status: 'processing',
            message: `Processing ${supermarket.name}...`,
            supermarket: supermarket.name,
          });

          const scraper = ScraperFactory.create(supermarket, config.scraping);
          
          // Use callback to broadcast results immediately when found
          const results = await scraper.scrapeProducts(
            config.products,
            (newResults, allSupermarketResults) => {
              // Update the global results array
              allResults.push(...newResults);
              currentResults = allResults;
              
              // Broadcast immediately with updated results
              broadcast({
                type: 'progress',
                supermarket: supermarket.name,
                count: newResults.length,
                totalCount: allResults.length,
                results: processResults(allResults),
                message: `Found ${newResults.length} result(s) for ${newResults[0]?.targetProduct || 'product'}`,
              });
              
              Logger.info(
                `Broadcasting ${newResults.length} new result(s) from ${supermarket.name} (total: ${allResults.length})`
              );
            }
          );
          
          // Also add any remaining results that might not have been caught by callback
          const newResults = results.filter(
            (r) => !allResults.some(
              (existing) =>
                existing.productName === r.productName &&
                existing.supermarket === r.supermarket &&
                existing.link === r.link
            )
          );
          
          if (newResults.length > 0) {
            allResults.push(...newResults);
            currentResults = allResults;
            broadcast({
              type: 'progress',
              supermarket: supermarket.name,
              count: newResults.length,
              totalCount: allResults.length,
              results: processResults(allResults),
            });
          }

          Logger.success(`Completed ${supermarket.name}: ${results.length} products found`);
        } catch (error) {
          Logger.error(`Failed to scrape ${supermarket.name}:`, error);
          broadcast({
            type: 'error',
            supermarket: supermarket.name,
            message: `Failed to scrape ${supermarket.name}`,
          });
        }
      }

      currentResults = allResults;
      const processed = processResults(allResults);

      // Save results to disk
      try {
        await saveResults(allResults);
      } catch (error) {
        Logger.error('Failed to save results to disk:', error);
      }

      broadcast({
        type: 'complete',
        status: 'completed',
        message: 'Scraping completed!',
        results: processed,
        totalCount: allResults.length,
      });

      Logger.success('\n✅ Scraping completed successfully!');
    } catch (error) {
      Logger.error('Fatal error:', error);
      broadcast({
        type: 'error',
        status: 'error',
        message: 'Scraping failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      isScraping = false;
    }
  })();

  res.json({ message: 'Scraping started', status: 'started' });
});

// API endpoint to get current results
app.get('/api/results', async (req, res) => {
  const lastUpdate = await getLastUpdateTime();
  res.json({
    isScraping,
    results: processResults(currentResults),
    totalCount: currentResults.length,
    lastUpdated: lastUpdate?.toISOString() || null,
  });
});

// API endpoint to get status
app.get('/api/status', (req, res) => {
  res.json({ isScraping });
});

// API endpoint to get all stores
app.get('/api/stores', (req, res) => {
  try {
    const config = ConfigLoader.load();
    res.json(config.supermarkets);
  } catch (error) {
    Logger.error('Failed to load stores:', error);
    res.status(500).json({ error: 'Failed to load stores' });
  }
});

const PORT = process.env.PORT || 3000;

// Load saved results on server start
(async () => {
  try {
    const savedResults = await loadResults();
    if (savedResults.length > 0) {
      currentResults = savedResults;
      Logger.info(`Restored ${savedResults.length} results from previous session`);
    }
  } catch (error) {
    Logger.error('Failed to load saved results:', error);
  }
})();

server.listen(PORT, () => {
  Logger.info(`Server running on http://localhost:${PORT}`);
  Logger.info('WebSocket server ready for real-time updates');
});



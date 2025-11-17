import { Browser, Page, chromium } from 'playwright';
import { Product, ScrapedProduct, ScrapingConfig, Supermarket } from '../types';
import { Logger } from '../utils/logger';
import { AntiBot } from '../utils/anti-bot';

export abstract class BaseScraper {
  protected browser: Browser | null = null;
  protected page: Page | null = null;
  protected config: ScrapingConfig;
  protected supermarket: Supermarket;

  constructor(supermarket: Supermarket, config: ScrapingConfig) {
    this.supermarket = supermarket;
    this.config = config;
  }

  /**
   * Initialize browser and page with enhanced anti-bot features
   */
  async initialize(): Promise<void> {
    try {
      Logger.info(`Initializing browser for ${this.supermarket.name}...`);
      
      // Base browser args with anti-detection tweaks
      const browserArgs = [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ];
      
      this.browser = await chromium.launch({
        headless: this.config.headless,
        args: browserArgs,
      });
      
      // Enhanced context with more realistic fingerprint
      const context = await this.browser.newContext({
        userAgent: this.config.userAgent,
        viewport: { width: 1920, height: 1080 },
        locale: 'nl-BE',
        timezoneId: 'Europe/Brussels',
        permissions: ['geolocation'],
        geolocation: { latitude: 50.8503, longitude: 4.3517 }, // Brussels
        colorScheme: 'light',
        // Remove automation indicators
        extraHTTPHeaders: {
          'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
          'DNT': '1',
        },
      });

      // Remove webdriver property
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });
        
      });

      this.page = await context.newPage();
      
      // Override navigator.plugins to look more human
      await this.page.addInitScript(() => {
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
        
      });

      Logger.success(`Browser initialized for ${this.supermarket.name}`);
    } catch (error) {
      Logger.error(`Failed to initialize browser for ${this.supermarket.name}:`, error);
      throw error;
    }
  }

  /**
   * Reset browser context (creates new context to avoid bot detection)
   * Useful for Colruyt after each search
   */
  protected async resetContext(): Promise<void> {
    if (!this.browser || !this.page) return;

    try {
      Logger.info(`Resetting browser context for ${this.supermarket.name}...`);
      const oldContext = this.page.context();
      
      // Create new context with same settings
      const newContext = await this.browser.newContext({
        userAgent: this.config.userAgent,
        viewport: { width: 1920, height: 1080 },
        locale: 'nl-BE',
        timezoneId: 'Europe/Brussels',
        permissions: ['geolocation'],
        geolocation: { latitude: 50.8503, longitude: 4.3517 },
        colorScheme: 'light',
        extraHTTPHeaders: {
          'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Cache-Control': 'max-age=0',
        },
      });

      // Remove webdriver property
      await newContext.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });
      });

      this.page = await newContext.newPage();
      
      // Override navigator.plugins
      await this.page.addInitScript(() => {
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
      });

      // Close old context
      await oldContext.close();
      
      Logger.info('Browser context reset successfully');
    } catch (error) {
      Logger.warn('Failed to reset context, continuing with current context:', error);
    }
  }

  /**
   * Close browser and cleanup
   */
  async cleanup(): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close();
        Logger.info(`Browser closed for ${this.supermarket.name}`);
      }
    } catch (error) {
      Logger.error(`Error during cleanup for ${this.supermarket.name}:`, error);
    }
  }

  /**
   * Navigate to URL with anti-bot measures
   */
  protected async navigateToUrl(url: string): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    try {
      Logger.info(`Navigating to ${url}...`);
      
      // Check supermarket type for optimizations
      const isColruyt = this.supermarket.name.toLowerCase().includes('colruyt');
      const isDelhaize = this.supermarket.name.toLowerCase().includes('delhaize');
      const isCarrefour = this.supermarket.name.toLowerCase().includes('carrefour');
      
      // For Colruyt, add smaller delay before navigation (optimized)
      if (isColruyt) {
        await AntiBot.longDelay(1500, 3000); // Reduced from 3000-6000ms
      }
      
      await this.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeout,
      });

      // Skip networkidle wait for faster loading (domcontentloaded is usually enough)
      const isBabylon = this.supermarket.name.toLowerCase().includes('babylon');
      const isPrikentik = this.supermarket.name.toLowerCase().includes('prik');
      
      if (isColruyt || isDelhaize || isBabylon || isPrikentik || isCarrefour) {
        // For optimized stores, use shorter wait instead of networkidle
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        await AntiBot.waitForPageLoad(this.page, this.config);
      }
      
      await AntiBot.handleCookieBanner(this.page);
      
      // Optimized human-like behavior
      if (isColruyt) {
        await AntiBot.simulateMouseMovement(this.page);
        await AntiBot.humanScroll(this.page);
        await AntiBot.longDelay(1000, 2000); // Reduced from 2000-4000ms, removed reading simulation
      } else if (isDelhaize || isCarrefour) {
        // Delhaize/Carrefour: minimal delays for speed
        await AntiBot.simulateMouseMovement(this.page);
        await AntiBot.humanScroll(this.page);
        await AntiBot.randomDelay(this.config);
      } else {
        await AntiBot.simulateMouseMovement(this.page);
        await AntiBot.humanScroll(this.page);
        await AntiBot.randomDelay(this.config);
      }

      Logger.success(`Page loaded: ${url}`);
    } catch (error) {
      Logger.error(`Failed to navigate to ${url}:`, error);
      throw error;
    }
  }

  /**
   * Extract price from text (abstract method, must be implemented by subclasses)
   */
  protected abstract extractPrice(priceText: string): number | null;

  /**
   * Check if text contains keyword or one of its synonyms
   */
  protected matchesKeyword(text: string, keyword: string): boolean {
    const lowerText = text.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();

    if (lowerText.includes(lowerKeyword)) {
      return true;
    }

    const normalize = (value: string): string =>
      value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\s\-.]/g, '')
        .trim();

    const normalizedText = normalize(text);
    const normalizedKeyword = normalize(keyword);

    if (
      normalizedKeyword.length > 0 &&
      normalizedText.includes(normalizedKeyword)
    ) {
      return true;
    }

    const keywordSynonyms: Record<string, string[]> = {
      bak: ['krat', 'crate', 'case'],
      krat: ['bak', 'crate', 'case'],
      fles: ['flesje', 'bottle'],
      flesje: ['fles', 'bottle'],
    };

    const synonyms = keywordSynonyms[lowerKeyword];
    if (synonyms) {
      return synonyms.some((syn) => {
        if (lowerText.includes(syn)) {
          return true;
        }
        const normalizedSynonym = normalize(syn);
        return (
          normalizedSynonym.length > 0 &&
          normalizedText.includes(normalizedSynonym)
        );
      });
    }

    return false;
  }

  /**
   * Filter product to ensure it matches the required criteria
   */
  protected filterProduct(
    productName: string,
    product: Product,
    additionalText?: string
  ): boolean {
    const nameLower = productName.toLowerCase();
    // Combine product name with additional text (quantity, size, etc.) for better filtering
    const fullText = additionalText
      ? `${nameLower} ${additionalText.toLowerCase()}`
      : nameLower;

    // Check required keywords - brand name must be present
    let hasRequiredKeyword = true;
    if (product.requiredKeywords && product.requiredKeywords.length > 0) {
      hasRequiredKeyword = product.requiredKeywords.some((keyword) =>
        this.matchesKeyword(fullText, keyword)
      );

      if (!hasRequiredKeyword) {
        Logger.warn(
          `Product "${productName}" rejected: missing required brand keyword (${product.requiredKeywords.join(', ')})`
        );
        return false;
      }
    }

    // Check mustContain keywords - ALL must be present (e.g. "bak")
    // Check in both product name and additional text (quantity/size)
    if (product.mustContain && product.mustContain.length > 0) {
      const hasAnyMustContain = product.mustContain.some((keyword) =>
        this.matchesKeyword(fullText, keyword)
      );

      if (!hasAnyMustContain) {
        Logger.warn(
          `Product "${productName}" rejected: missing any of the must-contain keywords (${product.mustContain.join(', ')}) in name or quantity`
        );
        return false;
      }
    }

    // Check for beer-related terms - must contain "bier" or "pils"
    const beerTerms = ['bier', 'pils', 'beer', 'ale', 'lager'];
    const hasBeerTerm = beerTerms.some((term) => this.matchesKeyword(fullText, term));

    if (!hasBeerTerm && !hasRequiredKeyword) {
      Logger.warn(
        `Product "${productName}" rejected: not a beer product (missing bier/pils)`
      );
      return false;
    }

    // Reject alcohol-free beers if configured
    if (this.config.excludeAlcoholFree) {
      const alcoholFreePatterns = [
        '0.0%',
        '0,0%',
        '0.0 %',
        '0,0 %',
        'alcoholvrij',
        'alcohol-free',
        'alcohol free',
        'alcohol vrij',
        'zonder alcohol',
        'non-alcoholic',
        'non alcoholic',
        'zero alcohol',
        '0% alcohol',
        '0 % alcohol',
        'blik'
      ];

      const hasAlcoholFreePattern = alcoholFreePatterns.some((pattern) =>
        fullText.includes(pattern.toLowerCase())
      );

      if (hasAlcoholFreePattern) {
        Logger.warn(
          `Product "${productName}" rejected: alcohol-free beer (0.0%)`
        );
        return false;
      }
    }

    // Reject common non-beer items
    const excludeTerms = [
      'glas',
      'beker',
      'koeler',
      'opener',
      'flesopener',
      'bierglas',
      'bierbeker',
      'bierkoeler',
      'bieropener',
      't-shirt',
      'shirt',
      'pet',
      'muts',
      'sleutelhanger',
      'poster',
      'kalender',
    ];

    const hasExcludeTerm = excludeTerms.some((term) => nameLower.includes(term));
    if (hasExcludeTerm) {
      Logger.warn(
        `Product "${productName}" rejected: contains exclude term`
      );
      return false;
    }

    // Log if preferred keywords are missing (but don't reject)
    if (product.preferredKeywords && product.preferredKeywords.length > 0) {
      const hasPreferredKeyword = product.preferredKeywords.some((keyword) =>
        this.matchesKeyword(fullText, keyword)
      );

      if (!hasPreferredKeyword) {
        Logger.info(
          `Product "${productName}" accepted but missing preferred keywords (${product.preferredKeywords.join(', ')})`
        );
      }
    }

    return true;
  }

  /**
   * Search for a product (abstract method, must be implemented by subclasses)
   */
  abstract searchProduct(product: Product): Promise<ScrapedProduct[]>;

  /**
   * Apply store-specific overrides to a product configuration
   */
  protected applyStoreOverrides(product: Product): Product {
    if (!product.storeOverrides) {
      return product;
    }

    const overridesMap = product.storeOverrides;
    const normalizedOverrides: Record<string, any> = {};

    for (const [key, value] of Object.entries(overridesMap)) {
      normalizedOverrides[key.toLowerCase()] = value;
    }

    const storeKey = this.supermarket.name.toLowerCase();
    const override = normalizedOverrides[storeKey];

    if (!override) {
      return product;
    }

    return {
      ...product,
      searchTerms: override.searchTerms ?? product.searchTerms,
      requiredKeywords: override.requiredKeywords ?? product.requiredKeywords,
      mustContain: override.mustContain ?? product.mustContain,
      preferredKeywords: override.preferredKeywords ?? product.preferredKeywords,
    };
  }

  /**
   * Scrape all products for this supermarket
   * @param products - Products to scrape
   * @param onProductFound - Optional callback called immediately when results for a product are found
   */
  async scrapeProducts(
    products: Product[],
    onProductFound?: (results: ScrapedProduct[], allResults: ScrapedProduct[]) => void
  ): Promise<ScrapedProduct[]> {
    const results: ScrapedProduct[] = [];

    if (!this.supermarket.enabled) {
      Logger.info(`${this.supermarket.name} is disabled, skipping...`);
      return results;
    }

    const isColruyt = this.supermarket.name.toLowerCase().includes('colruyt');

    try {
      await this.initialize();

      for (let i = 0; i < products.length; i++) {
        const originalProduct = products[i];
        const product = this.applyStoreOverrides(originalProduct);
        try {
          Logger.info(
            `Searching for "${product.name}" at ${this.supermarket.name} (${i + 1}/${products.length})...`
          );
          
          // For Colruyt: reset context after each search to avoid bot detection
          if (isColruyt && i > 0) {
            Logger.info('Resetting browser context to avoid bot detection...');
            await this.resetContext();
            // Longer delay after context reset
            await AntiBot.longDelay(5000, 10000);
          }
          
          const productResults = await this.searchProduct(product);
          results.push(...productResults);
          
          // Call callback immediately if provided, so results can be broadcast in real-time
          if (onProductFound && productResults.length > 0) {
            onProductFound(productResults, results);
          }
          
          // Longer delay between searches for Colruyt
          if (isColruyt) {
            await AntiBot.longDelay(8000, 15000);
          } else {
            await AntiBot.randomDelay(this.config);
          }
        } catch (error) {
          Logger.error(
            `Failed to scrape ${product.name} from ${this.supermarket.name}:`,
            error
          );
          
          // If Colruyt blocks us, reset context and wait longer
          if (isColruyt) {
            Logger.warn('Possible bot detection, resetting context and waiting...');
            await this.resetContext();
            await AntiBot.longDelay(10000, 20000);
          }
        }
      }
    } catch (error) {
      Logger.error(
        `Failed to scrape products from ${this.supermarket.name}:`,
        error
      );
    } finally {
      await this.cleanup();
    }

    return results;
  }
}


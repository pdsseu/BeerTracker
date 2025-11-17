import { Page } from 'playwright';
import { Product, ScrapedProduct, ScrapingConfig, Supermarket } from '../types';
import { BaseScraper } from './base-scraper';
import { Logger } from '../utils/logger';
import { AntiBot } from '../utils/anti-bot';

interface ColruytProductDetails {
  name: string;
  priceText: string;
  priceValue?: number;
  link: string;
  imageUrl?: string;
  quantityText: string;
  promoTag?: string;
}

export class ColruytScraper extends BaseScraper {
  private cachedProducts: ColruytProductDetails[] | null = null;

  protected extractPrice(priceText: string): number | null {
    // Remove currency symbols and spaces, replace comma with dot
    const cleaned = priceText
      .replace(/[€$£]/g, '')
      .replace(/\s/g, '')
      .replace(',', '.')
      .trim();

    const match = cleaned.match(/(\d+\.?\d*)/);
    if (match) {
      return parseFloat(match[1]);
    }
    return null;
  }

  /**
   * Load all beer products from Colruyt in one go
   * Uses a combined search with multiple brand parameters
   */
  private async loadAllProducts(products: Product[]): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    if (this.cachedProducts) {
      Logger.info(
        `Using cached Colruyt products (${this.cachedProducts.length} items)`
      );
      return;
    }

    const DEBUG = process.env.DEBUG === 'true';

    // Extract unique brand names from products
    // Map to Colruyt brand names (e.g., "Stella" -> "Stella Artois", "Cristal" -> "Cristal" or "Cristal Alken")
    const brandMap: Record<string, string[]> = {
      stella: ['Stella Artois'],
      jupiler: ['Jupiler'],
      maes: ['Maes'],
      cristal: ['Cristal', 'Cristal Alken'], // Try both variants
    };

    const brandNames = new Set<string>();
    products.forEach((product) => {
      if (product.requiredKeywords && product.requiredKeywords.length > 0) {
        product.requiredKeywords.forEach((keyword) => {
          const lowerKeyword = keyword.toLowerCase();
          const mappedBrands = brandMap[lowerKeyword] || [keyword];
          mappedBrands.forEach((brand) => brandNames.add(brand));
        });
      } else {
        // Fallback: use first word of product name
        const firstWord = product.name.split(' ')[0];
        const mappedBrands = brandMap[firstWord.toLowerCase()] || [firstWord];
        mappedBrands.forEach((brand) => brandNames.add(brand));
      }
    });

    const brands = Array.from(brandNames);
    Logger.info(
      `Loading all Colruyt products with brands: ${brands.join(', ')} (${brands.length} brands)`
    );

    // Build URL with multiple brand parameters
    // Format: ?brand=Maes&brand=Jupiler&brand=Stella+Artois&searchTerm=pils&...
    const urlParams = new URLSearchParams();
    brands.forEach((brand) => {
      urlParams.append('brand', brand);
    });
    urlParams.append('method', 'user typed');
    urlParams.append('o', 'product overview');
    urlParams.append('page', '1');
    urlParams.append('searchTerm', 'pils');
    urlParams.append('suggestion', 'none');
    urlParams.append('type', 'product');

    const searchUrl = `${this.supermarket.baseUrl}/nl/producten?${urlParams.toString()}`;
    Logger.info(`Navigating to Colruyt combined search: ${searchUrl}`);
    await this.navigateToUrl(searchUrl);

    if (DEBUG) {
      const { DebugHelper } = await import('../utils/debug');
      await DebugHelper.takeScreenshot(this.page, 'colruyt-all-beers');
      await DebugHelper.dumpHTML(this.page, 'colruyt-all-beers');
    }

    // Wait for page to be fully loaded (optimized - skip networkidle for speed)
    Logger.info('Waiting for page to load...');
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {
      Logger.warn('DOM content loaded timeout, continuing anyway...');
    });
    
    // Short wait instead of networkidle (faster, usually sufficient)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Wait for product container
    Logger.info('Waiting for product container...');
    let containerFound = false;
    const containerSelectors = [
      '#Assortmentoverview-Page-0',
      'a.card.card--article[data-tms-product-type="real"]',
      'a.card.card--article',
      '[data-tms-product-id]',
    ];

    for (const selector of containerSelectors) {
      try {
        await this.page.waitForSelector(selector, {
          timeout: 5000,
        });
        Logger.info(`Product container found with selector: ${selector}`);
        containerFound = true;
        break;
      } catch (e) {
        Logger.warn(`Selector ${selector} not found, trying next...`);
      }
    }

    if (!containerFound) {
      Logger.warn('No product container found with any selector, continuing anyway...');
    }

    // Wait for products to appear (optimized - shorter timeout)
    Logger.info('Waiting for products to appear...');
    try {
      await this.page.waitForFunction(
        () => {
          return (
            document.querySelectorAll('a.card.card--article').length > 0 ||
            document.querySelectorAll('[data-tms-product-id]').length > 0 ||
            document.querySelector('#Assortmentoverview-Page-0') !== null
          );
        },
        { timeout: 5000 } // Reduced from 10000ms
      );
      Logger.info('Content appears to be loaded');
    } catch (e) {
      Logger.warn('Content wait function timeout, continuing...');
    }
    
    // Short wait for dynamic content (reduced from 3000ms)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Scroll to trigger lazy loading (optimized - faster scrolling)
    Logger.info('Scrolling to trigger lazy loading...');
    await this.page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await new Promise((resolve) => setTimeout(resolve, 800)); // Reduced from 2000ms
    
    await this.page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise((resolve) => setTimeout(resolve, 800)); // Reduced from 2000ms
    
    await this.page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await new Promise((resolve) => setTimeout(resolve, 500)); // Reduced from 1500ms

    // Check for pagination and load additional pages
    // Colruyt might have multiple pages of results
    let hasMorePages = true;
    let currentPage = 1;
    const maxPages = 3; // Limit to 3 pages to avoid too many requests

    while (hasMorePages && currentPage < maxPages) {
      // Check if there's a next page button
      const nextPageExists = await this.page.evaluate(() => {
        const nextButton = document.querySelector('a[aria-label*="volgende"], a[aria-label*="next"], button[aria-label*="volgende"]');
        return nextButton !== null && !nextButton.hasAttribute('disabled');
      });

      if (nextPageExists) {
        currentPage++;
        Logger.info(`Loading page ${currentPage}...`);
        
        // Build URL for next page
        urlParams.set('page', currentPage.toString());
        const nextPageUrl = `${this.supermarket.baseUrl}/nl/producten?${urlParams.toString()}`;
        
        // Add delay before navigating to next page (optimized - reduced delay)
        await AntiBot.longDelay(1000, 2000); // Reduced from 2000-4000ms
        
        await this.navigateToUrl(nextPageUrl);
        
        // Wait for content (optimized)
        await this.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Reduced from 2000ms
        
        // Scroll to trigger lazy loading (optimized)
        await this.page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await new Promise((resolve) => setTimeout(resolve, 800)); // Reduced from 2000ms
      } else {
        hasMorePages = false;
      }
    }

    // Find all product elements across all loaded pages
    let productElements: any[] = [];
    
    // Strategy 1: Direct selector for real products
    Logger.info('Strategy 1: Looking for a.card.card--article[data-tms-product-type="real"]');
    try {
      productElements = await this.page.$$('a.card.card--article[data-tms-product-type="real"]');
      Logger.info(`Found ${productElements.length} products with Strategy 1`);
    } catch (e) {
      Logger.warn('Strategy 1 failed:', e);
    }

    // Strategy 2: Get all cards and filter
    if (!productElements || productElements.length === 0) {
      Logger.info('Strategy 2: Getting all a.card.card--article and filtering');
      try {
        const allCards = await this.page.$$('a.card.card--article');
        Logger.info(`Found ${allCards.length} total product cards`);

        for (const card of allCards) {
          try {
            const productType = await card.getAttribute('data-tms-product-type');
            const productId = await card.getAttribute('data-tms-product-id');

            if (productType === 'real') {
              productElements.push(card);
            } else if (productId && productId !== '0' && productId !== 'generic') {
              productElements.push(card);
            }
          } catch (e) {
            Logger.warn('Error checking card attributes:', e);
          }
        }

        Logger.info(`Filtered to ${productElements.length} real products with Strategy 2`);
      } catch (e) {
        Logger.warn('Strategy 2 failed:', e);
      }
    }

    // Strategy 3: Use any link with product ID
    if (!productElements || productElements.length === 0) {
      Logger.info('Strategy 3: Looking for any a[data-tms-product-id]');
      try {
        const allWithId = await this.page.$$('a[data-tms-product-id]');
        Logger.info(`Found ${allWithId.length} links with product ID`);

        for (const link of allWithId) {
          try {
            const productId = await link.getAttribute('data-tms-product-id');
            const productType = await link.getAttribute('data-tms-product-type');

            if (productType !== 'generic' && productId && productId !== '0') {
              productElements.push(link);
            }
          } catch (e) {
            // Skip
          }
        }

        Logger.info(`Found ${productElements.length} products with Strategy 3`);
      } catch (e) {
        Logger.warn('Strategy 3 failed:', e);
      }
    }

    if (!productElements || productElements.length === 0) {
      Logger.warn('No products found on Colruyt search page');
      this.cachedProducts = [];
      return;
    }

    Logger.info(`Found ${productElements.length} total products on Colruyt`);

    const allProducts: ColruytProductDetails[] = [];

    // Extract all products
    for (let i = 0; i < productElements.length; i++) {
      try {
        const element = productElements[i];
        const productDetails = await this.extractProductDetails(element);
        if (productDetails) {
          allProducts.push(productDetails);
        }
      } catch (error) {
        Logger.warn(`Error extracting product ${i + 1}:`, error);
      }
    }

    Logger.success(`Cached ${allProducts.length} Colruyt products`);
    this.cachedProducts = allProducts;
  }

  /**
   * Extract product details from a product element
   */
  private async extractProductDetails(
    element: any
  ): Promise<ColruytProductDetails | null> {
    if (!element) {
      return null;
    }

    // Extract product name
    let productName = '';

    // Method 1: Try data attributes first (most reliable)
    try {
      const brand = await element.getAttribute('data-tms-product-brand');
      const name = await element.getAttribute('data-tms-product-name');
      if (brand && name) {
        productName = `${brand} ${name}`.trim();
      } else if (name) {
        productName = name.trim();
      } else if (brand) {
        productName = brand.trim();
      }
    } catch (e) {
      // Continue to fallback
    }

    // Method 2: Try longname attribute
    if (!productName || productName.length < 3) {
      try {
        const longname = await element.getAttribute('longname');
        if (longname && longname.length > 3) {
          productName = longname.trim();
        }
      } catch (e) {
        // Continue
      }
    }

    // Method 3: Try p.card__text
    if (!productName || productName.length < 3) {
      try {
        const nameElement = await element.$('p.card__text');
        if (nameElement) {
          const text = (await nameElement.textContent())?.trim() || '';
          if (text && text.length > 3) {
            productName = text;
          }
        }
      } catch (e) {
        // Continue
      }
    }

    if (!productName || productName.length < 3) {
      return null;
    }

    // Extract price
    let priceText = '';
    let priceValue: number | null = null;

    // Method 1: Try data attribute first
    try {
      const priceAttr = await element.getAttribute('data-tms-product-price');
      if (priceAttr) {
        const priceNum = parseFloat(priceAttr);
        if (!isNaN(priceNum) && priceNum > 0) {
          priceValue = priceNum;
          priceText = `€${priceNum.toFixed(2).replace('.', ',')}`;
        }
      }
    } catch (e) {
      // Continue to DOM method
    }

    // Method 2: Extract from DOM structure
    if (!priceText || !priceValue) {
      try {
        const priceContainer = await element.$('.price-info__price-label');
        if (priceContainer) {
          const wholeNumber = await priceContainer.$('.rounded-number');
          const decimal = await priceContainer.$('.decimal');

          const whole = wholeNumber ? (await wholeNumber.textContent())?.trim() || '' : '';
          const dec = decimal ? (await decimal.textContent())?.trim() || '' : '';

          if (whole) {
            const priceStr = dec ? `${whole}.${dec}` : whole;
            const priceNum = parseFloat(priceStr);
            if (!isNaN(priceNum) && priceNum > 0) {
              priceValue = priceNum;
              priceText = dec ? `€${whole},${dec}` : `€${whole}`;
            }
          } else {
            const allText = await priceContainer.textContent();
            if (allText) {
              const cleaned = allText.trim().replace(/\s+/g, '').replace(',', '.');
              const priceNum = parseFloat(cleaned);
              if (!isNaN(priceNum) && priceNum > 0) {
                priceValue = priceNum;
                priceText = allText.trim().replace(/\s+/g, '');
              }
            }
          }
        }
      } catch (e) {
        // Continue to fallback
      }
    }

    // Method 3: Fallback
    if (!priceText || !priceValue) {
      try {
        const unitPriceElement = await element.$('.price-info__unit-price');
        if (unitPriceElement) {
          const priceContainer = await element.$('.price-info__price');
          if (priceContainer) {
            const priceLabel = await priceContainer.$('.price-info__price-label');
            if (priceLabel) {
              const allText = await priceLabel.textContent();
              if (allText) {
                const cleaned = allText.trim().replace(/\s+/g, '').replace(',', '.');
                const priceNum = parseFloat(cleaned);
                if (!isNaN(priceNum) && priceNum > 0) {
                  priceValue = priceNum;
                  priceText = allText.trim().replace(/\s+/g, '');
                }
              }
            }
          }
        }
      } catch (e) {
        // Continue
      }
    }

    if (!priceText) {
      return null;
    }

    // Extract link
    let productLink = '';
    try {
      const href = await element.getAttribute('href');
      if (href && href !== '#' && href !== '') {
        productLink = href.startsWith('http')
          ? href
          : `${this.supermarket.baseUrl}${href}`;
      }
    } catch (e) {
      // Continue
    }

    // Extract image
    let imageUrl: string | undefined = undefined;
    try {
      const imageElement = await element.$('.card__image img, img');
      if (imageElement) {
        const src = await imageElement.getAttribute('src');
        if (src && src !== '') {
          imageUrl = src;
        }
      }
    } catch (e) {
      // Continue
    }

    // Extract quantity/size info
    let quantityText = '';
    try {
      const quantityElement = await element.$('.card__quantity, p.card__quantity');
      if (quantityElement) {
        quantityText = (await quantityElement.textContent()) || '';
      }
    } catch (e) {
      // Continue
    }

    // Extract promo info
    let promoTag: string | undefined;

    // Strategy 1: data attribute
    try {
      const promoAttr = await element.getAttribute('data-tms-product-promotion');
      if (promoAttr) {
        const parts = promoAttr
          .split('|')
          .map((part: string) => part.trim())
          .filter(Boolean);
        if (parts.length > 0) {
          promoTag = parts.join(' • ');
        }
      }
    } catch (e) {
      // Continue
    }

    // Strategy 2: DOM labels
    if (!promoTag) {
      const promoSelectors = [
        '.card__label--promo',
        '.promo-counter-label',
        '.promos__description',
        '.promos__description strong',
        '.promos__link',
      ];

      for (const selector of promoSelectors) {
        try {
          const promoElement = await element.$(selector);
          if (promoElement) {
            const text = (await promoElement.textContent())?.trim();
            if (text) {
              if (promoTag) {
                promoTag = `${promoTag} • ${text}`;
              } else {
                promoTag = text;
              }
            }
          }
        } catch (e) {
          continue;
        }
      }
    }

    if (!promoTag) {
      try {
        const hasPromo = await element.getAttribute('data-has-promo');
        if (hasPromo === 'true') {
          promoTag = 'Promo';
        }
      } catch (e) {
        // Continue
      }
    }

    return {
      name: productName.trim(),
      priceText: priceText.trim(),
      priceValue: priceValue || this.extractPrice(priceText) || undefined,
      link: productLink,
      imageUrl,
      quantityText: quantityText.trim(),
      promoTag,
    };
  }

  /**
   * Override scrapeProducts to load all products at once for Colruyt
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

    try {
      await this.initialize();

      // Load all products in one go (only one navigation, no context resets between products)
      await this.loadAllProducts(products);

      if (!this.cachedProducts || this.cachedProducts.length === 0) {
        Logger.warn('No cached Colruyt products available');
        return results;
      }

      // Filter cached products for each target product
      for (const originalProduct of products) {
        const product = this.applyStoreOverrides(originalProduct);
        const productResults: ScrapedProduct[] = [];

        for (const item of this.cachedProducts) {
          if (
            !this.filterProduct(item.name, product, item.quantityText)
          ) {
            continue;
          }

          productResults.push({
            productName: item.name,
            supermarket: this.supermarket.name,
            price: item.priceText,
            priceValue: item.priceValue,
            targetProduct: product.name,
            link: item.link,
            timestamp: new Date(),
            available: true,
            imageUrl: item.imageUrl,
            promoTag: item.promoTag,
          });
        }

        if (productResults.length > 0) {
          results.push(...productResults);

          // Call callback immediately if provided
          if (onProductFound) {
            onProductFound(productResults, results);
          }

          Logger.success(
            `Found ${productResults.length} Colruyt matches for "${product.name}"`
          );
        } else {
          Logger.warn(
            `No matching Colruyt products found for "${product.name}" (${this.cachedProducts.length} products scanned)`
          );
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

  /**
   * Legacy method - kept for compatibility but now uses cached products
   */
  async searchProduct(product: Product): Promise<ScrapedProduct[]> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    const results: ScrapedProduct[] = [];

    try {
      // Load all products if not already cached
      if (!this.cachedProducts) {
        await this.loadAllProducts([product]);
      }

      if (!this.cachedProducts || this.cachedProducts.length === 0) {
        Logger.warn(
          `No cached Colruyt products available for "${product.name}"`
        );
        return results;
      }

      // Filter cached products for this specific product
      for (const item of this.cachedProducts) {
        if (!this.filterProduct(item.name, product, item.quantityText)) {
          continue;
        }

        results.push({
          productName: item.name,
          supermarket: this.supermarket.name,
          price: item.priceText,
          priceValue: item.priceValue,
          targetProduct: product.name,
          link: item.link,
          timestamp: new Date(),
          available: true,
          imageUrl: item.imageUrl,
          promoTag: item.promoTag,
        });
      }

      if (results.length === 0) {
        Logger.warn(
          `No matching Colruyt products found for "${product.name}" (${this.cachedProducts.length} products scanned)`
        );
      } else {
        Logger.success(
          `Found ${results.length} Colruyt matches for "${product.name}"`
        );
      }
    } catch (error) {
      Logger.error(
        `Error searching for product "${product.name}" at Colruyt:`,
        error
      );
    }

    return results;
  }
}

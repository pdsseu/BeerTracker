import { Page } from 'playwright';
import { Product, ScrapedProduct, ScrapingConfig, Supermarket } from '../types';
import { BaseScraper } from './base-scraper';
import { Logger } from '../utils/logger';
import { AntiBot } from '../utils/anti-bot';

interface DelhaizeProductDetails {
  name: string;
  priceText: string;
  priceValue?: number;
  link: string;
  imageUrl?: string;
  quantityText: string;
  promoTag?: string;
}

export class DelhaizeScraper extends BaseScraper {
  private cachedProducts: DelhaizeProductDetails[] | null = null;

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
   * Load all beer products from Delhaize in one go
   * Uses a combined search for multiple beer brands
   */
  private async loadAllProducts(products: Product[]): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    if (this.cachedProducts) {
      Logger.info(
        `Using cached Delhaize products (${this.cachedProducts.length} items)`
      );
      return;
    }

    const DEBUG = process.env.DEBUG === 'true';

    // Create a combined search query with all brand names
    // Extract unique brand names from products
    const brandNames = new Set<string>();
    products.forEach((product) => {
      if (product.requiredKeywords && product.requiredKeywords.length > 0) {
        product.requiredKeywords.forEach((keyword) => {
          brandNames.add(keyword.toLowerCase());
        });
      } else {
        // Fallback: use first word of product name
        const firstWord = product.name.split(' ')[0].toLowerCase();
        brandNames.add(firstWord);
      }
    });

    // Create search query: combine brand names with OR logic
    // Delhaize supports searching for multiple terms
    const searchTerms = Array.from(brandNames).slice(0, 5); // Limit to 5 brands to avoid URL too long
    const searchQuery = searchTerms.join(' OR ');

    Logger.info(
      `Loading all Delhaize products with search: ${searchQuery} (${searchTerms.length} brands)`
    );

    // Navigate to search page with combined query
    const searchUrl = `${this.supermarket.baseUrl}/shop/search?q=${encodeURIComponent(searchQuery)}:relevance&text=${encodeURIComponent(searchQuery)}&sort=relevance`;
    await this.navigateToUrl(searchUrl);

    if (DEBUG) {
      const { DebugHelper } = await import('../utils/debug');
      await DebugHelper.takeScreenshot(this.page, 'delhaize-all-beers');
      await DebugHelper.dumpHTML(this.page, 'delhaize-all-beers');
    }

    // Wait for search results (optimized - shorter timeout)
    await this.page
      .waitForSelector('[data-testid="product-block"]', {
        timeout: 8000, // Reduced from 15000ms
      })
      .catch(() => {
        Logger.warn('Product blocks not found, page might still be loading...');
      });

    // Additional wait for dynamic content (optimized - reduced delay)
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Reduced from 3000ms

    // Scroll to load more products (lazy loading) - optimized faster scrolling
    await this.page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await new Promise((resolve) => setTimeout(resolve, 800)); // Reduced from 2000ms
    await this.page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise((resolve) => setTimeout(resolve, 800)); // Reduced from 2000ms

    // Find all product blocks
    const productElements = await this.page.$$('[data-testid="product-block"]');

    if (!productElements || productElements.length === 0) {
      Logger.warn('No products found on Delhaize search page');
      this.cachedProducts = [];
      return;
    }

    Logger.info(`Found ${productElements.length} total products on Delhaize`);

    const allProducts: DelhaizeProductDetails[] = [];

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

    Logger.success(`Cached ${allProducts.length} Delhaize products`);
    this.cachedProducts = allProducts;
  }

  /**
   * Extract product details from a product element
   */
  private async extractProductDetails(
    element: any
  ): Promise<DelhaizeProductDetails | null> {
    if (!element) {
      return null;
    }

    // Extract product name
    let productName = '';
    const nameSelectors = [
      'a[data-testid="product-block-name-link"]',
      'h3[data-testid="styled-title"]',
      '[data-testid="product-block-product-name"]',
    ];

    for (const selector of nameSelectors) {
      try {
        const nameElement = await element.$(selector);
        if (nameElement) {
          productName = (await nameElement.textContent()) || '';
          if (productName.trim()) break;
        }
      } catch (e) {
        continue;
      }
    }

    // If we have separate brand and name spans, combine them
    if (!productName || productName.length < 3) {
      try {
        const brandElement = await element.$('span[data-testid="product-brand"]');
        const nameElement = await element.$('span[data-testid="product-name"]');
        const brand = brandElement
          ? (await brandElement.textContent())?.trim() || ''
          : '';
        const name = nameElement
          ? (await nameElement.textContent())?.trim() || ''
          : '';
        if (brand || name) {
          productName = `${brand} ${name}`.trim();
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
    const priceContainer = await element.$('[data-testid="product-block-price"]');

    if (priceContainer) {
      // Try to get price from aria-label first
      try {
        const ariaLabel = await priceContainer.getAttribute('aria-label');
        if (ariaLabel) {
          const match = ariaLabel.match(/(\d+)\s*euro\s*(\d+)?\s*cent/);
          if (match) {
            priceText = match[2] ? `€${match[1]},${match[2]}` : `€${match[1]}`;
          }
        }
      } catch (e) {
        // Continue
      }

      // If aria-label didn't work, try text content
      if (!priceText) {
        try {
          const allText = await priceContainer.textContent();
          if (allText) {
            priceText = allText.trim().replace(/\s+/g, '');
          }
        } catch (e) {
          // Continue
        }
      }

      // Fallback
      if (!priceText) {
        try {
          const textContent = await priceContainer.textContent();
          if (textContent) {
            priceText = textContent
              .trim()
              .replace(/\s+/g, ' ')
              .replace(/\s*€\s*/g, '€');
          }
        } catch (e) {
          // Continue
        }
      }
    }

    if (!priceText) {
      return null;
    }

    // Extract link
    let productLink = '';
    const linkSelectors = [
      'a[data-testid="product-block-name-link"]',
      'a[data-testid="product-block-image-link"]',
    ];

    for (const selector of linkSelectors) {
      try {
        const linkElement = await element.$(selector);
        if (linkElement) {
          const href = await linkElement.getAttribute('href');
          if (href) {
            productLink = href.startsWith('http')
              ? href
              : `${this.supermarket.baseUrl}${href}`;
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    // Extract image
    const imageElement = await element.$('img[data-testid="product-block-image"]');
    const imageUrl = imageElement
      ? (await imageElement.getAttribute('src')) || undefined
      : undefined;

    // Extract quantity/size info
    let quantityText = '';
    try {
      const quantityElement = await element.$(
        '[data-testid="product-block-attributes"]'
      );
      if (quantityElement) {
        quantityText = (await quantityElement.textContent()) || '';
      }
    } catch (e) {
      // Continue
    }

    // Extract promo tag info
    let promoTag: string | undefined;
    const promoSelectors = [
      '[data-testid="tag-label"]',
      '[data-testid="tag"] [data-testid="tag-label"]',
      '[data-testid="badge"]',
      '.sc-1it9fxy-3', // fallback class from sample
    ];

    for (const selector of promoSelectors) {
      try {
        const promoElement = await element.$(selector);
        if (promoElement) {
          const text = (await promoElement.textContent())?.trim();
          if (text) {
            promoTag = text;
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    return {
      name: productName.trim(),
      priceText: priceText.trim(),
      priceValue: this.extractPrice(priceText) || undefined,
      link: productLink,
      imageUrl,
      quantityText: quantityText.trim(),
      promoTag,
    };
  }

  /**
   * Override scrapeProducts to load all products at once for Delhaize
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

      // Load all products in one go
      await this.loadAllProducts(products);

      if (!this.cachedProducts || this.cachedProducts.length === 0) {
        Logger.warn('No cached Delhaize products available');
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
            `Found ${productResults.length} Delhaize matches for "${product.name}"`
          );
        } else {
          Logger.warn(
            `No matching Delhaize products found for "${product.name}" (${this.cachedProducts.length} products scanned)`
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
          `No cached Delhaize products available for "${product.name}"`
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
          `No matching Delhaize products found for "${product.name}" (${this.cachedProducts.length} products scanned)`
        );
      } else {
        Logger.success(
          `Found ${results.length} Delhaize matches for "${product.name}"`
        );
      }
    } catch (error) {
      Logger.error(
        `Error searching for product "${product.name}" at Delhaize:`,
        error
      );
    }

    return results;
  }
}


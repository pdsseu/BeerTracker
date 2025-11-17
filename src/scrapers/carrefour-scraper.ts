import { Page } from 'playwright';
import { Product, ScrapedProduct, ScrapingConfig, Supermarket } from '../types';
import { BaseScraper } from './base-scraper';
import { Logger } from '../utils/logger';
import { AntiBot } from '../utils/anti-bot';

interface CarrefourProductDetails {
  name: string;
  priceText: string;
  priceValue?: number;
  link: string;
  imageUrl?: string;
  quantityText: string;
  promoTag?: string;
}

export class CarrefourScraper extends BaseScraper {
  private cachedProducts: CarrefourProductDetails[] | null = null;

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
   * Get the search URL for Carrefour with all brands (for initial page load)
   */
  private getSearchUrl(page: number = 1): string {
    // Extract brand names from products and build URL
    // URL format: /nl/search?cgid=products&q=pils&pmin=0%2c01&prefn1=brandLocalized&prefv1=Cristal%7cJupiler%7cMaes%7cStella%20Artois
    const baseUrl = `${this.supermarket.baseUrl}/nl/search`;
    const params = new URLSearchParams();
    params.append('cgid', 'products');
    params.append('q', 'pils');
    params.append('pmin', '0,01');
    params.append('prefn1', 'brandLocalized');
    
    // Brand values should be pipe-separated (URL encoded as %7c)
    const brands = ['Cristal', 'Jupiler', 'Maes', 'Stella Artois'];
    params.append('prefv1', brands.join('|'));
    
    // Only add page parameter if page > 1
    if (page > 1) {
      params.append('p', page.toString());
    }

    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * Get the AJAX endpoint URL for Carrefour Search-UpdateGrid
   */
  private getAjaxEndpointUrl(start: number = 0, pageSize: number = 36): string {
    const baseUrl = `${this.supermarket.baseUrl}/on/demandware.store/Sites-carrefour-be-Site/default/Search-UpdateGrid`;
    const params = new URLSearchParams();
    params.append('cgid', 'products');
    params.append('q', 'pils');
    params.append('pmin', '0,01');
    params.append('prefn1', 'brandLocalized');
    
    // Brand values should be pipe-separated
    const brands = ['Cristal', 'Jupiler', 'Maes', 'Stella Artois'];
    params.append('prefv1', brands.join('|'));
    params.append('srule', 'Relevantie');
    params.append('start', start.toString());
    params.append('sz', pageSize.toString());

    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * Fetch products from AJAX endpoint using Playwright's request API (includes cookies automatically)
   */
  private async fetchProductsFromAjax(start: number, pageSize: number = 36): Promise<string> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    const url = this.getAjaxEndpointUrl(start, pageSize);
    Logger.info(`Fetching products from AJAX endpoint: start=${start}, size=${pageSize}`);
    Logger.info(`Full URL: ${url}`);

    try {
      // Use Playwright's request API which automatically includes cookies from the page context
      const context = this.page.context();
      const response = await context.request.get(url, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': this.page.url(),
          'User-Agent': this.config.userAgent,
        },
      });

      const status = response.status();
      const contentType = response.headers()['content-type'] || '';

      if (status !== 200) {
        Logger.error(`Failed to fetch AJAX endpoint: HTTP ${status}`);
        Logger.error(`Content-Type: ${contentType}`);
        const responseText = await response.text().catch(() => '');
        Logger.error(`Response preview: ${responseText.substring(0, 200)}`);
        return '';
      }

      const html = await response.text();
      Logger.info(`Successfully fetched HTML fragment: ${html.length} characters, status: ${status}`);
      
      // Debug: log first 500 characters of HTML to see what we got
      if (html && html.length > 0) {
        Logger.info(`HTML fragment preview: ${html.substring(0, 500)}...`);
      } else {
        Logger.warn('HTML fragment is empty!');
      }

      return html;
    } catch (error: any) {
      Logger.error(`Error fetching AJAX endpoint: ${error?.message || String(error)}`);
      return '';
    }
  }

  /**
   * Load all beer products from Carrefour
   * Scrapes the first page, then clicks "toon meer" button to load more products
   */
  private async loadAllProducts(products: Product[]): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    if (this.cachedProducts) {
      Logger.info(
        `Using cached Carrefour products (${this.cachedProducts.length} items)`
      );
      return;
    }

    const DEBUG = process.env.DEBUG === 'true';
    const allProducts: CarrefourProductDetails[] = [];

    // Navigate to the search page
    const searchUrl = this.getSearchUrl(1);
    Logger.info(`Loading Carrefour search page: ${searchUrl}`);
    await this.navigateToUrl(searchUrl);

    if (DEBUG) {
      const { DebugHelper } = await import('../utils/debug');
      await DebugHelper.takeScreenshot(this.page, 'carrefour-page-1');
      await DebugHelper.dumpHTML(this.page, 'carrefour-page-1');
    }

    // Wait for products to load (optimized)
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    
    // Quick check for products (early exit if found)
    const hasProducts = await this.page.evaluate(() => {
      return document.querySelectorAll('.product.js-product[data-pid], .product.js-product').length > 0;
    });
    
    if (hasProducts) {
      Logger.info('Products detected on page 1, extracting...');
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Short wait for dynamic content
    } else {
      // Wait a bit more if products not immediately visible
      await this.page.waitForSelector('.product.js-product', { timeout: 5000, state: 'attached' }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Find all product elements on the page
    // Note: Carrefour products are in .product.js-product elements with data-pid attribute
    const productSelectors = [
      '.product.js-product[data-pid]',
      '.product.js-product',
      '.product[data-pid]',
      '[data-pid].product',
      '.product-tile.js-product-tile',
      '.product',
      '.product-tile',
    ];

    let productElements: any[] = [];
    
    for (const selector of productSelectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 5000 }).catch(() => {});
        const elements = await this.page.$$(selector);
        if (elements.length > 0) {
          Logger.info(`Found ${elements.length} products using selector: ${selector}`);
          productElements = elements;
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    if (productElements.length === 0) {
      Logger.warn('No products found on Carrefour page');
      this.cachedProducts = [];
      return;
    }

    // Extract products from the page
    for (const element of productElements) {
      try {
        const productDetails = await this.extractProductDetails(element);
        if (productDetails) {
          allProducts.push(productDetails);
        }
      } catch (error) {
        Logger.warn('Error extracting Carrefour product details:', error);
      }
    }

    Logger.info(`Extracted ${allProducts.length} products from page 1`);

    // Now navigate to additional pages directly via URL
    // The "toon meer" button changes the URL to include &p=2, &p=3, etc.
    // IMPORTANT: Reset context between pages to avoid Cloudflare blocking
    let currentPage = 2;
    const maxPages = 5; // Safety limit

    while (currentPage <= maxPages) {
      try {
        // Reset context before navigating to avoid Cloudflare detection
        Logger.info(`Resetting context before navigating to page ${currentPage}...`);
        await this.resetContext();
        
        // Reduced wait after context reset (still enough to avoid detection)
        await new Promise((resolve) => setTimeout(resolve, 3000));
        
        const pageUrl = this.getSearchUrl(currentPage);
        Logger.info(`Navigating to page ${currentPage}: ${pageUrl}`);
        
        // Set up response listener to wait for AJAX requests that load products
        const responsePromise = this.page!.waitForResponse(
          (response) => {
            const url = response.url();
            return (
              url.includes('carrefour.be') &&
              (url.includes('Search-UpdateGrid') || url.includes('/search') || url.includes('/producten')) &&
              response.status() === 200
            );
          },
          { timeout: 10000 }
        ).catch(() => null);

        await this.navigateToUrl(pageUrl);
        
        // Wait for AJAX response that loads products
        const response = await responsePromise;
        if (response) {
          Logger.info(`Received AJAX response on page ${currentPage}`);
          // Reduced wait time
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        
        // Wait for page to load (reduced timeouts)
        await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        
        // Reduced delay
        await new Promise((resolve) => setTimeout(resolve, 1500));
        
        // Quick check for Cloudflare blocking and empty pages (early exit)
        const quickCheck = await this.page.evaluate(() => {
          const title = document.title?.toLowerCase() || '';
          const bodyText = document.body?.innerText?.substring(0, 200)?.toLowerCase() || '';
          const productCount = document.querySelectorAll('.product.js-product[data-pid], .product.js-product').length;
          const productGrid = document.querySelector('.product-grid');
          const hasProductGrid = !!productGrid && (productGrid.innerHTML.length > 100);
          
          return {
            isBlocked: title.includes('cloudflare') || bodyText.includes('sorry, you have been blocked') || bodyText.includes('attention required'),
            productCount,
            hasProductGrid,
            title,
          };
        });
        
        // Early exit if blocked
        if (quickCheck.isBlocked) {
          Logger.error(`Cloudflare blocking detected on page ${currentPage}. Stopping pagination.`);
          break;
        }
        
        // Early exit if no products found after initial load
        if (quickCheck.productCount === 0 && !quickCheck.hasProductGrid) {
          Logger.info(`No products found on page ${currentPage} after initial load. Stopping pagination.`);
          break;
        }
        
        // If we have products or product grid, wait a bit more and extract
        if (quickCheck.productCount > 0 || quickCheck.hasProductGrid) {
          Logger.info(`Found ${quickCheck.productCount} products on page ${currentPage}, extracting...`);
          // Short wait for any remaining dynamic content
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
          // Wait a bit more to see if products load (but shorter than before)
          let productsFound = false;
          for (let waitAttempt = 0; waitAttempt < 3; waitAttempt++) {
            const productCount = await this.page.evaluate(() => {
              return document.querySelectorAll('.product.js-product[data-pid], .product.js-product').length;
            });
            
            if (productCount > 0) {
              productsFound = true;
              Logger.info(`Found ${productCount} product elements on page ${currentPage} (attempt ${waitAttempt + 1})`);
              break;
            }
            
            if (waitAttempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
          
          if (!productsFound) {
            Logger.info(`No products found on page ${currentPage} after waiting. Stopping pagination.`);
            break;
          }
        }

        // Quick scroll to trigger lazy loading (if needed)
        await this.page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        
        // Extract products directly via evaluate (most reliable method)
        Logger.info(`Extracting products directly via evaluate on page ${currentPage}...`);
        
        // Single extraction attempt (we already checked for products)
        const extractedProducts = await this.page.evaluate(() => {
          // Try multiple selectors to find products
          const selectors = [
            '.product.js-product[data-pid]',
            '.product.js-product',
            '.product[data-pid]',
            '[data-pid].product',
          ];
          
          let products: any[] = [];
          for (const selector of selectors) {
            const found = Array.from(document.querySelectorAll(selector));
            if (found.length > 0) {
              products = found;
              break;
            }
          }
          
          const decodePromoAttr = (attr: string): string | null => {
            if (!attr) return null;
            const normalized = attr.replace(/&quot;/g, '"');
            try {
              const parsed = JSON.parse(normalized);
              return (
                parsed?.promotion_name ||
                parsed?.ecommerce?.promotion_name ||
                null
              );
            } catch (e) {
              return null;
            }
          };

          return products.map((product: any) => {
            const nameEl = product.querySelector('.name-wrapper .desktop-name, .name-wrapper .mobile-name, .name-wrapper .link');
            const priceEl = product.querySelector('.pricing-wrapper .price .sales .value span, .pricing-wrapper .price .sales span');
            const linkEl = product.querySelector('.name-wrapper .pdp-link .link, .name-wrapper .link');
            const imageEl = product.querySelector('.tile-image');
            const brandEl = product.querySelector('.brand-wrapper a');
            const packageEl = product.querySelector('.package-info-wrapper .package-info');
            const pricePerUnitEl = product.querySelector('.price-per-unit-wrapper');
            const promoTextEl = product.querySelector('.promo-tag-text, .promo-label, .promo');
            const promoValidityEl = product.querySelector('.promo-validity-date');
            const promoLinkEl = product.querySelector('.promo-cta-link');

            const name = nameEl?.textContent?.trim() || '';
            const brand = brandEl?.textContent?.trim() || '';
            const price = priceEl?.textContent?.trim() || '';
            const link = linkEl?.getAttribute('href') || '';
            const image = imageEl?.getAttribute('src') || imageEl?.getAttribute('data-src') || '';
            const packageInfo = packageEl?.textContent?.trim() || '';
            const pricePerUnit = pricePerUnitEl?.textContent?.trim() || '';
            const promoAttr = product.getAttribute('data-select-promotion-event-object');

            let promoTag = promoTextEl?.textContent?.trim() || '';
            if (!promoTag && promoValidityEl?.textContent?.trim()) {
              promoTag = promoValidityEl.textContent.trim();
            }
            if (!promoTag && promoLinkEl?.textContent?.trim()) {
              promoTag = promoLinkEl.textContent.trim();
            }
            if (!promoTag && promoAttr) {
              const promoFromAttr = decodePromoAttr(promoAttr);
              if (promoFromAttr) {
                promoTag = promoFromAttr;
              }
            }

            if (name && price) {
              const fullName = brand && !name.toLowerCase().includes(brand.toLowerCase()) 
                ? `${brand} ${name}` 
                : name;

              return {
                name: fullName,
                priceText: price,
                link: link.startsWith('http') ? link : (link ? `https://www.carrefour.be${link}` : ''),
                imageUrl: image || undefined,
                quantityText: packageInfo ? (pricePerUnit ? `${packageInfo} (${pricePerUnit})` : packageInfo) : pricePerUnit,
                promoTag: promoTag || undefined,
              };
            }
            return null;
          }).filter(p => p !== null);
        });
          
        Logger.info(`Extracted ${extractedProducts.length} products from page ${currentPage}`);
        
        // Convert to CarrefourProductDetails format
        const pageProductsBefore = allProducts.length;
        for (const product of extractedProducts) {
          const priceValue = this.extractPrice(product.priceText);
          allProducts.push({
            name: product.name,
            priceText: product.priceText,
            priceValue: priceValue || undefined,
            link: product.link,
            imageUrl: product.imageUrl,
            quantityText: product.quantityText || '',
            promoTag: product.promoTag,
          });
        }
        
        const pageProductsExtracted = allProducts.length - pageProductsBefore;
        Logger.info(`Extracted ${pageProductsExtracted} products from page ${currentPage} (total: ${allProducts.length})`);

        // If no products were extracted, stop
        if (pageProductsExtracted === 0) {
          Logger.info(`No new products extracted from page ${currentPage}, stopping pagination`);
          break;
        }

        currentPage++;
        
        // Small delay before next page (reduced)
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        Logger.warn(`Error loading page ${currentPage}: ${error}`);
        break;
      }
    }

    Logger.success(`Cached ${allProducts.length} Carrefour products`);
    this.cachedProducts = allProducts;
  }

  /**
   * Extract product details from a product element
   */
  private async extractProductDetails(
    element: any
  ): Promise<CarrefourProductDetails | null> {
    if (!element) {
      return null;
    }

    const decodePromotionAttr = (attr?: string | null): string | undefined => {
      if (!attr) {
        return undefined;
      }
      const normalized = attr.replace(/&quot;/g, '"');
      try {
        const parsed = JSON.parse(normalized);
        return (
          parsed?.promotion_name ||
          parsed?.ecommerce?.promotion_name ||
          parsed?.ecommerce?.items?.[0]?.promotion_name ||
          undefined
        );
      } catch (e) {
        return undefined;
      }
    };

    // Extract product name
    // Based on HTML: <div class="name-wrapper"> with <span class="desktop-name"> or <span class="mobile-name">
    let productName = '';
    const nameSelectors = [
      '.name-wrapper .desktop-name',
      '.name-wrapper .mobile-name',
      '.name-wrapper .link span',
      '.name-wrapper .link',
    ];

    for (const selector of nameSelectors) {
      try {
        const nameElement = await element.$(selector);
        if (nameElement) {
          const text = await nameElement.textContent();
          if (text && text.trim().length > 3) {
            productName = text.trim();
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    // Fallback: try to get from image alt or title
    if (!productName || productName.length < 3) {
      try {
        const imageElement = await element.$('.tile-image');
        if (imageElement) {
          const alt = await imageElement.getAttribute('alt');
          const title = await imageElement.getAttribute('title');
          if (alt && alt.trim().length > 3) {
            productName = alt.trim();
          } else if (title && title.trim().length > 3) {
            // Title might have format: "Product Name | Carrefour"
            productName = title.split('|')[0].trim();
          }
        }
      } catch (e) {
        // Continue
      }
    }

    if (!productName || productName.length < 3) {
      return null;
    }

    // Extract brand and prepend to product name for better filtering
    // Based on HTML: <div class="brand-wrapper"> -> <a href="#">Jupiler</a>
    try {
      const brandElement = await element.$('.brand-wrapper a');
      if (brandElement) {
        const brandText = (await brandElement.textContent())?.trim() || '';
        if (brandText && !productName.toLowerCase().includes(brandText.toLowerCase())) {
          // Prepend brand if not already in product name
          productName = `${brandText} ${productName}`;
        }
      }
    } catch (e) {
      // Continue without brand
    }

    // Extract price
    // Based on HTML: <div class="pricing-wrapper"> -> <div class="price"> -> <span class="sales"> -> <span class="value"> -> <span>16,79 €</span>
    let priceText = '';
    const priceSelectors = [
      '.pricing-wrapper .price .sales .value span',
      '.pricing-wrapper .price .sales span',
      '.pricing-wrapper .price .value span',
      '.pricing-wrapper .price span',
      '.price .sales .value span',
      '.price .sales span',
    ];

    for (const selector of priceSelectors) {
      try {
        const priceElement = await element.$(selector);
        if (priceElement) {
          const text = await priceElement.textContent();
          if (text && text.includes('€')) {
            priceText = text.trim();
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    // Try to get price from content attribute or data attributes
    if (!priceText) {
      try {
        const valueElement = await element.$('.price .sales .value');
        if (valueElement) {
          const contentAttr = await valueElement.getAttribute('content');
          if (contentAttr) {
            const priceNum = parseFloat(contentAttr);
            if (!isNaN(priceNum) && priceNum > 0) {
              priceText = `€${priceNum.toFixed(2).replace('.', ',')}`;
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
    // Based on HTML: <div class="name-wrapper"> -> <div class="pdp-link"> -> <a class="link" href="/nl/...">
    let productLink = '';
    const linkSelectors = [
      '.name-wrapper .pdp-link .link',
      '.name-wrapper .link',
      '.image-wrapper a',
      '.pdp-link .link',
    ];

    for (const selector of linkSelectors) {
      try {
        const linkElement = await element.$(selector);
        if (linkElement) {
          const href = await linkElement.getAttribute('href');
          if (href && href !== '#' && href !== '' && href.includes('.html')) {
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
    // Based on HTML: <img class="tile-image" src="...">
    let imageUrl: string | undefined = undefined;
    try {
      const imageElement = await element.$('.tile-image');
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
    // Based on HTML: <div class="package-info-wrapper"> -> <div class="package-info">Per stuk</div>
    // Also check price-per-unit-wrapper for additional info
    let quantityText = '';
    try {
      const packageInfoElement = await element.$('.package-info-wrapper .package-info');
      if (packageInfoElement) {
        quantityText = (await packageInfoElement.textContent()) || '';
      }
      
      // Also get price per unit info
      const pricePerUnitElement = await element.$('.price-per-unit-wrapper');
      if (pricePerUnitElement) {
        const unitText = (await pricePerUnitElement.textContent()) || '';
        if (unitText) {
          quantityText = quantityText ? `${quantityText} (${unitText.trim()})` : unitText.trim();
        }
      }
    } catch (e) {
      // Continue
    }
    
    // Extract promo tag info
    let promoTag: string | undefined;

    const promoSelectors = [
      '.promo-tag-text',
      '.promo-tag .promo-tag-text',
      '.promo-tag',
      '.promo-label',
      '.promo-validity-date',
      '.promo-cta-link',
      '.tags-wrapper [class*="promo"]',
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

    if (!promoTag) {
      try {
        const promoAttr = await element.getAttribute(
          'data-select-promotion-event-object'
        );
        const decoded = decodePromotionAttr(promoAttr);
        if (decoded) {
          promoTag = decoded;
        }
      } catch (e) {
        // Continue
      }
    }

    if (!promoTag) {
      try {
        const tileElement = await element.$('.product-tile');
        if (tileElement) {
          const promoAttr = await tileElement.getAttribute(
            'data-select-promotion-event-object'
          );
          const decoded = decodePromotionAttr(promoAttr);
          if (decoded) {
            promoTag = decoded;
          }
        }
      } catch (e) {
        // Continue
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
   * Override scrapeProducts to load all products at once for Carrefour
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
        Logger.warn('No cached Carrefour products available');
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
            `Found ${productResults.length} Carrefour matches for "${product.name}"`
          );
        } else {
          Logger.warn(
            `No matching Carrefour products found for "${product.name}" (${this.cachedProducts.length} products scanned)`
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
          `No cached Carrefour products available for "${product.name}"`
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
          `No matching Carrefour products found for "${product.name}" (${this.cachedProducts.length} products scanned)`
        );
      } else {
        Logger.success(
          `Found ${results.length} Carrefour matches for "${product.name}"`
        );
      }
    } catch (error) {
      Logger.error(
        `Error searching for product "${product.name}" at Carrefour:`,
        error
      );
    }

    return results;
  }
}


import { Product, ScrapedProduct, Supermarket, ScrapingConfig } from '../types';
import { BaseScraper } from './base-scraper';
import { Logger } from '../utils/logger';

interface BabylonProductDetails {
  name: string;
  priceText: string;
  priceValue?: number;
  link: string;
  imageUrl?: string;
  metaText: string;
  promoTag?: string;
}

export class BabylonScraper extends BaseScraper {
  private cachedProducts: BabylonProductDetails[] | null = null;

  constructor(supermarket: Supermarket, config: ScrapingConfig) {
    super(supermarket, config);
  }

  protected extractPrice(priceText: string): number | null {
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

  private getCategoryUrl(): string {
    const base = this.supermarket.baseUrl.replace(/\/$/, '');
    return `${base}/product-category/bieren/`;
  }

  private async loadAllProducts(): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    if (this.cachedProducts) {
      Logger.info(
        `Using cached Babylon Drinks products (${this.cachedProducts.length} items)`
      );
      return;
    }

    const DEBUG = process.env.DEBUG === 'true';
    const categoryUrl = this.getCategoryUrl();

    Logger.info(`Navigating to Babylon Drinks category: ${categoryUrl}`);
    await this.navigateToUrl(categoryUrl);

    if (DEBUG) {
      const { DebugHelper } = await import('../utils/debug');
      await DebugHelper.takeScreenshot(this.page, 'babylon-category');
      await DebugHelper.dumpHTML(this.page, 'babylon-category');
      await DebugHelper.findPotentialProductElements(this.page);
      await DebugHelper.logProductRelatedClasses(this.page);
    }

    // Wait for page load (optimized - skip networkidle for speed)
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {
      Logger.warn('DOM content loaded timeout for Babylon Drinks, continuing...');
    });
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Short wait instead of networkidle

    const selectors = [
      '.product-loop-wrapper',
      'ul.products li.product',
      'li.product',
      'article.product',
    ];

    let productElements: any[] = [];

    for (const selector of selectors) {
      try {
        Logger.info(`Trying selector for Babylon products: ${selector}`);
        await this.page.waitForSelector(selector, { timeout: 5000 }); // Reduced from 8000ms
        productElements = await this.page.$$(selector);
        if (productElements.length > 0) {
          Logger.success(
            `Found ${productElements.length} products using selector ${selector}`
          );
          break;
        }
      } catch (error) {
        Logger.warn(`Selector ${selector} failed: ${error}`);
      }
    }

    if (!productElements || productElements.length === 0) {
      Logger.warn(
        `No products found on Babylon Drinks category page (${categoryUrl})`
      );
      this.cachedProducts = [];
      return;
    }

    const products: BabylonProductDetails[] = [];

    for (const element of productElements) {
      try {
        const productDetails = await this.extractProductDetails(element);
        if (productDetails) {
          products.push(productDetails);
        }
      } catch (error) {
        Logger.warn('Error extracting Babylon product details:', error);
      }
    }

    Logger.success(`Cached ${products.length} Babylon Drinks products`);
    this.cachedProducts = products;
  }

  private async extractProductDetails(
    element: any
  ): Promise<BabylonProductDetails | null> {
    if (!element) {
      return null;
    }

    let productName = '';
    const nameSelectors = [
      '.woocommerce-loop-product__title',
      '.product-title',
      '.title',
      'h2',
      'h3',
    ];

    for (const selector of nameSelectors) {
      const node = await element.$(selector);
      if (node) {
        const text = (await node.textContent())?.trim();
        if (text && text.length > 2) {
          productName = text;
          break;
        }
      }
    }

    if (!productName) {
      const anchor = await element.$('a');
      if (anchor) {
        const titleAttr = await anchor.getAttribute('title');
        if (titleAttr) {
          productName = titleAttr.trim();
        }
      }
    }

    if (!productName) {
      Logger.warn('Skipping Babylon product without a name');
      return null;
    }

    let priceText = '';
    let priceValue: number | null = null;

    const priceSelectors = [
      '.price ins .woocommerce-Price-amount',
      '.price ins',
      '.price bdi',
      '.price',
      '.product-price',
      '.woocommerce-Price-amount',
    ];

    for (const selector of priceSelectors) {
      const node = await element.$(selector);
      if (node) {
        const text = (await node.textContent())?.trim();
        if (text) {
          priceText = text.replace(/\s+/g, ' ');
          priceValue = this.extractPrice(priceText);
          if (priceValue !== null) {
            break;
          }
        }
      }
    }

    if (!priceText) {
      Logger.warn(`Could not determine price for Babylon product ${productName}`);
      return null;
    }

    let link = '';
    const primaryLink =
      (await element.$('a.woocommerce-LoopProduct-link')) ||
      (await element.$('a'));
    if (primaryLink) {
      const href = await primaryLink.getAttribute('href');
      if (href) {
        link = href.startsWith('http')
          ? href
          : `${this.supermarket.baseUrl.replace(/\/$/, '')}/${href.replace(
              /^\//,
              ''
            )}`;
      }
    }

    let imageUrl: string | undefined;
    const imageNode =
      (await element.$('img.product-loop-image')) || (await element.$('img'));
    if (imageNode) {
      imageUrl = await imageNode.getAttribute('src');
    }

    let metaText = '';
    try {
      const metaNode = await element.$(
        '.product-loop-meta, .product-loop-content, .woocommerce-product-details__short-description'
      );
      if (metaNode) {
        const text = await metaNode.textContent();
        if (text) {
          metaText = text.trim();
        }
      }
    } catch (_error) {
      // Ignore meta extraction errors for individual products
    }

    let promoTag: string | undefined;

    // Badge-based promos (-25%)
    const promoSelectors = [
      '.woostify-tag-on-sale',
      '.onsale',
      '.sale-badge',
      '.sale-left',
      '.sale-right',
    ];

    for (const selector of promoSelectors) {
      const badge = await element.$(selector);
      if (badge) {
        const text = (await badge.textContent())?.trim();
        if (text) {
          promoTag = text;
          break;
        }
      }
    }

    // Price comparison promo (del vs ins)
    if (!promoTag) {
      const originalPriceNode = await element.$('del .woocommerce-Price-amount, del bdi');
      const promoPriceNode = await element.$('ins .woocommerce-Price-amount, ins bdi');

      const originalPrice = originalPriceNode
        ? (await originalPriceNode.textContent())?.trim()
        : undefined;
      const promoPrice = promoPriceNode
        ? (await promoPriceNode.textContent())?.trim()
        : undefined;

      if (originalPrice && promoPrice && originalPrice !== promoPrice) {
        promoTag = `Promo: ${originalPrice} → ${promoPrice}`;
      }
    }

    return {
      name: productName.trim(),
      priceText: priceText.trim(),
      priceValue: priceValue ?? undefined,
      link,
      imageUrl,
      metaText,
      promoTag,
    };
  }

  async searchProduct(product: Product): Promise<ScrapedProduct[]> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    const results: ScrapedProduct[] = [];

    try {
      await this.loadAllProducts();

      if (!this.cachedProducts || this.cachedProducts.length === 0) {
        Logger.warn(
          `No cached Babylon Drinks products available for "${product.name}"`
        );
        return results;
      }

      for (const item of this.cachedProducts) {
        if (!this.filterProduct(item.name, product, item.metaText)) {
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
          `No matching Babylon Drinks products found for "${product.name}" (${this.cachedProducts.length} products scanned)`
        );
      } else {
        Logger.success(
          `Found ${results.length} Babylon Drinks matches for "${product.name}"`
        );
      }
    } catch (error) {
      Logger.error(
        `Error searching for product "${product.name}" at Babylon Drinks:`,
        error
      );
    }

    return results;
  }
}
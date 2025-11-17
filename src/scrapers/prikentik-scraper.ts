import { Product, ScrapedProduct, Supermarket, ScrapingConfig } from '../types';
import { BaseScraper } from './base-scraper';
import { Logger } from '../utils/logger';

interface PrikentikProductDetails {
  name: string;
  priceText: string;
  priceValue?: number;
  link: string;
  imageUrl?: string;
  extraText: string;
  promoTag?: string;
}

export class PrikentikScraper extends BaseScraper {
  private cachedProducts: PrikentikProductDetails[] | null = null;

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
    // Filter for the primary brands we track: Stella, Jupiler, Cristal, Maes
    const query = '/bier?brand=316%2C317%2C584%2C574&product_list_limit=36';
    return `${base}${query}`;
  }

  private async loadAllProducts(): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    if (this.cachedProducts) {
      Logger.info(
        `Using cached Prik&Tik products (${this.cachedProducts.length} items)`
      );
      return;
    }

    const DEBUG = process.env.DEBUG === 'true';
    const categoryUrl = this.getCategoryUrl();

    Logger.info(`Navigating to Prik&Tik category: ${categoryUrl}`);
    await this.navigateToUrl(categoryUrl);

    if (DEBUG) {
      const { DebugHelper } = await import('../utils/debug');
      await DebugHelper.takeScreenshot(this.page, 'prikentik-category');
      await DebugHelper.dumpHTML(this.page, 'prikentik-category');
    }

    // Wait for products (optimized - shorter timeout)
    await this.page
      .waitForSelector('form.product-item', { timeout: 8000 }) // Reduced from 15000ms
      .catch(() => {
        Logger.warn('Product items not found on Prik&Tik page, continuing...');
      });
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Reduced from 2000ms

    // Trigger lazy loading by scrolling (optimized - faster scrolling)
    await this.page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await new Promise((resolve) => setTimeout(resolve, 600)); // Reduced from 1000ms
    await this.page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise((resolve) => setTimeout(resolve, 800)); // Reduced from 2000ms

    const productElements = await this.page.$$('form.product-item');

    if (!productElements || productElements.length === 0) {
      Logger.warn('No products found on Prik&Tik category page');
      this.cachedProducts = [];
      return;
    }

    Logger.info(`Found ${productElements.length} Prik&Tik products`);

    const products: PrikentikProductDetails[] = [];

    for (const element of productElements) {
      try {
        const details = await this.extractProductDetails(element);
        if (details) {
          products.push(details);
        }
      } catch (error) {
        Logger.warn('Error extracting Prik&Tik product details:', error);
      }
    }

    Logger.success(`Cached ${products.length} Prik&Tik products`);
    this.cachedProducts = products;
  }

  private async extractProductDetails(
    element: any
  ): Promise<PrikentikProductDetails | null> {
    // Product name
    const nameElement = await element.$('a.product-item-link');
    const productName =
      (await nameElement?.textContent())?.trim().replace(/\s+/g, ' ') || '';

    if (!productName) {
      return null;
    }

    // Price
    const priceSelectors = [
      '.price-box .special-price .price',
      '.price-box .price-wrapper .price',
      '.price-box .price',
      '.price-container .price',
    ];

    let priceText = '';
    for (const selector of priceSelectors) {
      const node = await element.$(selector);
      if (node) {
        const text = (await node.textContent())?.trim();
        if (text) {
          priceText = text.replace(/\s+/g, ' ');
          break;
        }
      }
    }

    if (!priceText) {
      return null;
    }

    // Link
    let productLink = '';
    if (nameElement) {
      const href = await nameElement.getAttribute('href');
      if (href) {
        productLink = href.startsWith('http')
          ? href
          : `${this.supermarket.baseUrl.replace(/\/$/, '')}/${href.replace(
              /^\//,
              ''
            )}`;
      }
    }

    // Image
    const imageElement =
      (await element.$('picture img')) || (await element.$('img'));
    const imageUrl = (await imageElement?.getAttribute('src')) || undefined;

    // Extra text (brand + availability)
    const brandElement = await element.$('.text-forrest-800');
    const brandText = (await brandElement?.textContent())?.trim() || '';

    const availabilityElement = await element.$('.stock span:last-child');
    const availabilityText =
      (await availabilityElement?.textContent())?.trim() || '';

    const extraText = [brandText, availabilityText].filter(Boolean).join(' ');

    // Promo detection
    let promoTag: string | undefined;

    const promoBadge =
      (await element.$('.product-label-promo span')) ||
      (await element.$('.product-label-promo'));
    if (promoBadge) {
      const badgeText = (await promoBadge.textContent())?.trim();
      if (badgeText) {
        promoTag = badgeText;
      }
    }

    if (!promoTag) {
      const specialPriceNode = await element.$('.special-price .price');
      const oldPriceNode = await element.$('.old-price .price');

      const specialPrice = specialPriceNode
        ? (await specialPriceNode.textContent())?.trim()
        : undefined;
      const oldPrice = oldPriceNode
        ? (await oldPriceNode.textContent())?.trim()
        : undefined;

      if (specialPrice && oldPrice && specialPrice !== oldPrice) {
        promoTag = `Promo: ${oldPrice} → ${specialPrice}`;
      }
    }

    return {
      name: productName,
      priceText,
      priceValue: this.extractPrice(priceText) || undefined,
      link: productLink,
      imageUrl,
      extraText,
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
          `No cached Prik&Tik products available for "${product.name}"`
        );
        return results;
      }

      for (const item of this.cachedProducts) {
        if (!this.filterProduct(item.name, product, item.extraText)) {
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
          `No matching Prik&Tik products found for "${product.name}" (${this.cachedProducts.length} products scanned)`
        );
      } else {
        Logger.success(
          `Found ${results.length} Prik&Tik matches for "${product.name}"`
        );
      }
    } catch (error) {
      Logger.error(
        `Error searching for product "${product.name}" at Prik&Tik:`,
        error
      );
    }

    return results;
  }
}



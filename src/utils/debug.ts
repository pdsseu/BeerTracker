import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';

export class DebugHelper {
  /**
   * Take a screenshot of the current page
   */
  static async takeScreenshot(page: Page, filename: string): Promise<string> {
    const screenshotPath = path.join(process.cwd(), `debug-${filename}-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    Logger.info(`Screenshot saved: ${screenshotPath}`);
    return screenshotPath;
  }

  /**
   * Dump page HTML to file
   */
  static async dumpHTML(page: Page, filename: string): Promise<string> {
    const html = await page.content();
    const htmlPath = path.join(process.cwd(), `debug-${filename}-${Date.now()}.html`);
    fs.writeFileSync(htmlPath, html, 'utf-8');
    Logger.info(`HTML dumped: ${htmlPath}`);
    return htmlPath;
  }

  /**
   * Find all elements that might be products
   */
  static async findPotentialProductElements(page: Page): Promise<void> {
    Logger.info('=== DEBUG: Searching for potential product elements ===');
    
    // Try to find common product container patterns
    const selectors = [
      'article',
      '[role="article"]',
      '[class*="card"]',
      '[class*="tile"]',
      '[class*="item"]',
      '[class*="product"]',
      '[data-testid]',
      'li[class*="product"]',
      'div[class*="product"]',
    ];

    for (const selector of selectors) {
      try {
        const count = await page.$$eval(selector, (elements) => elements.length);
        if (count > 0) {
          Logger.info(`Found ${count} elements with selector: ${selector}`);
          
          // Get first few examples
          const examples = await page.$$eval(
            selector,
            (elements) => {
              const max = 3;
              return Array.from(elements)
                .slice(0, max)
                .map((el) => ({
                  tagName: el.tagName,
                  className: el.className,
                  id: el.id,
                  textContent: el.textContent?.substring(0, 100) || '',
                }));
            }
          );
          
          examples.forEach((example, idx) => {
            Logger.info(`  Example ${idx + 1}:`);
            Logger.info(`    Tag: ${example.tagName}`);
            Logger.info(`    Class: ${example.className}`);
            Logger.info(`    ID: ${example.id}`);
            Logger.info(`    Text: ${example.textContent.substring(0, 80)}...`);
          });
        }
      } catch (e) {
        // Continue
      }
    }

    // Look for price patterns
    Logger.info('=== DEBUG: Searching for price elements ===');
    const priceSelectors = [
      '*:has-text("€")',
      '[class*="price"]',
      '[class*="Price"]',
      '[data-testid*="price"]',
    ];

    for (const selector of priceSelectors) {
      try {
        const count = await page.$$eval(selector, (elements) => elements.length);
        if (count > 0) {
          Logger.info(`Found ${count} price elements with selector: ${selector}`);
          const examples = await page.$$eval(
            selector,
            (elements) => {
              const max = 3;
              return Array.from(elements)
                .slice(0, max)
                .map((el) => ({
                  textContent: el.textContent?.trim() || '',
                  className: el.className,
                }));
            }
          );
          examples.forEach((example, idx) => {
            Logger.info(`  Price example ${idx + 1}: "${example.textContent}" (class: ${example.className})`);
          });
        }
      } catch (e) {
        // Continue
      }
    }
  }

  /**
   * Get all unique class names on the page
   */
  static async getAllClasses(page: Page): Promise<string[]> {
    const classes = await page.evaluate(() => {
      const allClasses = new Set<string>();
      const allElements = document.querySelectorAll('*');
      
      allElements.forEach((el) => {
        if (el.className && typeof el.className === 'string') {
          el.className.split(' ').forEach((cls) => {
            if (cls.trim()) allClasses.add(cls.trim());
          });
        }
      });
      
      return Array.from(allClasses).sort();
    });

    return classes;
  }

  /**
   * Log classes that might be related to products
   */
  static async logProductRelatedClasses(page: Page): Promise<void> {
    const classes = await this.getAllClasses(page);
    const productKeywords = ['product', 'item', 'card', 'tile', 'price', 'name', 'title'];
    
    const relevantClasses = classes.filter((cls) =>
      productKeywords.some((keyword) => cls.toLowerCase().includes(keyword))
    );

    Logger.info(`=== DEBUG: Found ${relevantClasses.length} product-related classes ===`);
    relevantClasses.forEach((cls) => {
      Logger.info(`  - ${cls}`);
    });
  }
}



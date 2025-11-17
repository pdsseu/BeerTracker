import { Page, Browser, BrowserContext } from 'playwright';
import { Logger } from './logger';
import { ScrapingConfig } from '../types';

export class AntiBot {
  /**
   * Random delay between min and max milliseconds
   */
  static async randomDelay(config: ScrapingConfig): Promise<void> {
    const delay = Math.floor(
      Math.random() * (config.randomDelayMax - config.randomDelayMin) +
        config.randomDelayMin
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Longer delay for anti-bot protection (especially for Colruyt)
   * Uses exponential backoff with jitter
   */
  static async longDelay(baseDelay: number = 5000, maxDelay: number = 15000): Promise<void> {
    // Exponential backoff with jitter: baseDelay * (1.5 ^ attempts) + random(0-2000)
    const jitter = Math.random() * 2000;
    const delay = Math.min(baseDelay + jitter, maxDelay);
    Logger.info(`Waiting ${Math.round(delay)}ms to avoid bot detection...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Simulate human-like mouse movements
   */
  static async simulateMouseMovement(page: Page): Promise<void> {
    try {
      const viewport = page.viewportSize();
      if (!viewport) return;

      // More realistic mouse movements (3-5 movements)
      const movements = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < movements; i++) {
        const x = Math.random() * viewport.width;
        const y = Math.random() * viewport.height;
        // More steps = smoother movement (more human-like)
        const steps = 15 + Math.floor(Math.random() * 10);
        await page.mouse.move(x, y, { steps });
        // Variable delay between movements
        await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 200));
      }
    } catch (error) {
      Logger.warn('Failed to simulate mouse movement:', error);
    }
  }

  /**
   * Simulate reading behavior - random pauses and small scrolls
   */
  static async simulateReading(page: Page): Promise<void> {
    try {
      // Simulate reading time (2-5 seconds)
      const readingTime = 2000 + Math.random() * 3000;
      await new Promise((resolve) => setTimeout(resolve, readingTime));

      // Small random scrolls (like reading)
      const viewport = page.viewportSize();
      if (viewport) {
        const scrollAmount = 50 + Math.random() * 100;
        await page.evaluate((amount) => {
          window.scrollBy(0, amount);
        }, scrollAmount);
        await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));
      }
    } catch (error) {
      Logger.warn('Failed to simulate reading:', error);
    }
  }

  /**
   * Scroll page like a human would
   */
  static async humanScroll(page: Page): Promise<void> {
    try {
      const viewport = page.viewportSize();
      if (!viewport) return;

      const scrollSteps = 5;
      const scrollAmount = viewport.height / scrollSteps;

      for (let i = 0; i < scrollSteps; i++) {
        await page.evaluate((amount) => {
          window.scrollBy(0, amount);
        }, scrollAmount);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Scroll back to top
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
    } catch (error) {
      Logger.warn('Failed to perform human scroll:', error);
    }
  }

  /**
   * Wait for page to be fully loaded
   */
  static async waitForPageLoad(
    page: Page,
    config: ScrapingConfig
  ): Promise<void> {
    try {
      await page.waitForLoadState('networkidle', { timeout: config.timeout });
      await new Promise((resolve) =>
        setTimeout(resolve, config.waitAfterPageLoad)
      );
    } catch (error) {
      Logger.warn('Page load timeout, continuing anyway:', error);
    }
  }

  /**
   * Accept cookies if cookie banner appears
   */
  static async handleCookieBanner(page: Page): Promise<void> {
    try {
      // Common cookie button selectors
      const cookieSelectors = [
        'button[id*="accept"]',
        'button[class*="accept"]',
        'button[id*="cookie"]',
        'button[class*="cookie"]',
        'button:has-text("Accepteren")',
        'button:has-text("Accept")',
        'button:has-text("Akkoord")',
        'button:has-text("OK")',
        '[data-testid*="cookie"]',
        '[data-testid*="accept"]',
      ];

      for (const selector of cookieSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            const isVisible = await button.isVisible();
            if (isVisible) {
              await button.click();
              Logger.info(`Clicked cookie button: ${selector}`);
              await new Promise((resolve) => setTimeout(resolve, 1000));
              break;
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }
    } catch (error) {
      Logger.warn('Could not handle cookie banner:', error);
    }
  }
}


import { Supermarket, ScrapingConfig } from '../types';
import { BaseScraper } from './base-scraper';
import { DelhaizeScraper } from './delhaize-scraper';
import { ColruytScraper } from './colruyt-scraper';
import { BabylonScraper } from './babylon-scraper';
import { PrikentikScraper } from './prikentik-scraper';
import { CarrefourScraper } from './carrefour-scraper';

export class ScraperFactory {
  static create(
    supermarket: Supermarket,
    config: ScrapingConfig
  ): BaseScraper {
    const storeName = supermarket.name.toLowerCase();

    switch (storeName) {
      case 'delhaize':
        return new DelhaizeScraper(supermarket, config);
      case 'colruyt':
        return new ColruytScraper(supermarket, config);
      case 'babylon drinks':
      case 'babylon':
        return new BabylonScraper(supermarket, config);
      case 'prik&tik':
      case 'prik en tik':
      case 'prikentik':
        return new PrikentikScraper(supermarket, config);
      case 'carrefour':
        return new CarrefourScraper(supermarket, config);
      default:
        throw new Error(`No scraper available for ${supermarket.name}`);
    }
  }
}

export { BaseScraper } from './base-scraper';
export { DelhaizeScraper } from './delhaize-scraper';
export { ColruytScraper } from './colruyt-scraper';
export { BabylonScraper } from './babylon-scraper';
export { PrikentikScraper } from './prikentik-scraper';
export { CarrefourScraper } from './carrefour-scraper';

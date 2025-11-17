export interface Supermarket {
  name: string;
  baseUrl: string;
  enabled: boolean;
}

export interface Product {
  name: string;
  searchTerms: string[];
  requiredKeywords?: string[];
  mustContain?: string[];
  preferredKeywords?: string[];
  storeOverrides?: Record<string, ProductStoreOverride>;
}

export interface ScrapingConfig {
  headless: boolean;
  timeout: number;
  waitAfterPageLoad: number;
  randomDelayMin: number;
  randomDelayMax: number;
  userAgent: string;
  excludeAlcoholFree?: boolean;
}

export interface Config {
  supermarkets: Supermarket[];
  products: Product[];
  scraping: ScrapingConfig;
}

export interface ScrapedProduct {
  productName: string;
  supermarket: string;
  price: string;
  priceValue?: number;
  targetProduct: string;
  link: string;
  timestamp: Date;
  available: boolean;
  imageUrl?: string;
  promoTag?: string;
}

export interface ProductStoreOverride {
  searchTerms?: string[];
  requiredKeywords?: string[];
  mustContain?: string[];
  preferredKeywords?: string[];
}


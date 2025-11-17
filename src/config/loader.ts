import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../types';
import { Logger } from '../utils/logger';

export class ConfigLoader {
  static load(): Config {
    const configPath = path.join(process.cwd(), 'config.json');

    if (!fs.existsSync(configPath)) {
      Logger.error(`Config file not found at ${configPath}`);
      throw new Error('Config file not found');
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config: Config = JSON.parse(configContent);
      Logger.info('Configuration loaded successfully');
      return config;
    } catch (error) {
      Logger.error('Failed to load configuration:', error);
      throw error;
    }
  }
}



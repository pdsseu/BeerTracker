export class Logger {
  private static formatTimestamp(): string {
    return new Date().toISOString();
  }

  static info(message: string, ...args: any[]): void {
    console.log(`[${this.formatTimestamp()}] [INFO] ${message}`, ...args);
  }

  static error(message: string, error?: Error | unknown): void {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`[${this.formatTimestamp()}] [ERROR] ${message}`, errorMsg);
    if (stack && process.env.DEBUG) {
      console.error(stack);
    }
  }

  static warn(message: string, ...args: any[]): void {
    console.warn(`[${this.formatTimestamp()}] [WARN] ${message}`, ...args);
  }

  static success(message: string, ...args: any[]): void {
    console.log(`[${this.formatTimestamp()}] [SUCCESS] ${message}`, ...args);
  }
}



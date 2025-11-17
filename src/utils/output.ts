import * as fs from 'fs';
import * as path from 'path';
import { ScrapedProduct } from '../types';
import { Logger } from './logger';

export class OutputGenerator {
  /**
   * Generate console output
   */
  static consoleOutput(results: ScrapedProduct[]): void {
    console.log('\n' + '='.repeat(80));
    console.log('PRIJSVERGELIJKING RESULTATEN');
    console.log('='.repeat(80) + '\n');

    if (results.length === 0) {
      console.log('Geen resultaten gevonden.\n');
      return;
    }

    // Group by product name
    const grouped = this.groupByProduct(results);

    for (const [productName, products] of Object.entries(grouped)) {
      console.log(`\n📦 ${productName}`);
      console.log('-'.repeat(80));

      // Sort by price
      const sorted = products
        .filter((p) => p.priceValue !== undefined)
        .sort((a, b) => (a.priceValue || 0) - (b.priceValue || 0));

      sorted.forEach((product) => {
        const priceDisplay = product.priceValue
          ? `€${product.priceValue.toFixed(2)}`
          : product.price;
        const linkDisplay = product.link ? ` (${product.link})` : '';
        console.log(
          `  🏪 ${product.supermarket.padEnd(15)} ${priceDisplay.padStart(10)}${linkDisplay}`
        );
      });

      if (sorted.length === 0) {
        products.forEach((product) => {
          const linkDisplay = product.link ? ` (${product.link})` : '';
          console.log(
            `  🏪 ${product.supermarket.padEnd(15)} ${product.price.padStart(10)}${linkDisplay}`
          );
        });
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`Totaal: ${results.length} resultaten gevonden`);
    console.log('='.repeat(80) + '\n');
  }

  /**
   * Generate HTML output
   */
  static generateHTML(results: ScrapedProduct[]): string {
    const grouped = this.groupByProduct(results);
    const timestamp = new Date().toLocaleString('nl-BE');

    let html = `<!DOCTYPE html>
<html lang="nl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Prijsvergelijking - ${timestamp}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
            min-height: 100vh;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        .header p {
            opacity: 0.9;
            font-size: 1.1em;
        }
        .content {
            padding: 30px;
        }
        .product-columns {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 24px;
        }
        @media (min-width: 1200px) {
            .product-columns {
                grid-template-columns: repeat(4, 1fr);
            }
        }
        .product-column {
            background: #f9f9ff;
            border-radius: 10px;
            border: 1px solid rgba(102, 126, 234, 0.15);
            display: flex;
            flex-direction: column;
            min-height: 100%;
        }
        .column-header {
            background: linear-gradient(135deg, rgba(102, 126, 234, 0.12) 0%, rgba(118, 75, 162, 0.12) 100%);
            padding: 18px 20px;
            border-bottom: 1px solid rgba(102, 126, 234, 0.2);
        }
        .column-header h2 {
            font-size: 1.3em;
            color: #3a3a66;
            margin-bottom: 8px;
        }
        .column-meta {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.9em;
            color: #5b5b8a;
        }
        .badge {
            background: rgba(102, 126, 234, 0.2);
            color: #4450c8;
            padding: 4px 10px;
            border-radius: 14px;
            font-weight: 600;
            font-size: 0.8em;
        }
        .column-body {
            padding: 18px 20px 24px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .empty-column {
            padding: 20px;
            text-align: center;
            color: #888;
            font-size: 0.95em;
        }
        .result-card {
            background: white;
            border-radius: 12px;
            padding: 16px 18px;
            box-shadow: 0 8px 24px rgba(102, 126, 234, 0.08);
            border: 1px solid rgba(102, 126, 234, 0.1);
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .promo-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: linear-gradient(135deg, #ff5f6d 0%, #ffc371 100%);
            color: #fff;
            font-weight: 700;
            font-size: 0.85em;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            padding: 6px 12px;
            border-radius: 999px;
            box-shadow: 0 6px 18px rgba(255, 95, 109, 0.35);
        }
        .result-card.best-price {
            border: 2px solid #4caf50;
            box-shadow: 0 12px 28px rgba(76, 175, 80, 0.18);
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .supermarket {
            font-weight: 700;
            color: #4450c8;
            letter-spacing: 0.3px;
        }
        .best-badge {
            background: #4caf50;
            color: white;
            font-size: 0.7em;
            padding: 4px 8px;
            border-radius: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.4px;
        }
        .card-title {
            font-size: 1em;
            font-weight: 600;
            color: #2c2c4d;
            line-height: 1.4;
        }
        .card-price {
            font-size: 1.4em;
            font-weight: 700;
            color: #2d8659;
        }
        .card-actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 6px;
        }
        .link {
            color: #4450c8;
            text-decoration: none;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .link::after {
            content: '↗';
            font-size: 0.85em;
        }
        .timestamp {
            color: #888;
            font-size: 0.85em;
        }
        .no-results {
            text-align: center;
            padding: 40px;
            color: #888;
            font-size: 1.1em;
        }
        .footer {
            text-align: center;
            padding: 20px;
            color: #888;
            border-top: 1px solid #e0e0e0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🍺 Prijsvergelijking Dranken</h1>
            <p>Laatst bijgewerkt: ${timestamp}</p>
        </div>
        <div class="content">`;

    if (results.length === 0) {
      html += '<div class="no-results">Geen resultaten gevonden.</div>';
    } else {
      html += '<div class="product-columns">';
      for (const [targetProduct, products] of Object.entries(grouped)) {
        const totalResults = products.length;

        html += `
            <div class="product-column">
                <div class="column-header">
                    <h2>🍺 ${this.escapeHtml(targetProduct)}</h2>
                    <div class="column-meta">
                        <span class="badge">${totalResults} resultaten</span>
                    </div>
                </div>
                <div class="column-body">`;

        if (products.length === 0) {
          html += `<div class="empty-column">Geen resultaten gevonden voor deze drank.</div>`;
        } else {
          const bestPrice = products.find((p) => p.priceValue !== undefined)?.priceValue ?? null;

          products.forEach((product) => {
            const isBestPrice =
              bestPrice !== null &&
              product.priceValue !== undefined &&
              product.priceValue === bestPrice;
            const priceDisplay = product.priceValue
              ? `€${product.priceValue.toFixed(2)}`
              : this.escapeHtml(product.price);
            const linkHtml = product.link
              ? `<a href="${this.escapeHtml(product.link)}" target="_blank" class="link">Bekijk product</a>`
              : '<span class="link">Geen link beschikbaar</span>';
            const timeDisplay = product.timestamp.toLocaleTimeString('nl-BE');
            const productTitle = product.productName ? this.escapeHtml(product.productName) : this.escapeHtml(targetProduct);
            const promoHtml = product.promoTag
              ? `<div class="promo-badge">${this.escapeHtml(product.promoTag)}</div>`
              : '';

            html += `
                    <div class="result-card ${isBestPrice ? 'best-price' : ''}">
                        <div class="card-header">
                            <span class="supermarket">${this.escapeHtml(product.supermarket)}</span>
                            ${isBestPrice ? '<span class="best-badge">Beste prijs</span>' : ''}
                        </div>
                        <div class="card-title">${productTitle}</div>
                        ${promoHtml}
                        <div class="card-price">${priceDisplay}</div>
                        <div class="card-actions">
                            ${linkHtml}
                            <span class="timestamp">${timeDisplay}</span>
                        </div>
                    </div>`;
          });
        }

        html += `
                </div>
            </div>`;
      }
      html += '</div>';
    }

    html += `
        </div>
        <div class="footer">
            <p>Totaal: ${results.length} resultaten gevonden</p>
        </div>
    </div>
</body>
</html>`;

    return html;
  }

  /**
   * Save HTML to file
   */
  static saveHTML(results: ScrapedProduct[], filename?: string): string {
    const html = this.generateHTML(results);
    const outputPath = path.join(
      process.cwd(),
      filename || `results-${Date.now()}.html`
    );

    fs.writeFileSync(outputPath, html, 'utf-8');
    Logger.success(`HTML output saved to: ${outputPath}`);
    return outputPath;
  }

  /**
   * Group results by product name
   */
  private static groupByProduct(
    results: ScrapedProduct[]
  ): Record<string, ScrapedProduct[]> {
    const grouped: Record<string, ScrapedProduct[]> = {};

    for (const result of results) {
      const key = result.targetProduct || result.productName;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(result);
    }

    // Sort each group by price, keeping entries with undefined price at the end
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => {
        if (a.priceValue === undefined) return 1;
        if (b.priceValue === undefined) return -1;
        return a.priceValue - b.priceValue;
      });
    }

    return grouped;
  }

  /**
   * Escape HTML special characters
   */
  private static escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
}



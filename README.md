# BeerTracker - Webscraping Tool voor Drankprijzen

Een TypeScript/Node.js applicatie die automatisch prijzen vergelijkt van dranken bij Belgische supermarkten zoals Delhaize, Colruyt, Carrefour, Babylon Drinks en Prik&Tik.

## Features

- 🔍 Automatische prijsvergelijking tussen meerdere supermarkten
- 🤖 Anti-bot maatregelen (random delays, muisbewegingen, scroll simulatie)
- 📊 Console en HTML output
- ⚙️ Eenvoudig configureerbaar via `config.json`
- 📝 Uitgebreide logging
- 🎯 Ondersteuning voor meerdere producten en supermarkten

## Installatie

1. Installeer dependencies:
```bash
npm install
```

2. Installeer Playwright browsers:
```bash
npx playwright install chromium
```

## Configuratie

Bewerk `config.json` om producten en supermarkten toe te voegen:

```json
{
  "supermarkets": [
    {
      "name": "Delhaize",
      "baseUrl": "https://www.delhaize.be",
      "enabled": true
    }
  ],
  "products": [
    {
      "name": "Coca-Cola 1.5L",
      "searchTerms": ["coca cola", "coca-cola"],
      "size": "1.5L",
      "category": "frisdrank"
    }
  ]
}
```

## Gebruik

### Development mode (met ts-node):
```bash
npm run dev
```

### Production build:
```bash
npm run build
npm start
```

### Of in één commando:
```bash
npm run scrape
```

## Output

De applicatie genereert:
1. **Console output**: Gestructureerde tekstuele weergave in de terminal
2. **HTML bestand**: `results-[timestamp].html` met een mooie tabelweergave

## Project Structuur

```
BeerTracker/
├── src/
│   ├── config/
│   │   └── loader.ts          # Configuratie loader
│   ├── scrapers/
│   │   ├── base-scraper.ts    # Basis scraper klasse
│   │   ├── delhaize-scraper.ts
│   │   ├── colruyt-scraper.ts
│   │   └── index.ts           # Scraper factory
│   ├── utils/
│   │   ├── logger.ts          # Logging utility
│   │   ├── anti-bot.ts        # Anti-bot maatregelen
│   │   └── output.ts          # Output generators
│   ├── types/
│   │   └── index.ts           # TypeScript types
│   └── index.ts               # Hoofdscript
├── config.json                # Configuratiebestand
├── package.json
└── tsconfig.json
```

## Toekomstige Uitbreidingen

- [ ] Automatische dagelijkse prijsvergelijking
- [ ] E-mail notificaties bij prijsdalingen
- [ ] Dashboard met filters (winkel, productcategorie, datum)
- [ ] SQLite/Supabase integratie voor prijsgeschiedenis
- [ ] React web interface
- [ ] Meer supermarkten (bijv. lokale speciaalzaken)

## Notities

- De scrapers gebruiken Playwright om volledige pagina's te laden
- Anti-bot maatregelen zijn geïmplementeerd om detectie te voorkomen
- Sommige supermarkten kunnen hun HTML structuur wijzigen, waardoor selectors aangepast moeten worden
- Gebruik de tool verantwoord en respecteer de robots.txt van websites

## Licentie

MIT



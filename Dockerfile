FROM mcr.microsoft.com/playwright:focal

WORKDIR /app

COPY package*.json ./
RUN npm ci
# Install matching Chromium for the installed Playwright version
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=0 \
    PORT=3000

EXPOSE 3000

CMD ["npm", "run", "start"]


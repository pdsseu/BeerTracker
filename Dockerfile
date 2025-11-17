FROM mcr.microsoft.com/playwright:focal

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Ensure browsers are installed inside node_modules to match PLAYWRIGHT_BROWSERS_PATH
ENV PLAYWRIGHT_BROWSERS_PATH=0
# Install matching Chromium for the installed Playwright version
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

CMD ["npm", "run", "start"]


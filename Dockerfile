FROM mcr.microsoft.com/playwright:v1.41.1-focal

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=0 \
    PORT=3000

EXPOSE 3000

CMD ["npm", "run", "start"]


FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY lib ./lib
COPY public ./public
COPY server ./server
COPY tests ./tests
COPY server.mjs ./server.mjs
COPY .env.example ./.env.example
COPY README-DEPLOY.md ./README-DEPLOY.md

RUN mkdir -p /data/transaction-photos

ENV PORT=3000
ENV WAREHOUSE_STATE_FILE=/data/warehouse.json

VOLUME ["/data"]

EXPOSE 3000

CMD ["npm", "start"]
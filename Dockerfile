FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY backend ./backend
COPY frontend ./frontend

ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "backend/server.mjs"]

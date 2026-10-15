# The official Cake Defense server (deployed to Fly.io, see fly.toml)
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
COPY build/icon.png ./build/icon.png
EXPOSE 3000
CMD ["node", "server.js"]

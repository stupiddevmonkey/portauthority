FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=127.0.0.1 PORT=8787
COPY package.json ./
COPY src ./src
COPY public ./public
USER node
CMD ["node", "src/server.js"]

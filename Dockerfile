# One image for the two backend services. Select with the command:
#   docker run ... tender npm run server   (Tender API, port 8787)
#   docker run ... tender npm run shop     (Chai & Code demo shop, port 8788)
#   docker run ... tender npm run agent    (the x402 agent, one-off)
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# install exactly the workspace packages the backend needs (no browser build, no Foundry)
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY server/package.json server/
COPY demo-shop/package.json demo-shop/
COPY agent/package.json agent/
COPY app/package.json app/
RUN npm ci --omit=dev --ignore-scripts

COPY packages/core packages/core
COPY server server
COPY demo-shop demo-shop
COPY agent agent
COPY tsconfig.json ./

EXPOSE 8787 8788
CMD ["npm", "run", "server"]

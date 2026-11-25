FROM node:22-alpine
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN npm install
WORKDIR /app/apps/api
CMD ["npx", "tsx", "src/index.ts"]

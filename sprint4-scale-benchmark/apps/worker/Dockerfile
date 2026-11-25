FROM node:22-alpine

# Install Docker CLI so worker replicas spawn isolated sibling sandbox containers
RUN apk add --no-cache docker-cli

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker

RUN npm install

ENV IN_DOCKER=true
ENV SANDBOX_RUNS_ROOT=/tmp-runs

WORKDIR /app/apps/worker
CMD ["npx", "tsx", "src/index.ts"]

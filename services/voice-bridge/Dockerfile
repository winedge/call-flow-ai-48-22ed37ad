FROM oven/bun:1.1-alpine AS base
WORKDIR /app
COPY package.json ./
RUN bun install --frozen-lockfile || bun install
COPY tsconfig.json ./
COPY src ./src
ENV PORT=8080
EXPOSE 8080
CMD ["bun", "run", "src/index.ts"]

FROM oven/bun:1.3-slim

WORKDIR /app

# Install deps first for better layer caching
COPY package.json bun.lock* ./
RUN bun install --production || bun install

COPY . .

ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

# Long-running live tracker (minute-by-minute). Override CMD for menu/scorers jobs.
CMD ["bun", "run", "src/cli.ts", "track"]

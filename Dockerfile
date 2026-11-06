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

# executa app sem privilegio (DS-0002)
RUN groupadd -g 10001 app && useradd -u 10001 -m -g app -s /bin/sh app
USER app

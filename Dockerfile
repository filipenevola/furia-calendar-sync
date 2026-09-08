FROM oven/bun:1.3.2
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
COPY src/ ./src/
COPY scripts/ ./scripts/
CMD ["bun", "run", "src/job.js"]

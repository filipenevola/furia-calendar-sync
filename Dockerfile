FROM oven/bun:latest

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --production --frozen-lockfile

# Copy source code
COPY src/ ./src/

# Expose port
EXPOSE 3000

# Run the server
CMD ["bun", "run", "src/index.js"]

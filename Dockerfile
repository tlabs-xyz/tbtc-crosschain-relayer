# ---- Base ----
# Use a specific Node.js LTS version on Alpine for a smaller image
FROM node:20-alpine AS base
WORKDIR /app
# Install necessary OS packages if any native dependencies require them
# RUN apk add --no-cache g++ make python3 ...

# ---- Dependencies ----
# Install only production dependencies in a separate stage
FROM base AS dependencies
COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile

# ---- Builder ----
# Install all dependencies (including dev) to build the project
FROM base AS builder
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
# Ensure clean build directory
RUN rm -rf dist
RUN yarn build

# ---- Production ----
# Final stage using the lean base image
FROM base AS production
ENV NODE_ENV=production

# Copy necessary artifacts from previous stages
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# Copy package.json (using array syntax)
COPY ["package.json", "./"]

# Optional but recommended: Run as non-root user
# Create a non-root user and group
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs
# Switch to the non-root user
USER nodejs

# Expose the port the main application listens on (from .env or default)
# This is informational; the actual mapping happens in docker-compose.yml
EXPOSE 3000

# The CMD will be provided by docker-compose.yml for each service
# No default CMD here allows flexibility



FROM node:20-alpine3.21 AS development 

# Add this for cache busting
ARG CACHE_BUSTER
RUN echo "Development stage cache buster: ${CACHE_BUSTER}"

WORKDIR /usr/app

# Constrain Node's memory usage during build to avoid OOMs in CI builders
ENV NODE_OPTIONS=--max-old-space-size=2048
# Skip Prisma postinstall generate; we'll run generate during build instead
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1

# Minimal tools for fetching git-based dependencies
RUN apk add --no-cache git && \
    git config --global url."https://".insteadOf git:// && \
    git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" && \
    git config --global url."https://github.com/".insteadOf "git@github.com:"

COPY package.json yarn.lock ./
COPY prisma/ ./prisma/

# Install dependencies only (no scripts) to keep layer reusable
RUN yarn install --frozen-lockfile --production=false --network-concurrency 1 --prefer-offline --ignore-scripts

# Be more specific with COPY for source files
# Adjust these paths if your source structure is different
COPY tsconfig.json ./
COPY index.ts ./
# Assuming your source code is in these folders or similar top-level folders/files
# Add/remove/adjust as per your project structure
# COPY src/ ./src/ # Removed as src/ directory does not exist at project root
COPY helpers/ ./helpers/
COPY services/ ./services/
COPY utils/ ./utils/
COPY controllers/ ./controllers/
COPY handlers/ ./handlers/
COPY interfaces/ ./interfaces/
COPY routes/ ./routes/
COPY config/ ./config/
COPY types/ ./types/
COPY scripts/ ./scripts/
COPY target/ ./target/

# Build after sources are copied, then prune to production deps and clean cache
RUN yarn build \
  && npm prune --omit=dev \
  && yarn cache clean

# Add entrypoint script for running migrations in development stage
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]

FROM node:20-alpine3.21 AS production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/app

# Only need curl for healthcheck; no extra installs necessary
RUN apk add --no-cache curl

# Copy pruned production deps and built app from builder
COPY --from=development /usr/app/package.json ./package.json
COPY --from=development /usr/app/node_modules ./node_modules
COPY --from=development /usr/app/prisma ./prisma
COPY --from=development /usr/app/dist ./dist

# curl is used for HEALTHCHECK. Prisma CLI will be used via npx for DB checks.

ARG APP_PORT=3000
ENV APP_PORT=${APP_PORT}

HEALTHCHECK --interval=5s --timeout=5s --start-period=5s --retries=10 \
  CMD curl -f -v --connect-timeout 3 --max-time 5 http://localhost:${APP_PORT}/status || exit 1

EXPOSE ${APP_PORT}

# Add entrypoint script for running migrations and starting the app
# This COPY should be specific to the final script needed, not the whole scripts/ dir if it contains other dev scripts.
COPY --from=development /usr/app/scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

CMD ["node", "dist/index.js"]



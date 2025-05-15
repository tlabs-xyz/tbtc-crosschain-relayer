FROM node:20-alpine3.21 AS development 

WORKDIR /usr/app

RUN apk add --no-cache git
RUN git config --global url."https://".insteadOf git://

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile --production=false

COPY . .

RUN yarn build

FROM node:20-alpine3.21 AS production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/app


COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile --production=true

COPY --from=development /usr/app/dist ./dist

RUN apk add --no-cache curl

ARG APP_PORT=3000
ENV APP_PORT=${APP_PORT}

HEALTHCHECK --interval=5s --timeout=5s --start-period=5s --retries=10 \
  CMD curl -f -v --connect-timeout 3 --max-time 5 http://localhost:${APP_PORT}/status || exit 1

EXPOSE ${APP_PORT}

CMD ["node", "dist/index.js"]



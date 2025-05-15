FROM node:20-alpine3.16 as development 

WORKDIR /usr/app

RUN apk add --no-cache git
RUN git config --global url."https://".insteadOf git://

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile --production=false

COPY . .

RUN yarn build

FROM node:20-alpine3.16 as production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/app


COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile --production=true

COPY --from=development /usr/app/dist ./dist

CMD ["node", "dist/index.js"]



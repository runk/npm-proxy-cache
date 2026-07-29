FROM node:24-alpine

LABEL maintainer="Dmitry Shirokov <deadrunk@gmail.com>"

ADD package.json /tmp/package.json
ADD package-lock.json /tmp/package-lock.json

RUN cd /tmp && \
    npm ci --omit=dev && \
    mkdir -p /opt/npm-proxy-cache && \
    cp -a /tmp/node_modules /opt/npm-proxy-cache && \
    mkdir -p /opt/npm-proxy-cache/cache

VOLUME /opt/npm-proxy-cache/cache

WORKDIR /opt/npm-proxy-cache
ADD . /opt/npm-proxy-cache

# Expose API port
EXPOSE 8080

ENTRYPOINT ["node", "/opt/npm-proxy-cache/bin/npm-proxy-cache"]

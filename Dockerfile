FROM mhart/alpine-node:8

MAINTAINER Dmitry Shirokov <deadrunk@gmail.com>

ADD package.json /tmp/package.json

RUN cd /tmp && \
    npm install --production && \
    mkdir -p /opt/npm-proxy-cache && \
    cp -a /tmp/node_modules /opt/npm-proxy-cache && \
    mkdir -p /opt/npm-proxy-cache/cache

VOLUME /opt/npm-proxy-cache/cache

WORKDIR /opt/npm-proxy-cache
ADD . /opt/npm-proxy-cache

# Expose API port
EXPOSE 8080

ENTRYPOINT ["node", "/opt/npm-proxy-cache/bin/npm-proxy-cache"]

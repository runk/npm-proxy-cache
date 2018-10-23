
npm-proxy-cache  [![Build Status](https://travis-ci.org/runk/npm-proxy-cache.svg?branch=master)](https://travis-ci.org/runk/npm-proxy-cache)
========

[![Greenkeeper badge](https://badges.greenkeeper.io/runk/npm-proxy-cache.svg)](https://greenkeeper.io/)

HTTP/HTTPS caching proxy for work with `npm` utility. This is **not** a reverse proxy.

You may find this tool useful if you are experiencing huge network lags / latency
problems. Other solutions such as local CoachDB mirror of npm registry require much
more work and maintenance.


## Installation

### npm
    npm install npm-proxy-cache -g

### Docker
The docker image of this repository is not hosted on Docker Hub (yet)

To run npm-proxy-cache as a Docker container, you need to build the image first:

```shell
docker build -t npm-proxy-cache .
```

After building the image successfully, you can run the Docker container. To pass parameters, simply append them to the `docker run` command, like so:

```shell
docker run -t npm-proxy-cache --port 8080 --host 0.0.0.0 --expired
```


## Usage

First of all, you need to configure `npm` to use proxy

```shell
npm config set proxy http://localhost:8080/
npm config set https-proxy http://localhost:8080/
npm config set strict-ssl false
```

Another way is to use it explicitly with `npm install` command, like this:

```shell
npm --proxy http://localhost:8080 --https-proxy http://localhost:8080 --strict-ssl false install
```

The `strict-ssl false` option is required since it's impossible to auth cached response
from https proxy, which actully acts as a MITM (man in the middle). All other than `GET`
requests *are not cached*, so you still be able to publish your modules to npm registry without
switching cache on and off.

Once you have `npm` configured, start the proxy:

```shell
npm-proxy-cache
```

By default proxy starts on `localhost:8080` and have cache ttl 30 mins. These values might be
overriden using command line options:

```text
npm-proxy-cache --help

  Usage: npm-proxy-cache [options]

  Options:

    -h, --host [name]       Hostname [localhost]
    -p, --port [number]     An integer argument [8080]
    -t, --ttl [seconds]     Cache lifetime in seconds [1800]
    -s, --storage [path]    Storage path
    -x, --proxy             HTTP proxy to be used, e.g. http://user:pass@example.com:8888/
    -e, --expired           Use expired cache when npm registry unavailable
    -f, --friendly-names    Use actual file names instead of hashes in the cache
    -v, --verbose           Verbose mode
    -n, --metadata-excluded Exclude metadata requests from caching
    -l, --log-path          Log path
    -m, --internal-port     HTTPs port to use for internal proxying "MITM" server (necessary for running on Windows systems)
    --help                  This help
```

## Why can't I use the built-in npm cache?

Well, for some reason npm cache works not as expected and cache hits are low. Additionally,
CI servers which run on multiply machines may utilize one cache storage which you can provide
via caching proxy.

## Docker

To use a docker container, run:

```shell
curl -sSL https://get.docker.com/ | sh
docker pull folha/npm-proxy-cache
docker run --restart=always --net=host -p 8080:8080 -t folha/npm-proxy-cache --name=npm-proxy-cache
npm --proxy http://npm-proxy-cache:8080 --https-proxy http://npm-proxy-cache:8080 --strict-ssl false install
```

## Limitations

 - Works only with node `6` and above.


----

Any feedback is welcome

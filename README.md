
npm-proxy-cache
========

HTTP/HTTPS caching proxy for work with `npm` utility. This is **not** a reverse proxy.

You may find this tool useful if you are experiencing huge network lags / latency
problems. Other solutions such as local CoachDB mirror of npm registry require much
more work and maintenance.


## Installation

    npm install npm-proxy-cache -g


## Usage

First of all, you need to configure `npm` to use proxy

    $ npm config set proxy http://localhost:8080/
    $ npm config set https-proxy http://localhost:8080/
    $ npm config set strict-ssl false

Another way is to use it explicitly with `npm install` command, like this:

    $ npm --proxy http://localhost:8080 --https-proxy http://localhost:8080 --strict-ssl false install

The `strict-ssl false` option is required since it's impossible to auth cached response
from https proxy, which actully acts as a MITM (man in the middle). All other than `GET`
requests *are not cached*, so you still be able to publish your modules to npm registry without
switching cache on and off.

Once you have `npm` configured, start the proxy:

    $ npm-proxy-cache

By default proxy starts on `localhost:8080` and have cache ttl 30 mins. These values might be
overriden using command line options:

    $ npm-proxy-cache --help

      Usage: npm-proxy-cache [options]

      Options:

        -h, --help            output usage information
        -V, --version         output the version number
        -h, --host [name]     Hostname [localhost]
        -p, --port [number]   An integer argument [8080]
        -t, --ttl [seconds]   Cache lifetime in seconds [1800]
        -s, --storage [path]  Storage path
        -v, --verbose         Verbose mode
        -x, --proxy           HTTP proxy to be used, e.g. http://user:pass@example.com:8888/


## Why can't I use the built-in npm cache?

Well, for some reason npm cache works not as expected and cache hits are low. Additionally,
CI servers which run on multiply machines may utilize one cache storage which you can provide
via caching proxy.


## Limitations

Works only with node `0.10` and above.


----

Any feedback is welcome

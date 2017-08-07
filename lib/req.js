"use strict";
require("colors");
const log = require("loglevel");
const request = require("request");

(function monkeypatchstuffandstuff() {
  const rget = request.get;
  request.get = function(opts, shouldAbort, ...args) {
    let attempt = 0;
    const uri = opts.uri || opts.url || opts;
    log.debug("Getting", uri.bold);
    const gogetter = function (res, rej, opts, ...args) {
      rget.call(this, opts, ...args, (err, resp, body) => {
        const status = (resp && resp.statusCode) || 0;
        if (!err && status !== 200) {
          if (status === 404) {
            err = new Error("Not Found".red + ": " + uri);
            err.status = status;
          }
          else {
            err = new Error(`Invalid status: ${status}`.bold.red + ": " + uri);
            err.status = status;
          }
        }
        if (err) {
          if (err.status >= 400 && err.status !== 404 && attempt++ < 6 &&
             (!shouldAbort || !shouldAbort())) {
            log.error("Attempt".yellow, attempt, "on", uri, "due to",
              err.toString().red);
            return setTimeout(() => {
              gogetter.call(this, res, rej, opts, ...args);
            }, attempt * 500);
          }
          return rej(err);
        }
        res({ resp, body });
      });
    };
    return new Promise((res, rej) => {
      gogetter.call(this, res, rej, opts, ...args);
    });
  };
})();

const basereq = request.defaults({
  headers: {
    "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_3) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/49.0.2623.87 Safari/537.36",
    "Accept-Encoding": "deflate;q=0.9, *;q=0.8",
  },
  timeout: 20 * 1000,
  strictSSL: true,
});
const jsonreq = basereq.defaults({ json: true });
const binreq = basereq.defaults({ encoding: null });

module.exports = {
  jsonreq,
  binreq
};

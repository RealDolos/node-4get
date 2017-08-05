"use strict";

if (!Promise.prototype.finally) {
  Object.assign(Promise.prototype, {
    finally(cb) {
      return this.then(cb, cb);
    }
  });
}

function ensureArray(arg) { return Array.isArray(arg) ? arg : [arg]; }

function sleep(timeout) {
  let id;
  let ores;
  return Object.assign(
    new Promise(res => id = setTimeout((ores = res), timeout)),
    {
      cancel: function() {
        clearTimeout(id);
        ores();
      }
    });
}

function awaitErrRes(fn, ...args) {
  return new Promise((res, rej) => fn(...args, (err, rv) => {
    if (err) {
      return rej(err);
    }
    res(rv);
  }));
}

const UNITS = Object.freeze(["B", "K", "M", "G", "T", "P", "E", "Z"]);
const ULEN = UNITS.length;

function filesize(size) {
  const neg = size < 0 ? "-" : "";
  size = Math.abs(size);
  let u = 0;
  while (size > 900 && u + 1 < ULEN) {
    size /= 1024;
    u++;
  }
  if (u) {
    if (size >= 100) {
      size = size.toFixed(1);
    }
    else {
      size = size.toFixed(2);
    }
  }
  return `${neg}${size}${UNITS[u]}`;
}

module.exports = {
  ensureArray,
  sleep,
  awaitErrRes,
  filesize
};

"use strict";

function nothing() {}

if (!Promise.prototype.finally) {
  Object.assign(Promise.prototype, {
    finally(cb) {
      return this.then(res => {
        const rv = cb.call();
        return Promise.resolve(rv).then(() => res);
      } , e => {
        const rv = cb.call();
        return Promise.resolve(rv).then(() => Promise.reject(e));
      });
    }
  });
}

if (!Promise.prototype.ignore) {
  Object.assign(Promise.prototype, {
    ignore() {
      return this.catch(nothing);
    }
  });
}

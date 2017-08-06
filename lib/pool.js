"use strict";

class PromisePool {
  constructor(limit) {
    this._limit = Math.max(limit || 5, 1);
    this._items = [];
    this._running = 0;
    this._next = this.next.bind(this);
    Object.seal(this);
  }
  get limit() {
    return this._limit;
  }
  get running() {
    return this._running;
  }
  get scheduled() {
    return this._items.length;
  }
  get total() {
    return this.scheduled + this.running;
  }
  schedule(fn) {
    if (this._running < this.limit) {
      try {
        const p = fn();
        this._running++;
        p.finally(this._next).ignore();
        return p;
      }
      catch (ex) {
        return Promise.reject(ex);
      }
    }
    const item = { fn };
    const rv = new Promise((res, rej) => {
      item.res = res;
      item.rej = rej;
    });
    this._items.push(item);
    return rv;
  }
  next() {
    this._running--;
    const item = this._items.shift();
    if (!item) {
      return;
    }
    try {
      const p = item.fn.call();
      this._running++;
      item.res(p);
      p.finally(this._next).ignore();
    }
    catch (ex) {
      console.log("caught");
      try {
        item.rej(ex);
      }
      finally {
        this.next();
      }
    }
  }
}

module.exports = {
  PromisePool
};

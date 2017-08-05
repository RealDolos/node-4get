"use strict";

class Pool {
  constructor(limit) {
    this.limit = limit || 5;
    this.items = [];
    this.running = 0;
    this._next = this.next.bind(this);
    Object.seal(this);
  }
  schedule(fn) {
    if (this.running < this.limit) {
      const p = fn();
      this.running++;
      p.finally(this._next);
      return p;
    }
    const item = { fn };
    const rv = new Promise(res => {
      item.res = res;
    });
    this.items.push(item);
    return rv;
  }
  next() {
    this.running--;
    const item = this.items.shift();
    if (!item) {
      return;
    }
    const p = item.fn.call();
    this.running++;
    item.res(p);
    p.finally(this._next);
  }
}

module.exports = {
  Pool
};

"use strict";

class WaitSet extends Set {
  constructor() {
    super();
  }
  add(promise) {
    super.add(promise);
    promise.finally(() => super.delete(promise)).ignore();
    return promise;
  }
  join() {
    return Promise.all(Array.from(this));
  }
}

module.exports = { WaitSet };

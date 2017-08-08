"use strict";

require("mocha");
require("should");

describe("PromisePool", () => {
  const {PromisePool} = require("../lib/pool");
  const pool1 = new PromisePool();
  const pool2 = new PromisePool(1);
  const pool3 = new PromisePool(0);
  const pools = [pool1, pool2, pool3];
  const ITER = 20;
  pools.forEach(pool => {
    it("empty", () => {
      pool.running.should.equal(0);
      pool.scheduled.should.equal(0);
      pool.total.should.equal(0);
    });
    it("run some", () => {
      function* gensome() {
        for (let i = 0; i < ITER; ++i) {
          yield () => Promise.resolve(i + 1);
        }
      };
      let count = 0, sum = 0;
      const all = Array.from(gensome()).map(e => pool.schedule(e));
      all.forEach(e => e.then(v => { count++; sum += v; }));
      pool.running.should.not.equal(0);
      pool.scheduled.should.not.equal(0);
      pool.total.should.not.equal(0);
      pool.scheduled.should.not.equal(pool.running);
      pool.scheduled.should.not.equal(pool.total);
      return Promise.all(all).then(() => {
        count.should.equal(ITER);
        sum.should.equal(ITER * (ITER + 1) / 2);
      });
    });
    it("run some rejections", () => {
      function* gensome() {
        for (let i = 0; i < ITER; ++i) {
          yield () => Promise.reject(i + 1);
        }
      };
      let count = 0, sum = 0;
      let all = Array.from(gensome()).map(e => pool.schedule(e));
      all = all.map(e => e.catch(v => { count++; sum += v; }));
      pool.running.should.not.equal(0);
      pool.scheduled.should.not.equal(0);
      pool.total.should.not.equal(0);
      pool.scheduled.should.not.equal(pool.running);
      pool.scheduled.should.not.equal(pool.total);
      return Promise.all(all).then(() => {
        count.should.equal(ITER);
        sum.should.equal(ITER * (ITER + 1) / 2);
      });
    });
    it("run some exception", () => {
      function* gensome() {
        for (let i = 0; i < ITER; ++i) {
          yield () => { let rv = new Error(i); rv.res = i + 1; throw rv; };
        }
      };
      let count = 0, sum = 0;
      let all = Array.from(gensome()).map(e => pool.schedule(e));
      all = all.map(e => e.catch(v => { count++; sum += v.res; }));
      return Promise.all(all).then(() => {
        count.should.equal(ITER);
        sum.should.equal(ITER * (ITER + 1) / 2);
      });
    });
    it("run some wrapped", () => {
      const towrap = new class ToWrap {
        constructor(val) { this.val = 0; }
        error(val) {
          this.val++;
          return val + this.val;
        }
      }("k");
      let wrapped = pool.wrap(towrap, towrap.error);
      function* gensome() {
        for (let i = 0; i < ITER; ++i) {
          yield wrapped(i);
        }
      };
      let count = 0;
      let all = Array.from(gensome());
      all = all.map(e => e.then(v => { count++; return v; }));
      pool.running.should.not.equal(0);
      pool.scheduled.should.not.equal(0);
      pool.total.should.not.equal(0);
      pool.scheduled.should.not.equal(pool.running);
      pool.scheduled.should.not.equal(pool.total);
      return Promise.all(all).then(v => {
        v.forEach((e, i) => e.should.equal(i * 2 + 1));
        count.should.equal(ITER);
      });
    });
    it("run some wrapped and exception", () => {
      const towrap = new class ToWrap {
        constructor(val) { this.val = val; }
        error(val) {
          val += this.val; let err =  new Error(val); err.val = val; throw err;
        }
      }("k");
      let wrapped = pool.wrap(towrap, towrap.error);
      function* gensome() {
        for (let i = 0; i < ITER; ++i) {
          yield wrapped("o");
        }
      };
      let count = 0;
      let all = Array.from(gensome());
      all = all.map(e => e.catch(v => { count++; return v.val; }));
      return Promise.all(all).then(v => {
        v.forEach(i => i.should.equal("ok"));
        count.should.equal(ITER);
      });
    });
    it("empty again", () => {
      pool.running.should.equal(0);
      pool.scheduled.should.equal(0);
      pool.total.should.equal(0);
    });
  });
  it("run some wrappedNew and exception", () => {
    const towrap = new class ToWrap {
      constructor(val) { this.val = val; }
      error(val) {
        val += this.val; let err =  new Error(val); err.val = val; throw err;
      }
    }("k");
    let wrapped = PromisePool.wrapNew(2, towrap, towrap.error);
    function* gensome() {
      for (let i = 0; i < ITER; ++i) {
        yield wrapped("o");
      }
    };
    let count = 0;
    let all = Array.from(gensome());
    all = all.map(e => e.catch(v => { count++; return v.val; }));
    return Promise.all(all).then(v => {
      v.forEach(i => i.should.equal("ok"));
      count.should.equal(ITER);
    });
  });
});

"use strict";

require("mocha");
require("should");

describe("PromisePool", () => {
  const {PromisePool} = require("../lib/pool");
  const pool1 = new PromisePool();
  const pool2 = new PromisePool(1);
  const pool3 = new PromisePool(0);
  const pools = [pool1, pool2, pool3];
  pools.forEach(pool => {
    it("empty", () => {
      pool.running.should.equal(0);
      pool.scheduled.should.equal(0);
      pool.total.should.equal(0);
    });
    it("run some", () => {
      function* gensome() {
        for (let i = 0; i < 100; ++i) {
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
        count.should.equal(100);
        sum.should.equal(5050);
      });
    });
    it("run some rejections", () => {
      function* gensome() {
        for (let i = 0; i < 100; ++i) {
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
        count.should.equal(100);
        sum.should.equal(5050);
      });
    });
    it("run some exception", () => {
      function* gensome() {
        for (let i = 0; i < 100; ++i) {
          yield () => { let rv = new Error(i); rv.res = i + 1; throw rv; };
        }
      };
      let count = 0, sum = 0;
      let all = Array.from(gensome()).map(e => pool.schedule(e));
      all = all.map(e => e.catch(v => { count++; sum += v.res; }));
      return Promise.all(all).then(() => {
        count.should.equal(100);
        sum.should.equal(5050);
      });
    });
    it("empty again", () => {
      pool.running.should.equal(0);
      pool.scheduled.should.equal(0);
      pool.total.should.equal(0);
    });
  });
});

"use strict";

require("mocha");
require("should");

describe("Promise.finally", () => {
  function N() {}
  function T() {
    throw "ok";
  }
  function O(v) {
    return Promise.resolve(v || "ok");
  }
  function R(v) {
    return Promise.reject(v || "ok");
  }

  require("../lib/finally");

  it("exists", () => {
    Promise.prototype.should.have.property("finally");
  });

  it("resolve", () => {
    return O().finally(N).then(e => e.should.equal("ok"));
  });
  it("resolve other p", () => {
    return O().finally(O("nok")).then(e => e.should.equal("ok"));
  });
  it("reject", () => {
    return R().finally(N).catch(e => e.should.equal("ok"));
  });
  it("reject other p", () => {
    return R().finally(O("nok")).catch(e => e.should.equal("ok"));
  });
  it("reject other plain", () => {
    return R().finally("ok").catch(e => e.should.equal("ok"));
  });
  it("throw", () => {
    return O().finally(N).catch(e => e.should.equal("ok"));
  });

  it("finally rejects", () => {
    return O("nok").finally(R).catch(e => e.should.equal("ok"));
  });
  it("finally throws", () => {
    return O("nok").finally(R).catch(e => e.should.equal("ok"));
  });

  it("reject and finally rejects", () => {
    return R("nok").finally(R).catch(e => e.should.equal("ok"));
  });
  it("reject and finally rejects", () => {
    return R("nok").finally(R).catch(e => e.should.equal("ok"));
  });
  it("reject and finally throws", () => {
    return R("nok").finally(T).catch(e => e.should.equal("ok"));
  });
  it("reject and finally rejects w/ promise", () => {
    return R("nok").finally(R()).catch(e => e.should.equal("ok"));
  });
  it("reject and finally plain", () => {
    return R("ok").finally("nok").catch(e => e.should.equal("ok"));
  });
});

describe("Promise.ignore", () => {
  require("../lib/finally");

  it("exists", () => {
    Promise.prototype.should.have.property("ignore");
  });

  it("works", () => {
    return Promise.reject().ignore();
  });
  it("works after finally", () => {
    return Promise.reject("oK").finally(() => {}).ignore();
  });
});

"use strict";

require("mocha");
require("should");

describe("util.sanitizeNameWin", () => {
  const {sanitizeNameWin:s} = require("../lib/util");
  const t = function t(name, str, exp) {
    if (typeof(exp) === "string") {
      it(name, () => s(str).should.equal(exp));
    }
    else {
      it(name, () => exp(s(str)));
    }
  };
  const nt = function nt(name, str, exp) {
    t(name, str, e => e.should.not.equal(exp || str));
  }
  t("normal1", "a", "a");
  t("normal2", "a".repeat(3), "a".repeat(3));
  t("trim1", " a ".repeat(3), "a a a");
  t("trim2", "- a \t b _", "a b");
  t("trunc", "ab".repeat(1000), e => e.length.should.equal(250));

  nt("special1", "- com5 ");
  nt("special2", "- com5 ", "com5");
  nt("special3", "nul");
  nt("special4", "Prn");
  nt("special5", "CON");

  nt("invalid", ":?*<>\"|");
  for (const c of ":?*<>\"|") {
    nt(`ìnvalid${c}1`, c);
    nt(`ìnvalid${c}2`, " a " + c + "b");
    t(`ìnvalid${c}3`, c + " a " + c.repeat(3) + "b" + c,
      e => e.includes(c).should.not.be.ok());
    t(`invalid${c}4`, ":?*<>\"|".repeat(3),
      e => e.includes(c).should.not.be.ok());
    t(`invalid${c}5`, "a:b?c*d<e>f\"g|h".repeat(3),
      e => e.includes(c).should.not.be.ok());
  }
});

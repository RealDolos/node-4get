#!/usr/bin/env node
"use strict";

// you gotta install those m8
require("colors");
const minimist = require("minimist");
const log = require("loglevel");

const {Runner} = require("./lib/runner");
const {ensureArray} = require("./lib/util");

if (process.platform === "win32") {
  // kek, windows
  require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
  }).on("SIGINT", function() {
    process.emit("SIGINT");
  });
}

(async function main() {
  const args = minimist(process.argv.slice(2), {
    "--": true,
    boolean: ["help", "h"],
    alias: {h: "help", b: "board", l: "loglevel",},
  });

  if (args.help) {
    log.setLevel("info");
    log.info("node", process.argv[1].rainbow,
      "--board".yellow, "b", "--board".yellow, "soc",
      "b/thread/11111111".red, "a/thread/12345".red);
    log.info("");
    log.info("If you wanna monitor boards, use --board, otherwise plain");
    log.info("Mix and mingle both");
    process.exit(1);
  }
  if (args.version) {
    log.setLevel("info");
    log.info(require('./package.json').version);
    process.exit(1);
  }
  require("v8").setFlagsFromString(
    "--optimize_for_size --max_old_space_size=128")

  log.setLevel(args.loglevel || "info");
  const runner = new Runner(args);
  const waiting = [];
  if (args.board && args.board.length) {
    waiting.push(runner.monitor(ensureArray(args.board)));
  }
  if (args._ && args._.length) {
    for (const thread of ensureArray(args._)) {
      const [board, _, no] = thread.split("/");
      waiting.push(runner.process(board, no));
    }
  }
  const cancel = function() {
    log.warn("\rCancel requested".bold.yellow);
    runner.cancel();
  };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  process.on("SIGQUIT", cancel);
  await Promise.all(waiting);
  await runner.close();
})().then(rv => {
  log.error("kthxbai".bold.red);
  process.exit(rv || 0);
}, ex => {
  log.error("Shit hit the literal fan", ex);
  process.exit(1);
});

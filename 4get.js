#!/usr/bin/env node
"use strict";

console.debug = console.log;

// you gotta install those m8
require("colors");
const minimist = require("minimist");
const log = require("loglevel");

const {Runner} = require("./lib/runner");
const {ensureArray, extractThread} = require("./lib/util");

if (process.platform === "win32") {
  // kek, windows
  require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
  }).on("SIGINT", function() {
    process.emit("SIGINT");
  });
}

function usage() {
  log.info("node", process.argv[1].rainbow,
    "--board".yellow, "b".red, "-b".yellow, "soc".red,
    "-m".yellow, "b/thread/11111111".red, "a/thread/12345".green);
  log.info("");
  log.info("\t-b, --board".yellow, "\t\tMonitor a board (multiple possible)");
  log.info(
    "\t-m, --monitor".yellow, "\t\tMonitor a thread (multiple possible)");
  log.info("\t--version".yellow, "\t\tPrint version and exit");
  log.info("\t--black".yellow, "\t\tProvide your own blacklist");
  log.info("\t-w, --win".yellow, "\t\tForce names to be valid Windows names");
  log.info("\t-c, --no-convert".yellow, "\tDo not convert pngs");
  log.info(
    "\t-l, --loglevel".yellow,
    "\t\tSet a log level (silent, error, warn, info, debug)");
  log.info("\t-v".yellow, "\t\t\tShortcut for --loglevel debug");
  log.info(
    "\t[other]".green, "\t\tsuck the thread one (multiple possible");
  log.info("");
}

(async function main() {
  const args = minimist(process.argv.slice(2), {
    "--": true,
    boolean: ["help", "h", "v", "win"],
    alias: {
      h: "help",
      b: "board",
      l: "loglevel",
      m: "monitor",
      c: "no-convert",
      w: "win",
    },
  });

  log.setLevel("info");
  if (args.help) {
    usage();
    process.exit(1);
  }
  if (args.version) {
    log.info(require("./package.json").version);
    process.exit(1);
  }
  if (args.v) {
    args.loglevel = "debug";
  }
  args.convert = !args.c;
  log.setLevel(args.loglevel || "info");

  log.debug("Initializing v8");
  require("v8").setFlagsFromString(
    "--optimize_for_size --max_old_space_size=128");

  log.debug("Spawning runner");
  const runner = new Runner(args);
  const waiting = [];
  if (args.board && args.board.length) {
    waiting.push(runner.monitorBoards(ensureArray(args.board)));
  }
  if (args.monitor && args.monitor.length) {
    waiting.push(runner.monitorThreads(ensureArray(args.monitor)));
  }
  if (args._ && args._.length) {
    for (const thread of ensureArray(args._).map(extractThread)) {
      waiting.push(runner.process(thread.board, thread.no));
    }
  }
  const cancel = function() {
    log.warn("\rCancel requested".bold.yellow);
    runner.cancel();
  };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  process.on("SIGQUIT", cancel);
  log.debug("Waiting for tasks to finish");
  await Promise.all(waiting);
  log.debug("Waiting for runner to go down");
  await runner.close();
  runner.printStats();
})().then(rv => {
  log.error("kthxbai".bold.red);
  process.exit(rv || 0);
}, ex => {
  log.error("Shit hit the literal fan", ex);
  process.exit(1);
});

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
  const options = {
    "-b, --board": "Monitor a board (multiple possible)",
    "--black": "Provide your own blacklist",
    "-c, --no-convert": "Do not convert pngs",
    "-j, --jobs": "How many medias to get in parallel",
    "-l, --loglevel": "Set a log level (silent, error, warn, info, debug)",
    "-m, --monitor": "Monitor a thread (multiple possible)",
    "[other]": "suck the thread one (multiple possible",
    "--version": "Print version and exit",
    "-v": "Shortcut for --loglevel debug",
    "-w, --win": "Force names to be valid Windows names",
  };
  const args = Object.keys(options);
  const sk = k => k.replace(/-/g, "").replace("[", String.fromCharCode(255));
  args.sort((a, b) => sk(a) > sk(b));
  const max = args.reduce((p, c) => Math.max(c.length, p), 0);
  log.info("");
  for (const a of args) {
    log.info(" ", a.yellow, " ".repeat(max  - a.length + 2), options[a].bold);
  }
  log.info("");
  log.info("For more information contact your local EFF BEE AYY agent".
    magenta.bold);
}

(async function main() {
  const args = minimist(process.argv.slice(2), {
    "--": true,
    boolean: ["help", "h", "v", "win"],
    alias: {
      b: "board",
      c: "no-convert",
      h: "help",
      j: "jobs",
      l: "loglevel",
      m: "monitor",
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
    process.exit(0);
  }
  if (args.v) {
    args.loglevel = "debug";
  }
  if (args.jobs) {
    args.jobs = parseInt(args.jobs, 10);
    if (!isFinite(args.jobs) || args.jobs <= 1) {
      throw new Error("Invalid --jobs");
    }
    args.jobs = Math.floor(args.jobs);
  }
  else {
    args.jobs = Math.max(1, Math.min(require("os").cpus().length * 4, 8));
  }
  args.convert = !args.c;
  log.setLevel(args.loglevel || "info");

  log.debug("Initializing v8", process.versions);
  require("v8").setFlagsFromString(
    "--optimize_for_size --max_old_space_size=96");

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

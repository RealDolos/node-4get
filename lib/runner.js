"use strict";

const fs = require("fs");
const path = require("path");

require("colors");
const log = require("loglevel");
const sharp = require("sharp");
const Level = require("levelup");
const LRU = require("lru-cache");
const mkdirp = require("mkdirp");

const {PromisePool} = require("./pool");
const {WaitSet} = require("./waitset");
const {jsonreq, binreq} = require("./req");
const {
  awaitErrRes,
  ensureArray,
  extractThread,
  filesize,
  sanitizeName,
  sanitizeNameWin,
  sleep,
} = require("./util");

class Pools {
  constructor(jobs, convert) {
    this.thread = new PromisePool(2);
    this.media = new PromisePool(jobs);
    this.write = new PromisePool(1);
    if (convert) {
      this.convert = new PromisePool(1);
    }
  }
}

class Timers extends WaitSet {
  new(timeout) {
    return this.add(sleep(timeout));
  }
  cancel() {
    for (const timer of Array.from(this)) {
      timer.cancel();
    }
  }
}

class Inflight extends Map {
  ensureQueue(queue) {
    return this.get(queue) || this.set(queue, new Set()).get(queue);
  }
  add(queue, value) {
    this.ensureQueue(queue).add(value);
    return this;
  }
  delete(queue, value) {
    return this.ensureQueue(queue).delete(value);
  }
  has(queue, value) {
    return this.ensureQueue(queue).has(value);
  }
}

class Stats {
  constructor() {
    this.files = this.bytes = 0;
  }
  track(bytes) {
    this.bytes += bytes;
    this.files++;
  }
}

const MEDIA = Symbol();
const THREADS = Symbol();
const CANCELLED = Symbol();

const JPEG_OPTS = { quality: 90, force: true };
const WRITE_OPTS = Object.freeze({ flag: "wx", encoding: null });


class Runner {
  constructor(options) {
    log.debug("Opening hashes database");
    this.db = new Level(".hashes");
    this.dbget = this.db.get.bind(this.db);
    this.dbput = this.db.put.bind(this.db);

    log.debug("General setup");
    this.BLACKED = new LRU(20*20);
    this[CANCELLED] = { v: false }; // need an object due to freeze()
    this.inflight = new Inflight();
    this.lasts = new LRU(500 * 20);
    this.shouldAbort = () => this.cancelled;
    this.stats = new Stats();
    this.timers = new Timers();

    if (options.black) {
      const black = ensureArray(options.black);
      if (black.length > 1 || black[0].length) {
        this.black = new RegExp(black.join("|"), "i");
      }
      else {
        this.black = null;
      }
    }
    else {
      this.black = this.BLACK;
    }
    this.convert = !(options.convert === false);
    this.min = options.min || 850;
    this.sanitizeName = (process.platform === "win32" || options.win) ?
      sanitizeNameWin :
      sanitizeName;
    this.pools = new Pools(options.jobs || 8, this.convert);

    Object.freeze(this);
    log.debug(`Runner with ${this.pools.media.limit} jobs ready`);
  }
  get cancelled() {
    return this[CANCELLED].v;
  }
  async close() {
    await awaitErrRes(this.db.close.bind(this.db));
  }
  cancel() {
    this.timers.cancel();
    if (this.cancelled) {
      return;
    }
    this[CANCELLED].v = true;
  }
  checkBlack(str) {
    if (!str || !this.black) {
      return false;
    }
    return this.black.test(str);
  }
  async known(md5) {
    if (this.inflight.has(MEDIA, md5)) {
      return true;
    }
    try {
      await awaitErrRes(this.dbget, md5);
      return true;
    }
    catch (ex) {
      // fall through
    }
    return this.inflight.has(MEDIA, md5); // double check against inflight
  }
  getMedia(post) {
    return this.pools.media.schedule(this[MEDIA].bind(this, post));
  }
  async [MEDIA](post) {
    if (this.cancelled) {
      return;
    }
    const start = Date.now();
    const {md5, board, thread, tim, sem} = post;
    let {filename, ext} = post;
    if (await this.known(md5)) {
      // we already know about this
      return;
    }
    this.inflight.add(MEDIA, md5);
    try {
      const url = `https://i.4cdn.org/${board}/${tim}${ext}`;
      let {body} = await binreq.get(url, this.shouldAbort);
      if (this.convert && ext.toLowerCase() === ".png") {
        try {
          await this.pools.convert.schedule(async () => {
            const nbody = await sharp(body).jpeg(JPEG_OPTS).toBuffer();
            if (body.length < nbody.length) {
              return;
            }
            log.debug("Coverted".magenta, filename,
              `(${filesize(body.length)} -> ${filesize(body.length)})`.bold,
              `${filesize(body.length - body.length)} saved`.dim.yellow);
            body = nbody;
            ext = ".jpg";
          });
        }
        catch (ex) {
          log.error("Failed to convert", filename.bold,
            "because", ex.toString().red);
        }
      }

      try { filename = decodeURIComponent(filename); } catch (ex) { /* meh */ }
      filename = `${this.sanitizeName(filename)}${ext}`;
      const dir = path.join(".", "thread", board,
        thread.slice(-2, -1), thread.slice(-1), this.sanitizeName(sem));
      let file = path.join(dir, filename);
      const filebase = file;

      await this.pools.write.schedule(() => awaitErrRes(mkdirp, dir));
      for (let i = 1;; ++i) {
        try {
          await this.pools.write.schedule(
            () => awaitErrRes(fs.writeFile.bind(fs, file, body, WRITE_OPTS)));
          await awaitErrRes(this.dbput, md5, "");
          log.info("Saved".green, file.bold, filesize(body.length).yellow,
            "in", `${((Date.now() - start) / 1000).toFixed(1)}s`.dim.yellow);
          this.stats.track(body.length);
          if (this.files % 250) {
            this.printStats();
          }
          break;
        }
        catch (ex) {
          if (ex.code !== "EEXIST" && ex.code !== "ENOENT") {
            throw ex;
          }
          const parsed = path.parse(filebase);
          delete parsed.base;
          if (ex.code === "EEXIST") {
            parsed.name = `${parsed.name} (${i})`;
          }
          else {
            // Name is too long, so truncate a bit
            parsed.name = parsed.name.slice(0, -2);
            if (!parsed.name) {
              throw Error("Cannot truncate: " + file);
            }
          }
          file = path.format(parsed);
          log.debug("Changed to", file.yellow);
        }
      }
    }
    finally {
      this.inflight.delete(MEDIA, post.md5);
    }
  }
  async json(url) {
    const headers = {};
    const last = this.lasts.get(url);
    if (last) {
      headers["If-None-Match"] = last;
    }
    const {resp, body} = await jsonreq.get(
      { url, headers }, this.shouldAbort);
    this.lasts.set(url, resp.headers["etag"]);
    return { resp, body };
  }
  process(board, no, checkblack) {
    if (this.inflight.has(THREADS, no)) {
      return Promise.resolve();
    }
    this.inflight.add(THREADS, no);
    return this.pools.thread.schedule(
      this[THREADS].bind(this, board, no, checkblack));
  }
  async [THREADS](board, no, checkblack) {
    let body;
    try {
      const url = `https://a.4cdn.org/${board}/thread/${no}.json`;
      if (this.cancelled || (checkblack && this.BLACKED.get(no))) {
        return;
      }
      body = (await this.json(url)).body;
    }
    catch (ex) {
      if (ex.status === 304) {
        return;
      }
      throw ex;
    }
    finally {
      this.inflight.delete(THREADS, no);
    }
    const posts = body.posts.filter(post => post.ext);
    const first = posts[0];
    if (checkblack && (
      this.checkBlack(first.semantic_url) || this.checkBlack(first.com))) {
      this.BLACKED.set(no, no);
      return;
    }

    log.info("Hot thread".magenta, `${board}/thread/${no}`.bold,
      "with", `${posts.length} media posts`.dim.yellow);
    const waiting = new WaitSet();
    for (const post of posts) {
      if (this.cancelled) {
        break;
      }
      const ext = post.ext.toLowerCase();
      if (ext == ".gif") {
        // nobody likes gifs, it's 2017 people
        continue;
      }
      if (this.SMALL.has(ext) && Math.max(post.w, post.h) < this.min) {
        // nobody likes small shit
        continue;
      }
      Object.assign(post, {
        board,
        thread: no.toString(),
        sem: `${no} - ${first.semantic_url}`.substr(0, 60).trim()
      });
      waiting.add(this.getMedia(post).catch(log.error));
    }
    return waiting.join();
  }
  async monitorThreads(threads) {
    log.info("Gonna monitor threads:", threads.join(", ").bold);
    threads = threads.map(extractThread);
    const waiting = new WaitSet();
    while (!this.cancelled) {
      for (const thread of threads) {
        if (this.cancelled) {
          break;
        }
        waiting.add(
          this.process(thread.board, thread.no, false)).catch(log.error);
      }
      if (!this.cancelled) {
        await this.timers.new(20 * 1000);
      }
    }
    return waiting.join();
  }
  async monitorBoards(boards) {
    boards = boards.map(e => {
      try {
        return extractThread(e).board;
      }
      catch (ex) {
        return e;
      }
    });
    log.info("Gonna monitor boards:", boards.join(", ").bold);
    const threads = LRU(500 * boards.length);
    const waiting = new WaitSet();
    while (!this.cancelled) {
      for (const board of boards) {
        if (this.cancelled) {
          break;
        }
        try {
          const url = `https://a.4cdn.org/${board}/threads.json`;
          const {body} = await this.json(url);
          for (const page of body) {
            for (const thread of page["threads"]) {
              if (this.cancelled) {
                break;
              }
              const no = thread.no;
              const threadLast = threads.get(no);
              if (threadLast === thread.last_modified) {
                continue;
              }
              threads.set(no, thread.last_modified);
              waiting.add(this.process(board, no, true)).catch(log.error);
            }
          }
        }
        catch (ex) {
          if (ex.status === 304) {
            log.debug("Board", board, "did not change");
            continue;
          }
          log.error(board, ex);
          await this.timers.new(1000);
        }
      }
      if (!this.cancelled) {
        await this.timers.new(10 * 1000);
      }
    }
    return waiting.join();
  }
  printStats() {
    log.info("Saved".green, `${this.stats.files} files`.bold.green,
      `(${filesize(this.stats.bytes)})`.green);
  }
}
Runner.prototype.BLACK = /r(?:ule\s*)?34|japan|dick.?rate|(?:dick|cock).+rate|chat.?discuss|twink|gore|spider|wallp|^.?fur|fur.thread|fur.*read|furry|fluffy|shota|rekt thr|ylyl|drawt|trap|loli|hentai|banana|gladio/i;
Runner.prototype.SMALL = new Set([".jpg", ".jpe", ".jpeg", ".png"]);

module.exports = {
  Runner
};

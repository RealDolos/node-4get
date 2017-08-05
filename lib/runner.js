"use strict";

const fs = require("fs");
const path = require("path");

require("colors");
const log = require("loglevel");
const sharp = require("sharp");
const Level = require("levelup");
const LRU = require("lru-cache");
const mkdirp = require("mkdirp");

const {Pool} = require("./pool");
const {jsonreq, binreq} = require("./req");
const {
  filesize,
  sleep,
  ensureArray,
  extractThread,
  awaitErrRes
} = require("./util");

class Runner {
  constructor(options) {
    log.debug("Opening hashes database");
    this.db = new Level(".hashes");
    log.debug("General setup");
    this.dbget = this.db.get.bind(this.db);
    this.dbput = this.db.put.bind(this.db);
    this.inflight = new Set();
    this.inflightThreads = new Set();
    this.BLACKED = new LRU(20*20);
    this.lasts = new LRU(500 * 20);
    this.running = 0;
    this.threadpool = new Pool(2);
    this.mediapool = new Pool(8);
    this.writepool = new Pool(1);
    if (options.black) {
      options.black = ensureArray(black);
      if (options.black.length > 1 || black[0].length) {
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
    if (this.convert) {
      this.convertpool = new Pool(1);
    }
    this.cancelled = false;
    this.timerMB = null;
    this.timerMT = null;
    this.shouldAbort = () => this.cancelled;
    Object.seal(this);
    log.debug("Runner ready");
  }
  async close() {
    await awaitErrRes(this.db.close.bind(this.db));
  }
  cancel() {
    if (this.timerMT) {
      this.timerMT.cancel();
    }
    if (this.timerMB) {
      this.timerMB.cancel();
    }
    if (this.cancelled) {
      return;
    }
    this.cancelled = true;
  }
  checkBlack(str) {
    if (!str || !this.black) {
      return false;
    }
    return this.black.test(str);
  }
  async known(md5) {
    if (this.inflight.has(md5)) {
      return true;
    }
    try {
      await awaitErrRes(this.dbget, md5);
      return true;
    }
    catch (ex) {
      // fall through
    }
    return this.inflight.has(md5); // double check against inflight
  }
  getMedia(post) {
    return this.mediapool.schedule(this._getMedia.bind(this, post));
  }
  async _getMedia(post) {
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
    this.inflight.add(md5);
    try {
      try {
        filename = decodeURIComponent(filename);
      }
      catch (ex) {
        // don't care
      }
      const url = `https://i.4cdn.org/${board}/${tim}${ext}`;
      let {body} = await binreq.get(url, this.shouldAbort);
      if (this.convert && ext.toLowerCase() === ".png") {
        try {
          await this.convertpool.schedule(async () => {
            const blen = body.length;
            const nbody = await sharp(body).
              jpeg({ quality: 90, force: true }).
              toBuffer();
            if (blen < nbody.length) {
              return;
            }
            body = nbody;
            ext = ".jpg";
            log.info("Coverted".magenta, filename,
              `(${filesize(blen)} -> ${filesize(body.length)})`.bold,
              `${filesize(blen - body.length)} saved`.dim.yellow);
          });
        }
        catch (ex) {
          log.error("Failed to convert", filename.bold,
            "because", ex.toString().red);
        }
      }
      filename = `${filename}${ext}`.
        replace(/[/\\]/g, "").
        replace(/\s+/g, " ").trim();
      const dir = path.join(".", "thread", board,
        thread.slice(-2, -1), thread.slice(-1), sem);
      let file = path.join(dir, filename);
      const filebase = file;

      await this.writepool.schedule(() => awaitErrRes(mkdirp, dir));
      for (let i = 1;; ++i) {
        try {
          await this.writepool.schedule(
            () => awaitErrRes(fs.writeFile.bind(fs, file, body, {
              flag: "wx",
              encoding: null,
            })));
          await awaitErrRes(this.dbput, md5, "");
          log.info("Saved".green, file.bold, filesize(body.length).yellow,
            "in", `${((Date.now() - start) / 1000).toFixed(1)}s`.dim.yellow);
          break;
        }
        catch (ex) {
          if (ex.code !== "EEXIST") {
            throw ex;
          }
          const parsed = path.parse(filebase);
          delete parsed.base;
          parsed.name = `${parsed.name} (${i})`;
          file = path.format(parsed);
          log.info("Changed to", file.yellow);
        }
      }
    }
    finally {
      this.inflight.delete(post.md5);
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
    if (this.inflightThreads.has(no)) {
      return Promise.resolve();
    }
    this.inflightThreads.add(no);
    return this.threadpool.schedule(
      this._process.bind(this, board, no, checkblack));
  }
  async _process(board, no, checkblack) {
    if (this.cancelled) {
      this.inflightThreads.delete(no);
      return;
    }
    if (checkblack && this.BLACKED.get(no)) {
      this.inflightThreads.delete(no);
      return;
    }
    const url = `https://a.4cdn.org/${board}/thread/${no}.json`;
    let body;
    try {
      body = (await this.json(url)).body;
    }
    catch (ex) {
      if (ex.status === 304) {
        return;
      }
      throw ex;
    }
    finally {
      this.inflightThreads.delete(no);
    }
    const posts = body.posts;
    const first = posts[0];
    if (checkblack && (
      this.checkBlack(first.semantic_url) || this.checkBlack(first.com))) {
      this.BLACKED.set(no, no);
      return;
    }
    log.info("Hot thread".magenta, `${board}/thread/${no}`.bold,
      "with", `${posts.length} posts`.dim.yellow);
    const waiting = [];
    for (const post of posts) {
      if (this.cancelled) {
        break;
      }
      if (!post.ext) {
        continue;
      }
      const ext = post.ext.toLowerCase();
      if (ext == ".gif") {
        // nobody likes gifs, it's 2017 people
        continue;
      }
      if (this.SMALL.has(ext) && Math.max(post.w, post.h) < 850) {
        // nobody likes small shit
        continue;
      }
      Object.assign(post, {
        board,
        thread: no.toString(),
        sem: `${no} - ${first.semantic_url}`.substr(0, 60).trim()
      });
      waiting.push(this.getMedia(post).catch(log.error));
    }
    return Promise.all(waiting);
  }
  async monitorThreads(threads) {
    log.info("Gonna monitor threads:", threads.join(", ").bold);
    threads = threads.map(extractThread);
    const waiting = new Set();
    while (!this.cancelled) {
      for (const thread of threads) {
          if (this.cancelled) {
            break;
          }
          const pp = this.process(thread.board, thread.no, false);
          waiting.add(pp);
          pp.catch(log.error).finally(() => waiting.delete(pp));
      }
      if (!this.cancelled) {
        await (this.timerMT = sleep(20000));
      }
    }
    return Promise.all(waiting.values());
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
    const waiting = new Set();
    while (!this.cancelled) {
      for (const board of boards) {
        if (this.cancelled) {
          break;
        }
        try {
          const url = `https://a.4cdn.org/${board}/threads.json`;
          const {resp, body} = await this.json(url);

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
              const pp = this.process(board, no, true);
              waiting.add(pp);
              pp.catch(log.error).finally(() => waiting.delete(pp));
            }
          }
        }
        catch (ex) {
          if (ex.status === 304) {
            log.info("Board", board, "did not change");
            continue;
          }
          log.error(board, ex);
          await (this.timeMB = sleep(1000));
        }
      }
      if (!this.cancelled) {
        await (this.timerMB = sleep(10000));
      }
    }
    await Promise.all(Array.from(waiting.values()));
  }
}
Runner.prototype.BLACK = /r(?:ule\s*)?34|japan|dick.?rate|(?:dick|cock).+rate|chat.?discuss|twink|gore|spider|wallp|^.?fur|fur.thread|fur.*read|furry|fluffy|shota|rekt thr|ylyl|drawt|trap|loli|hentai|banana|gladio/i;
Runner.prototype.SMALL = new Set([".jpg", ".jpe", ".jpeg", ".png"]);

module.exports = {
  Runner
};

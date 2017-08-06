"use strict";

const {parse:urlparse} = require("url");

require("./finally");

function ensureArray(arg) { return Array.isArray(arg) ? arg : [arg]; }

function extractThread(url) {
  url = url.trim();
  try {
    url = urlparse(url).path;
    if (url.startswith("/")) {
      url = url.substr(1);
    }
  }
  catch (ex) { /* ignored */ }
  const [board, _, no] = url.split("/");
  if (!parseInt(no, 10)) {
    throw new Error("Invalid thread URL: " + url);
  }
  return { board, no };
}

function sleep(timeout) {
  let id;
  let ores;
  return Object.assign(
    new Promise(res => id = setTimeout((ores = res), timeout)),
    {
      cancel: function() {
        clearTimeout(id);
        ores();
      }
    });
}

function awaitErrRes(fn, ...args) {
  return new Promise((res, rej) => fn(...args, (err, rv) => {
    if (err) {
      return rej(err);
    }
    res(rv);
  }));
}

const UNITS = Object.freeze(["B", "K", "M", "G", "T", "P", "E", "Z"]);
const ULEN = UNITS.length;

function filesize(size) {
  const neg = size < 0 ? "-" : "";
  size = Math.abs(size);
  let u = 0;
  while (size > 900 && u + 1 < ULEN) {
    size /= 1024;
    u++;
  }
  if (u) {
    if (size >= 100) {
      size = size.toFixed(1);
    }
    else {
      size = size.toFixed(2);
    }
  }
  return `${neg}${size}${UNITS[u]}`;
}

function sanitizeNameCommon(filename) {
  filename = filename.replace(/\s+/g, " ");
  let old;
  do {
    old = filename;
    filename = filename.replace(/^[_.\s-]+|[_.\s-]+$/g, "").trim();
  } while (old !== filename);
  return filename;
}

function sanitizeName(filename) {
  filename = sanitizeNameCommon(filename.replace(/[/\\]/g, "_"));
  // truncate to sane length
  if (filename.length > 1000) {
    filename = sanitizeNameCommon(filename.substr(0, 999) + "…");
  }
  return filename;
}
const INVALID_WIN = new Set(("CON PRN AUX NUL " +
  "COM1 COM2 COM3 COM4 COM5 COM6 COM7 COM8 COM9 " +
  "LPT1 LPT2 LPT3 LPT4 LPT5 LPT6 LPT7 LPT8 LPT9").split(" "));

const WIN_REPLACEMENTS = new Map([
  [":", "ː"],
  ["?", "⸮"],
  ["*", "★"],
  ["<", "◄"],
  [">", "▶"],
  ["\"", "'"],
  ["|", "¦"],
]);
const WIN_RE = new RegExp(
  `[${Array.from(WIN_REPLACEMENTS.keys()).join("")}]`, "g");

function win_replace(m) {
  return WIN_REPLACEMENTS.get(m[0]) || "";
}

function sanitizeNameWin(filename) {
  filename = sanitizeNameCommon(filename.
    replace(/[/\\]/g, "_").
    replace(WIN_RE, win_replace));
  if (INVALID_WIN.has(filename.toUpperCase())) {
    filename += "_valid";
  }
  if (filename.length > 250) {
    filename = sanitizeNameCommon(filename.substr(0, 249) + "…");
  }
  return filename;
}

module.exports = {
  awaitErrRes,
  ensureArray,
  extractThread,
  filesize,
  sanitizeName,
  sanitizeNameWin,
  sleep,
};

"use strict";

const accounts = require("./accounts.js");
const config = require("../config.js");

// what players typed: chat in a room, and whispers. kept for the moderator
// panel (lib/modpanel.js), which is where a moderator reads what was said
// before deciding anything; nothing else reads it. lines older than
// config.chatLogDays are deleted, and an account's lines go when the
// account is deleted. with chatLogDays 0 nothing is kept at all.

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS chat_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    username   TEXT NOT NULL,
    room       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    to_name    TEXT NOT NULL DEFAULT '',
    text       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chat_log_account ON chat_log (account_id, id);
  CREATE INDEX IF NOT EXISTS chat_log_room ON chat_log (room, id);
`;

const CHAT = "chat";
const WHISPER = "whisper";
const DAY_SECONDS = 86400;
const MAX_TEXT = 600;
const PAGE = 100;
const AROUND = 25; // lines before and after the one asked about

const now = () => Math.floor(Date.now() / 1000);
const db = () => accounts.database();

const prune = () => {
  db().prepare("DELETE FROM chat_log WHERE at < ?").run(now() - config.chatLogDays * DAY_SECONDS);
};

const load = () => {
  db().exec(SCHEMA);
  prune();
  setInterval(prune, DAY_SECONDS * 1000 / 4).unref();
};

// A line said in `room` (its name as the world knows it), or with `to` a
// whisper to that player.
const record = (account, room, text, to = "") => {
  if (config.chatLogDays <= 0) {
    return;
  }
  db().prepare("INSERT INTO chat_log (at, account_id, username, room, kind, to_name, text) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(now(), account.id, account.username, String(room || ""), to ? WHISPER : CHAT, to, String(text).slice(0, MAX_TEXT));
};

const row = line => ({id: line.id, at: line.at, username: line.username, room: line.room, whisperTo: line.kind === WHISPER ? line.to_name : "", text: line.text});

// lines newest first, a page at a time: by who said them (or was whispered
// to), by room, by words in them, and `before` an id for the next page.
const search = ({username = "", room = "", text = "", before = 0}) => {
  const where = [];
  const values = [];
  if (username) {
    where.push("(username = ? COLLATE NOCASE OR to_name = ? COLLATE NOCASE)");
    values.push(username, username);
  }
  if (room) {
    where.push("room LIKE ? ESCAPE '\\'");
    values.push(`%${room.replace(/[\\%_]/g, "\\$&")}%`);
  }
  if (text) {
    where.push("text LIKE ? ESCAPE '\\'");
    values.push(`%${text.replace(/[\\%_]/g, "\\$&")}%`);
  }
  if (before > 0) {
    where.push("id < ?");
    values.push(before);
  }
  return db().prepare(`SELECT * FROM chat_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`).all(...values, PAGE).map(row);
};

// what was said around one line, oldest first: in its room, or for a
// whisper between its two players.
const around = id => {
  const line = db().prepare("SELECT * FROM chat_log WHERE id = ?").get(Number(id));
  if (!line) {
    return null;
  }
  const [same, values] = line.kind === WHISPER
    ? ["kind = ? AND ((username = ? AND to_name = ?) OR (username = ? AND to_name = ?))", [WHISPER, line.username, line.to_name, line.to_name, line.username]]
    : ["kind = ? AND room = ?", [CHAT, line.room]];
  const earlier = db().prepare(`SELECT * FROM chat_log WHERE ${same} AND id < ? ORDER BY id DESC LIMIT ?`).all(...values, line.id, AROUND).reverse();
  const later = db().prepare(`SELECT * FROM chat_log WHERE ${same} AND id > ? ORDER BY id LIMIT ?`).all(...values, line.id, AROUND);
  return {line: row(line), lines: [...earlier, line, ...later].map(row)};
};

// everything an account said that is still kept, oldest first, for the copy
// of their data a player may ask for (lib/manage.js).
const saidBy = account => db().prepare("SELECT * FROM chat_log WHERE account_id = ? ORDER BY id").all(account.id).map(row);

// an account being deleted: what it said goes with it.
const forget = account => {
  db().prepare("DELETE FROM chat_log WHERE account_id = ?").run(account.id);
};

module.exports = {load, record, search, around, saidBy, forget, PAGE};

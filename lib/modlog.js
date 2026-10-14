"use strict";

const accounts = require("./accounts.js");

// what each moderator did in the moderator panel (lib/modpanel.js), for
// whoever runs the server to read in the admin panel. never pruned.

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS mod_log (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    at     INTEGER NOT NULL,
    by     TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT ''
  );
`;
const MAX_DETAIL = 400;
const SHOWN = 300;

const load = () => accounts.database().exec(SCHEMA);

const record = (by, action, target = "", detail = "") => {
  accounts.database().prepare("INSERT INTO mod_log (at, by, action, target, detail) VALUES (?, ?, ?, ?, ?)")
    .run(Math.floor(Date.now() / 1000), by, action, String(target), String(detail).slice(0, MAX_DETAIL));
  console.log(`[mod] ${by}: ${action}${target ? ` "${target}"` : ""}`);
};

const recent = () => accounts.database().prepare("SELECT at, by, action, target, detail FROM mod_log ORDER BY id DESC LIMIT ?").all(SHOWN);

module.exports = {load, record, recent};

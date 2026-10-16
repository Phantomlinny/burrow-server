"use strict";

const accounts = require("./accounts.js");
const defpacks = require("./defpacks.js");

// items the staff make while the server runs, with no restart of the server
// or of anybody's game. each is an existing item's art (the clothing piece
// or den item it is made from) under an id, name, price and colours of its
// own. the server's tables and the packs new games fetch have it at once
// (defpacks.setCustomItem); games already playing are sent its def row
// ("xdi", which the patched client adds to its tables), and so is every game
// at login, in case it was started before the item was made.
//
// an item is never removed, since players may have it: it can be taken out
// of the shop, renamed and repriced.

// ids far above the game's own (clothing to about 4,600, den items to about
// 6,000), one range per pack; names go under localization ids above the
// server's other added strings (lib/defpacks.js ADDED_STRINGS, 9000001 on).
const FIRST_ID = 50000;
const STRING_BASE = {clothing: 9100000, den: 9200000};
const KINDS = ["clothing", "den"];
const MAX_NAME = 40;
const MAX_COST = 1000000;
const MAX_COLOURS = 16;
const MAX_ITEMS = 5000; // per kind
const CHUNK = 40; // def rows per "xdi" message
const TYPE_CLOTHING = "1";
const OFFERED_SPECIAL_TYPES = ["0", "4"]; // den items that can be copied: plain, mannequin
const CURRENCY_GEMS = "0";

const SCHEMA = `CREATE TABLE IF NOT EXISTS custom_items (
  kind TEXT NOT NULL, id INTEGER NOT NULL, base INTEGER NOT NULL, name TEXT NOT NULL,
  cost INTEGER NOT NULL, members INTEGER NOT NULL, colors TEXT NOT NULL, in_shop INTEGER NOT NULL,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (kind, id))`;

const items = new Map(KINDS.map(kind => [kind, new Map()])); // kind -> id -> entry
let made = 0; // entries in the order they were made (`seq`), for lists
let broadcast = () => {}; // (cmd, ...params) to every game playing; set by lib/world.js

const db = () => accounts.database();
const now = () => Math.floor(Date.now() / 1000);

const baseDef = (kind, id) => (kind === "den" ? defpacks.denItemDef(id) : defpacks.itemDef(id));

// the def row of an entry: its base's row with its own id, name, price and
// colours, always on sale and marked new.
const rowOf = entry => {
  const base = baseDef(entry.kind, entry.base);
  const own = {
    id: String(entry.id),
    membersOnly: entry.members ? "1" : "0",
    itemStatus: "1",
    availabilityStartTime: "0",
    availabilityEndTime: "0",
    currencyType: CURRENCY_GEMS,
    recycleValue: "0",
    combinedCost: "",
  };
  if (entry.kind === "den") {
    return {...base, ...own, nameStrId: String(STRING_BASE.den + entry.id - FIRST_ID), cost: String(entry.cost)};
  }
  return {...base, ...own, titleStrId: String(STRING_BASE.clothing + entry.id - FIRST_ID), value: String(entry.cost), colors: entry.colors.join(","), isGiftable: "1"};
};

const apply = entry => defpacks.setCustomItem(entry.kind, rowOf(entry), entry.name, entry.inShop);

// "xdi" [.., .., kind, json]: def rows with their names, as JSON. a field
// may not hold "%" (lib/sfs.js drops it), so a "%" in a name is written as
// JSON's %.
const messages = entries => {
  const out = [];
  for (const kind of KINDS) {
    const rows = entries.filter(entry => entry.kind === kind).map(entry => ({...rowOf(entry), name: entry.name}));
    for (let at = 0; at < rows.length; at += CHUNK) {
      out.push([kind, JSON.stringify(rows.slice(at, at + CHUNK)).replace(/%/g, "\\u0025")]);
    }
  }
  return out;
};

const announce = entry => {
  for (const params of messages([entry])) {
    broadcast("xdi", ...params);
  }
};

const fromRow = row => ({
  kind: row.kind, id: row.id, base: row.base, name: row.name, cost: row.cost, members: row.members === 1,
  colors: row.colors ? row.colors.split(",").map(Number) : [], inShop: row.in_shop === 1, createdBy: row.created_by, createdAt: row.created_at,
});

const load = () => {
  db().exec(SCHEMA);
  for (const row of db().prepare("SELECT * FROM custom_items ORDER BY rowid").all()) {
    const entry = {...fromRow(row), seq: made++};
    if (!baseDef(entry.kind, entry.base)) {
      console.log(`[custom items] ${entry.kind} ${entry.id} is made from ${entry.base}, which is not in the packs; left out`);
      continue;
    }
    items.get(entry.kind).set(entry.id, entry);
    apply(entry);
  }
  console.log(`[custom items] ${items.get("clothing").size} clothing, ${items.get("den").size} den items`);
};

// checks what staff typed. returns {error} or the cleaned values.
const NAME_PATTERN = /^[\p{L}\p{N} '&!?.,:()#+\-]+$/u;
const clean = (kind, fields, current = null) => {
  const out = {};
  if (fields.name !== undefined || !current) {
    const name = String(fields.name || "").trim().replace(/\s+/g, " ");
    if (!name || name.length > MAX_NAME || !NAME_PATTERN.test(name)) {
      return {error: `A name of 1 to ${MAX_NAME} letters, numbers, spaces and simple punctuation, please.`};
    }
    out.name = name;
  }
  if (fields.cost !== undefined || !current) {
    const cost = Number(fields.cost === undefined || fields.cost === "" ? 0 : fields.cost);
    if (!Number.isInteger(cost) || cost < 0 || cost > MAX_COST) {
      return {error: `A price from 0 to ${MAX_COST} gems, please.`};
    }
    out.cost = cost;
  }
  if (fields.members !== undefined || !current) {
    out.members = fields.members === true || fields.members === "1" || fields.members === 1;
  }
  if (fields.inShop !== undefined || !current) {
    out.inShop = fields.inShop === undefined ? true : fields.inShop === true || fields.inShop === "1" || fields.inShop === 1;
  }
  if (kind === "clothing" && (fields.colors !== undefined || !current)) {
    const base = baseDef(kind, current ? current.base : fields.base);
    const baseColours = String(base.colors).split(",").map(Number);
    let colors = fields.colors;
    if (colors === undefined || colors === null || colors === "") {
      colors = baseColours;
    }
    else {
      colors = (Array.isArray(colors) ? colors : String(colors).split(",")).map(value => Number(String(value).trim()));
    }
    // a colour is a packed palette number, as in the packs (or a custom colour
    // id, lib/colours.js).
    if (colors.length === 0 || colors.length > MAX_COLOURS || !colors.every(value => Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF)) {
      return {error: `1 to ${MAX_COLOURS} colours, each a number as the packs have them.`};
    }
    out.colors = colors;
  }
  return out;
};

// makes an item from `base`, an existing clothing piece or den item.
// returns {item} or {error}.
const create = (kind, fields, by) => {
  if (!KINDS.includes(kind)) {
    return {error: "The kind is clothing or den."};
  }
  const baseId = Number(fields.base);
  const base = Number.isInteger(baseId) ? baseDef(kind, baseId) : null;
  if (!base || baseId >= FIRST_ID) {
    return {error: `No ${kind === "den" ? "den item" : "clothing"} with the id ${fields.base} to make it from (it must be one of the game's own).`};
  }
  if (kind === "clothing" && base.type !== TYPE_CLOTHING) {
    return {error: `${baseId} is a body part, not clothing.`};
  }
  if (kind === "den" && !OFFERED_SPECIAL_TYPES.includes(base.specialType)) {
    return {error: `Den item ${baseId} does something of its own (a portal, a game, ...) and cannot be copied.`};
  }
  if (items.get(kind).size >= MAX_ITEMS) {
    return {error: "There are as many custom items of that kind as there can be."};
  }
  const values = clean(kind, {...fields, base: baseId});
  if (values.error) {
    return values;
  }
  const id = Math.max(FIRST_ID - 1, ...items.get(kind).keys()) + 1;
  const entry = {kind, id, base: baseId, colors: [], ...values, createdBy: String(by), createdAt: now(), seq: made++};
  db().prepare("INSERT INTO custom_items (kind, id, base, name, cost, members, colors, in_shop, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(kind, id, baseId, entry.name, entry.cost, entry.members ? 1 : 0, entry.colors.join(","), entry.inShop ? 1 : 0, entry.createdBy, entry.createdAt);
  items.get(kind).set(id, entry);
  apply(entry);
  announce(entry);
  return {item: entry};
};

// changes the name, price, members-only, colours or whether it is on sale.
const update = (kind, id, fields) => {
  const entry = items.has(kind) && items.get(kind).get(Number(id));
  if (!entry) {
    return {error: "No such custom item."};
  }
  const values = clean(kind, fields, entry);
  if (values.error) {
    return values;
  }
  Object.assign(entry, values);
  db().prepare("UPDATE custom_items SET name = ?, cost = ?, members = ?, colors = ?, in_shop = ? WHERE kind = ? AND id = ?")
    .run(entry.name, entry.cost, entry.members ? 1 : 0, entry.colors.join(","), entry.inShop ? 1 : 0, kind, entry.id);
  apply(entry);
  announce(entry);
  return {item: entry};
};

const list = () => KINDS.flatMap(kind => [...items.get(kind).values()])
  .sort((one, other) => other.seq - one.seq);

module.exports = {
  KINDS,
  FIRST_ID,
  load,
  create,
  update,
  list,
  get: (kind, id) => (items.has(kind) && items.get(kind).get(Number(id))) || null,
  // the base an item's art is from, for a list showing what each is.
  baseName: entry => {
    const def = baseDef(entry.kind, entry.base);
    return def ? defpacks.string(entry.kind === "den" ? def.nameStrId : def.titleStrId) || String(def.abbrName || entry.base) : String(entry.base);
  },
  // every custom item, for a game logging in.
  sendAll(session) {
    for (const params of messages(list().reverse())) {
      session.sendXt("xdi", -1, ...params);
    }
  },
  // lib/world.js says how to reach every game playing.
  connect(broadcastXt) {
    broadcast = broadcastXt;
  },
};

"use strict";

// end to end: items the staff make while the server runs
// (lib/customitems.js), from the moderator panel and in the game: games
// already playing are sent them, the packs have them, the shop sells them,
// and they are still there after a restart.

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const harness = require("./harness.js");
const {decode} = require("../lib/amf3.js");
const cdn = require("../lib/cdn.js");

const HTTP_PORT = 18093;
const GAME_PORT = 19352;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const TOWNSHIP = "jamaa_township.room_main#1";
const ODD_CLOTHING_SHOP = 666;
const ODD_DEN_SHOP = 396;
const {postJson} = harness;

// the authenticator app's side of 2FA (lib/totp.js), as in test/staff.js.
const STEP = 30;
const base32Decode = text => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = text.replace(/=+$/, "").toUpperCase().split("").map(c => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
};
const codeAt = (secret, step) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0F;
  return String((mac.readUInt32BE(offset) & 0x7FFFFFFF) % 1000000).padStart(6, "0");
};
const stepNow = () => Math.floor(Date.now() / 1000 / STEP);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitForStep = async step => {
  while (stepNow() < step) {
    await sleep(250);
  }
};

const webSession = () => {
  let cookie = "";
  return async (urlPath, body) => {
    const headers = {cookie};
    const options = body === undefined ? {headers} : {method: "POST", headers: {...headers, "Content-Type": "application/json"}, body: JSON.stringify(body)};
    const res = await fetch(`${BASE}${urlPath}`, options);
    const set = res.headers.get("set-cookie");
    if (set) {
      cookie = set.split(";")[0];
    }
    return {status: res.status, data: await res.json().catch(() => ({}))};
  };
};

const say = (client, roomId, text) =>
  client.send(`<msg t='sys'><body action='pubMsg' r='${roomId}'><txt><![CDATA[${text}%0]]></txt></body></msg>`);

// `onLogin(client)` runs before the room is joined, for what the server
// sends with the login (joining skips everything else on the way).
const arrive = async (username, password, totp, onLogin = async () => {}) => {
  const res = await postJson(`${BASE}/authenticate`, {username, password, ...(totp ? {totp} : {})});
  const auth = await res.json();
  assert.strictEqual(res.status, 200, `${username} could not sign in: ${JSON.stringify(auth)}`);
  const client = new harness.GameClient(GAME_PORT);
  await client.connect();
  const login = await client.logIn(username, auth.auth_token);
  assert.strictEqual(login.status, "1");
  await onLogin(client);
  client.xt("rj", 1, TOWNSHIP, 1, 0, 0);
  const rj = await client.untilXt("rj");
  await client.untilXt("rp");
  return {client, roomId: rj[4]};
};

// a pack as the clients get it.
const pack = async id => Object.values(decode(zlib.inflateRawSync(Buffer.from(await (await fetch(`${BASE}/${cdn.hashedPath(`defPacks/${id}`)}`)).arrayBuffer()))));
const strings = async () => decode(zlib.inflateRawSync(Buffer.from(await (await fetch(`${BASE}/${cdn.hashedPath("defPacks/10230")}`)).arrayBuffer())));
const byId = (rows, id) => rows.find(row => String(row.id) === String(id));

// "xdi" [.., .., kind, rows as JSON], the next one of `kind`.
const untilDefs = async (client, kind) => {
  for (;;) {
    const fields = await client.untilXt("xdi");
    if (fields[2] === kind) {
      return JSON.parse(fields[3]);
    }
  }
};
const nextBox = async client => (await client.untilXt("xtl"))[2];
const shopList = async (client, roomId, shop) => {
  client.xt("gl", roomId, shop);
  return (await client.untilXt("gl")).slice(9);
};

const people = {Dev: "Password21", Hal: "Password22", Pat: "Password23", Lou: "Password24"};
const secret = {};
let usedStep = 0;
let made = {};

const first = async () => {
  const registerJson = body => fetch(`${BASE}/api/register`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({avatarType: 1, agreed: true, ...body})});
  for (const [username, password] of Object.entries(people)) {
    assert.strictEqual((await registerJson({username, password})).status, 200);
  }
  const admin = webSession();
  assert.strictEqual((await admin("/admin/api/setup", {password: "AdminPass99!"})).status, 200);
  assert.strictEqual((await admin("/admin/api/login", {password: "AdminPass99!"})).status, 200);
  for (const username of ["Dev", "Hal"]) {
    const page = webSession();
    assert.strictEqual((await page("/account/api/login", {username, password: people[username]})).status, 200);
    secret[username] = (await page("/account/api/act", {action: "twoStepStart", current: people[username]})).data.setup.secret;
    usedStep = Math.max(usedStep, stepNow());
    assert.ok((await page("/account/api/act", {action: "twoStepConfirm", code: codeAt(secret[username], stepNow())})).data.ok);
  }
  assert.match((await admin("/admin/api/account", {username: "Dev", action: "role", role: "developer"})).data.ok, /developer/);
  assert.match((await admin("/admin/api/account", {username: "Hal", action: "role", role: "helper"})).data.ok, /helper/);

  // a game started before anything is made
  const pat = await arrive("Pat", people.Pat);

  // --- the panel: a developer makes items, and sees no players
  usedStep++;
  await waitForStep(usedStep);
  const dev = webSession();
  assert.strictEqual((await dev("/mod/api/login", {username: "Dev", password: people.Dev, code: codeAt(secret.Dev, usedStep)})).status, 200);
  const me = (await dev("/mod/api/me")).data;
  assert.strictEqual(me.role, "developer");
  assert.ok(me.permissions.includes("items.create") && !me.permissions.includes("player.view"));
  for (const page of ["/mod/api/players", "/mod/api/chat", "/mod/api/reports", "/mod/api/overview"]) {
    assert.strictEqual((await dev(page)).status, 403, page);
  }
  assert.deepStrictEqual((await dev("/mod/api/items")).data.items, []);

  // something to make them from: a clothing piece with several colours, and the bean bag chair
  const clothing = await pack(1000);
  const base = clothing.find(row => row.type === "1" && String(row.colors).split(",").length >= 3);
  const looked = (await dev(`/mod/api/items/base?kind=clothing&id=${base.id}`)).data;
  assert.strictEqual(looked.art, Number(base.layerDefId));
  assert.strictEqual(looked.colors.length, String(base.colors).split(",").length);
  const bodyPart = clothing.find(row => row.type === "0");
  assert.strictEqual((await dev(`/mod/api/items/base?kind=clothing&id=${bodyPart.id}`)).status, 404);

  // bad requests
  const make = fields => dev("/mod/api/items", {action: "create", kind: "clothing", base: base.id, name: "Test Crown", cost: 25, ...fields});
  assert.match((await make({name: ""})).data.error, /name/);
  assert.match((await make({name: "<b>hi</b>"})).data.error, /name/);
  assert.match((await make({cost: -1})).data.error, /price/);
  assert.match((await make({base: bodyPart.id})).data.error, /body part/);
  assert.match((await make({base: 999999})).data.error, /No clothing/);
  assert.match((await make({colors: []})).data.error, /colours/);

  // made: Pat's game is told at once
  const colours = looked.colors.slice(0, 2);
  const crown = await make({colors: colours});
  assert.match(crown.data.ok, /^Test Crown \(clothing 50000\) made\.$/);
  const [row] = await untilDefs(pat.client, "clothing");
  assert.deepStrictEqual([row.id, row.name, row.layerDefId, row.layerId, row.colors, row.titleStrId],
    ["50000", "Test Crown", base.layerDefId, base.layerId, colours.join(","), "9100000"]);

  // the packs a new game fetches have it, and its name
  const crownRow = byId(await pack(1000), 50000);
  assert.strictEqual(crownRow.layerDefId, base.layerDefId);
  assert.strictEqual(crownRow.avatarUseFlags, "9007199254740991"); // any animal, like all clothing here
  assert.strictEqual((await strings())[9100000], "Test Crown");

  // first in the shop of oddities, and Pat can buy it in a colour it has
  assert.strictEqual((await shopList(pat.client, pat.roomId, ODD_CLOTHING_SHOP))[0], "50000");
  pat.client.xt("ib", pat.roomId, ODD_CLOTHING_SHOP, 1, 50000, 2, 0);
  assert.strictEqual((await pat.client.untilXt("ib"))[2], "0"); // a third colour it was not given
  pat.client.xt("ib", pat.roomId, ODD_CLOTHING_SHOP, 1, 50000, 1, 0);
  const bought = await pat.client.untilXt("il");
  assert.ok(bought.includes("50000"));
  assert.strictEqual((await pat.client.untilXt("ib"))[2], "1");

  // a den item, from the bean bag chair
  const chair = await dev("/mod/api/items", {action: "create", kind: "den", base: 1, name: "Test Chair", cost: 10});
  assert.match(chair.data.ok, /^Test Chair \(den item 50000\) made\.$/);
  const [chairRow] = await untilDefs(pat.client, "den");
  assert.deepStrictEqual([chairRow.id, chairRow.abbrName, chairRow.name, chairRow.nameStrId], ["50000", "BeanBagChair", "Test Chair", "9200000"]);
  assert.strictEqual((await shopList(pat.client, pat.roomId, ODD_DEN_SHOP))[0], "50000");
  assert.strictEqual(byId(await pack(1030), 50000).abbrName, "BeanBagChair");

  // the item finder has them
  const found = await (await fetch(`${BASE}/api/search?kind=all&q=50000`)).json();
  assert.deepStrictEqual(found.results.filter(entry => entry.id === 50000).map(entry => `${entry.kind} ${entry.name}`).sort(), ["clothing Test Crown", "den Test Chair"]);

  // changed: renamed and taken off sale, and Pat is told the new name
  assert.match((await dev("/mod/api/items", {action: "update", kind: "clothing", id: 50000, name: "Gold Crown", inShop: false})).data.ok, /Gold Crown .* changed/);
  assert.strictEqual((await untilDefs(pat.client, "clothing"))[0].name, "Gold Crown");
  assert.ok(!(await shopList(pat.client, pat.roomId, ODD_CLOTHING_SHOP)).includes("50000"));
  assert.strictEqual((await strings())[9100000], "Gold Crown");

  // --- in the game: !item, for whoever may make items
  usedStep++;
  await waitForStep(usedStep);
  // a game logging in is sent every item made so far
  let atLogin = null;
  const devGame = await arrive("Dev", people.Dev, codeAt(secret.Dev, usedStep), async client => {
    atLogin = await untilDefs(client, "clothing");
  });
  assert.deepStrictEqual(atLogin.map(entry => entry.name), ["Gold Crown"]);
  say(devGame.client, devGame.roomId, `!item clothing ${base.id} Quick Hat`);
  assert.strictEqual(await nextBox(devGame.client), "Made Quick Hat, clothing 50001. It is in the item finder now.");
  assert.strictEqual((await untilDefs(pat.client, "clothing"))[0].name, "Quick Hat");
  say(devGame.client, devGame.roomId, "!item list");
  assert.match(await nextBox(devGame.client), /^Latest items made: 50001 Quick Hat \(clothing\); 50000 Test Chair \(den\); 50000 Gold Crown \(clothing, off sale\)$/);
  say(devGame.client, devGame.roomId, "!item hat 12 x");
  assert.match(await nextBox(devGame.client), /^Use: !item/);

  // a helper may not: it is chat (another account: the same step will do)
  const hal = await arrive("Hal", people.Hal, codeAt(secret.Hal, usedStep));
  say(hal.client, hal.roomId, `!item clothing ${base.id} Nope`);
  for (;;) {
    const line = await pat.client.untilXt("uc");
    if (line[3] === `!item clothing ${base.id} Nope`) {
      break;
    }
  }
  assert.strictEqual((await dev("/mod/api/items")).data.items.length, 3);

  // written down under the maker's name
  const log = (await admin("/admin/api/moderators")).data.log.map(entry => `${entry.by} ${entry.action} ${entry.detail}`);
  for (const line of ["Dev item made clothing 50000 Test Crown", "Dev item made den 50000 Test Chair", "Dev item changed clothing 50000 Gold Crown",
    "Dev item made (in game) clothing 50001 Quick Hat"]) {
    assert.ok(log.includes(line), `missing from the log: ${line}\n${log.join("\n")}`);
  }
  made = {base};
  for (const {client} of [pat, devGame, hal]) {
    client.socket.destroy();
  }
};

// the same database, a new server: everything is still there.
const second = async () => {
  const atLogin = {};
  const lou = await arrive("Lou", people.Lou, null, async client => {
    atLogin.clothing = await untilDefs(client, "clothing");
    atLogin.den = await untilDefs(client, "den");
  });
  assert.deepStrictEqual(atLogin.clothing.map(entry => `${entry.id} ${entry.name}`), ["50000 Gold Crown", "50001 Quick Hat"]);
  assert.deepStrictEqual(atLogin.den.map(entry => entry.name), ["Test Chair"]);
  assert.strictEqual(byId(await pack(1000), 50001).layerDefId, made.base.layerDefId);
  assert.strictEqual((await strings())[9100001], "Quick Hat");
  const shop = await shopList(lou.client, lou.roomId, ODD_CLOTHING_SHOP);
  assert.ok(shop.includes("50001") && !shop.includes("50000"));
  lou.client.socket.destroy();
};

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aj-test-"));
  try {
    await harness.withServer("items test", HTTP_PORT, GAME_PORT, first, {dataDir});
    await harness.withServer("items test (after a restart)", HTTP_PORT, GAME_PORT, second, {dataDir});
  }
  finally {
    fs.rmSync(dataDir, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});

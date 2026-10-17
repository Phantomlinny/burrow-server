"use strict";

// end to end: staff roles (lib/roles.js), the staff chat commands
// (lib/commands.js) and the moderator panel's role checks
// (lib/modpanel.js), against a real server with a database of its own.

const assert = require("assert");
const crypto = require("crypto");
const harness = require("./harness.js");

const HTTP_PORT = 18091;
const GAME_PORT = 19350;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const TOWNSHIP = "jamaa_township.room_main#1";
const SAREPIA = "sarepia.room_main#1";
const {postJson} = harness;

// the authenticator app's side of 2FA (lib/totp.js): a base32 secret,
// HMAC-SHA1, 30-second steps, six digits.
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
// a code is taken once: each use needs a later step than the last.
const waitForStep = async step => {
  while (stepNow() < step) {
    await sleep(250);
  }
};

// a web panel's session: keeps the cookie it is given.
const webSession = () => {
  let cookie = "";
  return async (path, body) => {
    const headers = {cookie};
    const options = body === undefined ? {headers} : {method: "POST", headers: {...headers, "Content-Type": "application/json"}, body: JSON.stringify(body)};
    const res = await fetch(`${BASE}${path}`, options);
    const set = res.headers.get("set-cookie");
    if (set) {
      cookie = set.split(";")[0];
    }
    return {status: res.status, data: await res.json().catch(() => ({}))};
  };
};

const say = (client, roomId, text) =>
  client.send(`<msg t='sys'><body action='pubMsg' r='${roomId}'><txt><![CDATA[${text}%0]]></txt></body></msg>`);

// logs in (with a 2FA code when given) and walks into `room`. `onLogin`
// sees what comes with the login, before joining skips past it.
const arrive = async (username, password, room, totp, onLogin = async () => {}) => {
  const res = await postJson(`${BASE}/authenticate`, {username, password, ...(totp ? {totp} : {})});
  const auth = await res.json();
  assert.strictEqual(res.status, 200, `${username} could not sign in: ${JSON.stringify(auth)}`);
  const client = new harness.GameClient(GAME_PORT);
  await client.connect();
  const login = await client.logIn(username, auth.auth_token);
  assert.strictEqual(login.status, "1");
  await onLogin(client);
  client.xt("rj", 1, room, 1, 0, 0);
  const rj = await client.untilXt("rj");
  await client.untilXt("rp");
  client.xt("au", rj[4], 1, 400, 400, 14, 1);
  return {client, login, roomId: rj[4], room: rj[3]};
};

// the next moderator popup ("fd") of this kind, skipping earlier ones (a
// silence notice, say) still waiting.
const untilPopup = async (client, kind) => {
  for (;;) {
    const fields = await client.untilXt("fd");
    if (fields[2] === kind) {
      return fields;
    }
  }
};

// the next message box ("xtl") the server shows this client.
const nextBox = async client => (await client.untilXt("xtl"))[2];

// the chat line `text` coming back (every typed line, a command too, is
// shown to its sender, so skip those before it).
const untilChat = async (client, text) => {
  for (;;) {
    const line = await client.untilXt("uc");
    if (line[3] === text) {
      return line;
    }
  }
};

const run = async () => {
  const registerJson = body => fetch(`${BASE}/api/register`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({avatarType: 1, agreed: true, ...body})});
  const people = {Mira: "Password11", Hal: "Password12", Pip: "Password13", Ann: "Password14"};
  for (const [username, password] of Object.entries(people)) {
    assert.strictEqual((await registerJson({username, password})).status, 200);
  }

  // --- the admin gives roles
  const admin = webSession();
  assert.strictEqual((await admin("/admin/api/setup", {password: "AdminPass99!"})).status, 200);
  assert.strictEqual((await admin("/admin/api/login", {password: "AdminPass99!"})).status, 200);
  const roleList = await admin("/admin/api/roles");
  assert.deepStrictEqual(roleList.data.roles.map(role => role.id), ["developer", "helper", "moderator", "admin"]);
  assert.match((await admin("/admin/api/account", {username: "Mira", action: "role", role: "boss"})).data.error, /No such role/);

  // staff need 2FA: turned on from the account page.
  const secrets = {};
  const usedStep = {};
  for (const username of ["Mira", "Hal"]) {
    const page = webSession();
    assert.strictEqual((await page("/account/api/login", {username, password: people[username]})).status, 200);
    const begun = await page("/account/api/act", {action: "twoStepStart", current: people[username]});
    secrets[username] = begun.data.setup.secret;
    usedStep[username] = stepNow();
    const confirmed = await page("/account/api/act", {action: "twoStepConfirm", code: codeAt(secrets[username], usedStep[username])});
    assert.ok(confirmed.data.ok, JSON.stringify(confirmed.data));
  }
  assert.match((await admin("/admin/api/account", {username: "Mira", action: "role", role: "moderator"})).data.ok, /moderator/);
  assert.match((await admin("/admin/api/account", {username: "Hal", action: "role", role: "helper"})).data.ok, /helper/);

  // --- the game: the login reply carries your own role, and nobody else's
  usedStep.Mira++;
  // and the patched client's staff window is told the same ("xsp")
  let staffSaid = null;
  const mira = await arrive("Mira", people.Mira, TOWNSHIP, codeAt(secrets.Mira, usedStep.Mira), async client => {
    staffSaid = await client.untilXt("xsp");
  });
  assert.strictEqual(staffSaid[2], "moderator");
  assert.ok(staffSaid[3].split(",").includes("player.summon"));
  assert.strictEqual(mira.login.params.staffRole, "moderator");
  assert.ok(mira.login.params.staffPermissions.split(",").includes("player.summon"));
  usedStep.Hal++;
  const hal = await arrive("Hal", people.Hal, TOWNSHIP, codeAt(secrets.Hal, usedStep.Hal));
  assert.strictEqual(hal.login.params.staffRole, "helper");
  const pip = await arrive("Pip", people.Pip, SAREPIA);
  assert.strictEqual(pip.login.params.staffRole, "");
  const ann = await arrive("Ann", people.Ann, SAREPIA);

  // a staff command from a player is plain chat
  say(pip.client, pip.roomId, "!kick Mira");
  await untilChat(pip.client, "!kick Mira");

  say(mira.client, mira.roomId, "!staff");
  const staffBox = await nextBox(mira.client);
  assert.match(staffBox, /Mira \(Moderator\)/);
  assert.match(staffBox, /Hal \(Helper\)/);

  // summon: Pip is brought from Sarepia to Mira in the township
  say(mira.client, mira.roomId, "!summon Pip");
  assert.strictEqual((await pip.client.untilXt("rj"))[3], TOWNSHIP);
  assert.strictEqual(await nextBox(mira.client), "Pip was brought here.");

  // a helper may silence a player, but not kick, nor act on a moderator
  say(hal.client, hal.roomId, "!silence Pip 1");
  assert.strictEqual(await nextBox(hal.client), "Pip cannot chat for 1 hours.");
  say(hal.client, hal.roomId, "!silence Pip off");
  assert.strictEqual(await nextBox(hal.client), "Pip can chat again.");
  say(hal.client, hal.roomId, "!silence Mira 1");
  assert.match(await nextBox(hal.client), /your rank or above/);
  say(hal.client, hal.roomId, "!kick Pip");
  // no permission: just chat, seen by the room (Mira, in the township)
  await untilChat(mira.client, "!kick Pip");

  // goto: Mira goes to Ann in Sarepia
  say(mira.client, mira.roomId, "!goto Ann");
  assert.strictEqual((await mira.client.untilXt("rj"))[3], SAREPIA);

  // a warning: the game's own popup for the reason ("fw", 1 = bullying),
  // kept on the account; a message box; the count; then kick disconnects
  say(mira.client, ann.roomId, "!warn Ann bullying called names");
  assert.deepStrictEqual((await ann.client.untilXt("fd")).slice(2, 4), ["fw", "1"]);
  assert.strictEqual(await nextBox(mira.client), "Ann warned (bullying): warning 1.");
  say(mira.client, ann.roomId, "!warn Ann");
  assert.deepStrictEqual((await ann.client.untilXt("fd")).slice(2, 4), ["fw", "4"]); // behavior, the default
  assert.strictEqual(await nextBox(mira.client), "Ann warned (behavior): warning 2.");
  say(mira.client, ann.roomId, "!message Ann please be kind");
  assert.deepStrictEqual((await ann.client.untilXt("fd")).slice(2, 4), ["fp", "please be kind"]);
  assert.strictEqual(await nextBox(mira.client), "Shown to Ann.");
  say(mira.client, ann.roomId, "!warnings Ann");
  assert.match(await nextBox(mira.client), /^Ann has 2 warnings\. Latest: \S+ behavior by Mira; \S+ bullying by Mira \(called names\)$/);
  // the client's staff window ("xmd"): the same commands, one field each
  // the third warning in 30 days also silences for an hour (config.warningSilence)
  mira.client.xt("xmd", ann.roomId, "warn", "Ann", "personal");
  assert.deepStrictEqual((await ann.client.untilXt("fd")).slice(2, 4), ["fw", "3"]);
  assert.deepStrictEqual((await ann.client.untilXt("fd")).slice(2, 4), ["fs", "60"]);
  assert.strictEqual(await nextBox(mira.client), "Ann warned (personal): warning 3. Silenced for 60 minutes, for that many warnings.");
  mira.client.xt("xmd", ann.roomId, "message", "Ann", "hello there");
  assert.deepStrictEqual((await untilPopup(ann.client, "fp")).slice(2, 4), ["fp", "hello there"]);
  assert.strictEqual(await nextBox(mira.client), "Shown to Ann.");
  mira.client.xt("xmd", ann.roomId, "ban", "Ann"); // not one the window has: nothing
  // and from a player, nothing at all: Ann warns Mira
  ann.client.xt("xmd", ann.roomId, "warn", "Mira", "bullying");
  mira.client.xt("xmd", ann.roomId, "warnings", "Ann");
  assert.match(await nextBox(mira.client), /^Ann has 3 warnings\. /);
  say(mira.client, ann.roomId, "!warnings Mira");
  assert.strictEqual(await nextBox(mira.client), "Mira has no warnings.");
  say(mira.client, ann.roomId, "!kick Ann");
  assert.strictEqual((await ann.client.untilXt("fd"))[2], "fk");
  assert.strictEqual(await nextBox(mira.client), "Ann was disconnected.");

  // --- the moderator panel: what the role allows, checked by the server
  for (const username of ["Mira", "Hal"]) {
    usedStep[username]++;
  }
  await waitForStep(Math.max(usedStep.Mira, usedStep.Hal) - 1);
  const modPage = webSession();
  assert.strictEqual((await modPage("/mod/api/login", {username: "Mira", password: people.Mira, code: codeAt(secrets.Mira, usedStep.Mira)})).status, 200);
  const miraMe = (await modPage("/mod/api/me")).data;
  assert.strictEqual(miraMe.role, "moderator");
  assert.ok(miraMe.permissions.includes("player.ban"));
  const halPage = webSession();
  assert.strictEqual((await halPage("/mod/api/login", {username: "Hal", password: people.Hal, code: codeAt(secrets.Hal, usedStep.Hal)})).status, 200);
  const halMe = (await halPage("/mod/api/me")).data;
  assert.strictEqual(halMe.role, "helper");
  assert.ok(!halMe.permissions.includes("player.ban"));
  assert.strictEqual((await halPage("/mod/api/act", {username: "Pip", action: "ban", hours: 1, reason: "x"})).data.error, "Your role cannot do that.");
  assert.match((await halPage("/mod/api/act", {username: "Mira", action: "silence", hours: 1})).data.error, /your rank or above/);
  // searching by address (against ban evasion) is for the roles that ban addresses
  assert.strictEqual((await halPage("/mod/api/players?by=address&q=127.0.0.")).status, 403);
  assert.ok(Array.isArray((await modPage("/mod/api/players?by=address&q=127.0.0.")).data.players));
  // a warning from the panel, and on the player's page
  assert.match((await modPage("/mod/api/act", {username: "Pip", action: "warn", reason: "scamming", note: "fake trade"})).data.ok, /^Pip warned \(scamming\): warning 1\./);
  assert.match((await modPage("/mod/api/act", {username: "Pip", action: "warn", reason: "nonsense"})).data.error, /reason/);
  assert.deepStrictEqual((await untilPopup(pip.client, "fw")).slice(2, 4), ["fw", "9"]);
  const pipPage = (await modPage("/mod/api/player?username=Pip")).data;
  assert.strictEqual(pipPage.warnings, 1);
  assert.deepStrictEqual([pipPage.warningList[0].reason, pipPage.warningList[0].note, pipPage.warningList[0].by], ["scamming", "fake trade", "Mira"]);
  assert.strictEqual(pipPage.warningList[0].seen, true);

  // warnings while away (Ann was disconnected): kept for her next visit;
  // the fifth in 30 days silences for a day; one is taken back
  assert.match((await modPage("/mod/api/act", {username: "Ann", action: "warn", reason: "bullying"})).data.ok,
    /^Ann warned \(bullying\): warning 4\. They are offline: they will see it when they next play\.$/);
  assert.match((await modPage("/mod/api/act", {username: "Ann", action: "warn", reason: "behavior"})).data.ok,
    /warning 5\. .*silenced them for 1 day\.$/);
  assert.strictEqual((await modPage("/mod/api/act", {username: "Ann", action: "unwarn"})).data.ok, "Took back Ann's latest warning (behavior).");
  const annAway = (await modPage("/mod/api/player?username=Ann")).data;
  assert.strictEqual(annAway.warnings, 4);
  assert.strictEqual(annAway.warningList[0].seen, false);
  const annBack = await arrive("Ann", people.Ann, SAREPIA);
  assert.deepStrictEqual((await untilPopup(annBack.client, "fw")).slice(2, 4), ["fw", "1"]); // the bullying one
  assert.strictEqual((await modPage("/mod/api/player?username=Ann")).data.warningList[0].seen, true);
  say(mira.client, ann.roomId, "!unwarn Ann");
  assert.strictEqual(await nextBox(mira.client), "Took back Ann's latest warning (bullying).");
  say(mira.client, ann.roomId, "!unwarn Mira");
  assert.strictEqual(await nextBox(mira.client), "That is you.");

  // the panel's summon brings Pip to Mira (now in Sarepia)
  assert.match((await modPage("/mod/api/act", {username: "Pip", action: "summon"})).data.ok || "", /^Pip was brought to /);
  assert.strictEqual((await pip.client.untilXt("rj"))[3], SAREPIA);

  // everything above is in the moderators' log, the in-game ones marked so
  const log = (await admin("/admin/api/moderators")).data.log.map(entry => `${entry.by} ${entry.action} ${entry.target}`);
  for (const line of ["Mira summon (in game) Pip", "Hal silence (in game) Pip", "Mira goto (in game) Ann", "Mira warn (in game) Ann",
    "Mira message (in game) Ann", "Mira kick (in game) Ann", "Mira warn Pip", "Mira summon Pip", "Mira warn Ann", "Mira unwarn Ann",
    "Mira unwarn (in game) Ann"]) {
    assert.ok(log.includes(line), `missing from the log: ${line}\n${log.join("\n")}`);
  }

  // the moderators' message box header has real line breaks, not "\\n"
  const zlib = require("zlib");
  const {decode} = require("../lib/amf3.js");
  const stringsPath = require("../lib/cdn.js").hashedPath("defPacks/10230");
  const strings = decode(zlib.inflateRawSync(Buffer.from(await (await fetch(`${BASE}/${stringsPath}`)).arrayBuffer())));
  assert.strictEqual(strings[11134], "--Message From Moderator--\n\n");
  assert.ok(!strings[11135].includes("\\n"));

  for (const {client} of [mira, hal, pip, annBack]) {
    client.socket.destroy();
  }
};

harness.withServer("staff test", HTTP_PORT, GAME_PORT, run).catch(err => {
  console.error(err);
  process.exit(1);
});

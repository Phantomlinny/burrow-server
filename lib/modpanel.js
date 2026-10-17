"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const accounts = require("./accounts.js");
const bans = require("./bans.js");
const captcha = require("./captcha.js");
const chatlog = require("./chatlog.js");
const config = require("../config.js");
const customItems = require("./customitems.js");
const defpacks = require("./defpacks.js");
const limits = require("./limits.js");
const manage = require("./manage.js");
const masterpieces = require("./masterpieces.js");
const modlog = require("./modlog.js");
const reports = require("./reports.js");
const roles = require("./roles.js");
const staff = require("./staff.js");
const stats = require("./stats.js");
const support = require("./support.js");
const totp = require("./totp.js");
const world = require("./world.js");

// the moderator panel at /mod: what a moderator needs to look after the
// players, and no more. it is apart from the admin panel (lib/panel.js),
// which stays whoever runs the server's alone.
//
// A moderator is a game account the admin gave a staff role (lib/roles.js:
// helper, moderator or admin; `moderator` on an older account counts as a
// moderator), and what they may do here is what their role allows. they sign in here with that account's username and password and
// a code from their authenticator app, every time: an account without 2FA
// cannot sign in at all, and a trusted device is not taken for a code.
// being a moderator gives the account nothing in the game itself.
//
// what it does not give: sign-in histories, the server's log, what an
// account owns, passwords, renaming, deleting, gifts. a moderator may look
// up which players signed in from an address they already have (a search
// written down under their name, below), but is shown no others; an
// address can be banned through its player (the one they last signed in
// from) and shows here with its end left out. another moderator cannot be
// acted on.
// everything done here is written down (lib/modlog.js) under the
// moderator's name, for the admin panel.

const COOKIE = "ajc_mod";
const SESSION_HOURS = 12;
const TEN_MINUTES_MS = 600000;
const MAX_BAN_HOURS = 24 * 365 * 10;
const MAX_MESSAGE_LENGTH = 200;
const MAX_FOUND = 50;

const failuresByAddress = limits.limiter(config.failedLoginsPerTenMinutes, TEN_MINUTES_MS);
const actionsPerTenMinutes = limits.limiter(300, TEN_MINUTES_MS); // per moderator

const sessions = new Map(); // SHA-256 of a session token -> {id: account id, expiry: ms}
const addressSearched = new Map(); // moderator's account id -> the address they last searched for

const sha256 = text => crypto.createHash("sha256").update(text).digest("hex");

const cookieToken = req => {
  const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]{48})(?:;|$)`).exec(req.headers.cookie || "");
  return match ? match[1] : null;
};

const cookieHeader = (token, maxAgeSeconds) =>
  `${COOKIE}=${token}; Path=/mod; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${config.secureCookies ? "; Secure" : ""}`;

// may this account use the panel (still)?
const mayModerate = account => Boolean(account && roles.isActiveStaff(account, world.moderation.banRemaining(account) !== 0));

const signedInAs = req => {
  const token = cookieToken(req);
  const session = token && sessions.get(sha256(token));
  const account = session && session.expiry > Date.now() ? accounts.byId(session.id) : null;
  return mayModerate(account) ? account : null;
};

// ends the account's sessions here: it is no longer a moderator, or its
// password or name changed.
const forget = account => {
  for (const [hash, session] of sessions) {
    if (session.id === account.id) {
      sessions.delete(hash);
    }
  }
};

const playerRow = (account, playing) => {
  const ban = world.moderation.banOf(account);
  return {
    username: account.username,
    createdAt: account.createdAt,
    lastSeen: account.lastSeen || account.lastLogin || null,
    online: playing.has(account.username),
    room: playing.get(account.username) || null,
    banned: ban ? ban.seconds : 0,
    banReason: ban ? ban.reason : "",
    silenced: world.moderation.silenceRemaining(account),
    nameRejected: Boolean(account.nameRejected),
    moderator: Boolean(roles.roleOf(account)),
    role: roles.roleOf(account),
    warnings: (account.warnings || []).length,
    playtime: account.playtime,
    bio: account.bio,
    discord: account.discord,
  };
};

const playing = () => new Map(world.players().map(player => [player.username, player.room || "(between rooms)"]));

const findPlayers = query => {
  const wanted = String(query || "").trim().toLowerCase().slice(0, 100);
  const online = playing();
  return accounts.all()
    .filter(account => account.username.toLowerCase().includes(wanted))
    .sort((a, b) => Number(online.has(b.username)) - Number(online.has(a.username)) || a.username.localeCompare(b.username))
    .slice(0, MAX_FOUND)
    .map(account => playerRow(account, online));
};

// one player: the row, what was done about their bans (without addresses),
// their appeal, and the reports about them still waiting.
const playerDetail = account => ({
  ...playerRow(account, playing()),
  history: bans.historyOf(account).map(({at, action, seconds, reason, by}) => ({at, action, seconds, reason, by})),
  appeal: bans.appealOf(account),
  warningList: (account.warnings || []).slice(-20).reverse(),
  openReports: reports.list(false).filter(report => report.target.toLowerCase() === account.username.toLowerCase()).length,
});

// an address with its end left out, and a name to lift its ban by.
const maskedAddress = ban => ({
  id: sha256(ban.key).slice(0, 16),
  address: ban.key.includes(":") ? `${ban.key.split(":").slice(0, 2).join(":")}:…` : `${ban.key.split(".").slice(0, 2).join(".")}.…`,
  reason: ban.reason,
  by: ban.by,
  createdAt: ban.createdAt,
});

const wholeNumber = (value, min, max) => (Number.isInteger(value) && value >= min && value <= max ? value : null);

// the permission (lib/roles.js) each action needs.
const ACTION_PERMISSIONS = {
  ban: "player.ban", banReason: "player.ban", unban: "player.ban",
  silence: "chat.silence", unsilence: "chat.silence",
  kick: "player.kick", message: "player.warn", warn: "player.warn", unwarn: "player.warn",
  rejectName: "player.names", acceptName: "player.names", clearBio: "player.names",
  banAddress: "address.ban",
  summon: "player.summon", goto: "player.goto",
};

// minutes as a person would say them: "1 hour", "1 day", "90 minutes".
const silenceText = minutes => {
  const [count, unit] = minutes % 1440 === 0 ? [minutes / 1440, "day"] : minutes % 60 === 0 ? [minutes / 60, "hour"] : [minutes, "minute"];
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
};

const act = (mod, target, body) => {
  const {actions, PERMANENT} = world.moderation;
  const name = target.username;
  const by = mod.username;
  if (target === mod) {
    return {error: "That is you."};
  }
  if (!roles.outranks(mod, target)) {
    return {error: "Staff of your rank or above are for someone higher up to deal with."};
  }
  const permission = ACTION_PERMISSIONS[body.action];
  if (permission && !roles.can(mod, permission)) {
    return {error: "Your role cannot do that."};
  }
  switch (body.action) {
    case "ban": {
      const hours = wholeNumber(body.hours, 0, MAX_BAN_HOURS);
      if (hours === null) {
        return {error: "Hours as a whole number, or 0 for permanent."};
      }
      actions.ban(target, hours === 0 ? PERMANENT : hours * 3600, body.reason, by);
      manage.forget(target);
      return {ok: hours === 0 ? `${name} is banned permanently.` : `${name} is banned for ${hours} hours.`, detail: `${hours || "permanent"} · ${target.banReason}`};
    }
    case "banReason":
      return actions.banReason(target, body.reason, by) ? {ok: "Reason saved.", detail: target.banReason} : {error: `${name} is not banned.`};
    case "unban":
      if (world.moderation.banRemaining(target) === 0) {
        return {error: `${name} is not banned.`};
      }
      actions.unban(target, by);
      return {ok: `${name} is no longer banned.`};
    // counted in hours here; the game's own notice counts minutes.
    case "silence": {
      const hours = wholeNumber(body.hours, 0, MAX_BAN_HOURS);
      if (hours === null) {
        return {error: "Hours as a whole number, or 0 for until lifted."};
      }
      actions.silence(target, hours === 0 ? PERMANENT : hours * 3600);
      return {ok: hours === 0 ? `${name} cannot chat until it is lifted.` : `${name} cannot chat for ${hours} hours.`, detail: String(hours || "until lifted")};
    }
    case "unsilence":
      actions.silence(target, 0);
      return {ok: `${name} can chat again.`};
    case "kick":
      return actions.kick(target) ? {ok: `${name} was disconnected.`} : {error: `${name} is not online.`};
    case "message": {
      const text = String(body.text || "").trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!text) {
        return {error: "The message is empty."};
      }
      return actions.message(target, text) ? {ok: `Shown to ${name}.`, detail: text} : {error: `${name} is not online.`};
    }
    case "warn": {
      const reason = String(body.reason || "behavior");
      const result = actions.warn(target, reason, by, body.note);
      if (!result) {
        return {error: `A warning's reason: ${world.moderation.WARNINGS.join(", ")}.`};
      }
      return {ok: `${name} warned (${reason}): warning ${result.count}.${result.online ? "" : " They are offline: they will see it when they next play."}`
        + (result.silencedMinutes ? ` That many warnings also silenced them for ${silenceText(result.silencedMinutes)}.` : ""),
        detail: `${reason}${body.note ? ` · ${String(body.note).slice(0, 200)}` : ""}`};
    }
    case "unwarn": {
      const removed = actions.unwarn(target);
      return removed ? {ok: `Took back ${name}'s latest warning (${removed.reason}).`, detail: removed.reason}
        : {error: `${name} has no warnings.`};
    }
    case "rejectName":
      if (target.nameRejected) {
        return {error: "Already rejected."};
      }
      actions.rejectName(target, by);
      manage.forget(target);
      return {ok: `${name} is signed out and picks a new name at the next sign-in.`};
    case "acceptName":
      if (!target.nameRejected) {
        return {error: "Not rejected."};
      }
      actions.acceptName(target);
      return {ok: `${name} keeps the name.`};
    case "clearBio":
      target.bio = "";
      accounts.save(target);
      return {ok: "Bio cleared."};
    // the address they last signed in from, for good. which address that
    // is, the moderator is not told.
    case "banAddress": {
      const last = target.logins.find(login => login.ok && login.address);
      if (!last) {
        return {error: "No address is known for them."};
      }
      const result = staff.banAddress(last.address, body.reason, by);
      if (result.error) {
        return {error: result.error.startsWith("That is this machine") ? "Their address cannot be banned." : result.error};
      }
      return {ok: "Their address is banned.", detail: result.ban.reason};
    }
    // the moderator's own animal and the player's, in the game: both have
    // to be online, the moderator in a room.
    case "summon": {
      const result = world.staffMove(target.username, mod.username);
      return result.ok ? {ok: `${name} was brought to ${result.room}.`, detail: result.room} : {error: result.error};
    }
    case "goto": {
      const result = world.staffMove(mod.username, target.username);
      return result.ok ? {ok: `You went to ${name} (${result.room}).`, detail: result.room} : {error: result.error};
    }
    default:
      return {error: "Unknown action."};
  }
};

const PAGE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": captcha.policy("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; "
    + "form-action 'none'; frame-ancestors 'none'; base-uri 'none'"),
};

// `from` is {address, key, local}; `web` is {send, readJson} from lib/http.js.
const handle = async (req, res, url, from, web) => {
  for (const [name, value] of Object.entries(PAGE_HEADERS)) {
    res.setHeader(name, value);
  }
  const reply = (status, body) => web.send(res, status, body);
  const route = `${req.method} ${url.pathname.replace(/\/$/, "") || "/mod"}`;

  if (route === "GET /mod") {
    web.send(res, 200, captcha.withScriptVersion(await stats.withView(await fs.promises.readFile(path.join(config.publicDir, "mod.html")))), "text/html; charset=utf-8");
    return;
  }
  if (req.method === "POST" && !limits.originAllowed(req)) {
    reply(403, {error: "forbidden"});
    return;
  }
  const body = req.method === "POST" ? await web.readJson(req) : {};

  switch (route) {
    case "GET /mod/api/state": {
      const mod = signedInAs(req);
      reply(200, {signedIn: Boolean(mod), username: mod ? mod.username : ""});
      return;
    }
    // username, password and a code, all three every time.
    case "POST /mod/api/login": {
      if (!from.local && failuresByAddress.blocked(from.key)) {
        reply(429, {error: "Too many attempts. Try later."});
        return;
      }
      const captchaProblem = await captcha.check({captcha: body.captcha}, from, "login");
      if (captchaProblem) {
        reply(captchaProblem === "captcha_unavailable" ? 503 : 401, {error: captcha.MESSAGES[captchaProblem]});
        return;
      }
      // looked up first: with AJ_REGISTER=1 authenticate() would make the account.
      const known = accounts.byName(String(body.username || "").trim());
      const account = known && await accounts.authenticateAsync(known.username, body.password) === known ? known : null;
      // one answer for a wrong password and for an account that is no
      // moderator: who the moderators are is nobody's to find out here.
      if (!account || !roles.roleOf(account)) {
        failuresByAddress.record(from.key);
        if (known && !account) {
          accounts.recordLogin(known, "mod", from.address, false);
          accounts.save(known);
        }
        reply(401, {error: "Wrong username or password."});
        return;
      }
      if (!totp.isOn(account)) {
        reply(403, {error: "Turn on 2FA on your account page first."});
        return;
      }
      if (!mayModerate(account)) {
        reply(403, {error: "This account cannot sign in here now."});
        return;
      }
      if (!totp.verify(account, String(body.code || ""))) {
        failuresByAddress.record(from.key);
        accounts.recordLogin(account, "mod", from.address, false);
        accounts.save(account);
        reply(401, {error: "Wrong code."});
        return;
      }
      accounts.recordLogin(account, "mod", from.address);
      accounts.save(account);
      for (const [hash, session] of sessions) {
        if (session.expiry < Date.now()) {
          sessions.delete(hash);
        }
      }
      const token = crypto.randomBytes(24).toString("hex");
      sessions.set(sha256(token), {id: account.id, expiry: Date.now() + SESSION_HOURS * 3600000});
      res.setHeader("Set-Cookie", cookieHeader(token, SESSION_HOURS * 3600));
      modlog.record(account.username, "signed in");
      reply(200, {ok: true, username: account.username});
      return;
    }
    case "POST /mod/api/logout": {
      const token = cookieToken(req);
      if (token) {
        sessions.delete(sha256(token));
      }
      res.setHeader("Set-Cookie", cookieHeader("", 0));
      reply(200, {ok: true});
      return;
    }
  }

  const mod = signedInAs(req);
  if (!mod) {
    reply(401, {error: "Sign in first."});
    return;
  }
  if (req.method === "POST" && !actionsPerTenMinutes.allow(mod.id)) {
    reply(429, {error: "Too many at once. Try later."});
    return;
  }
  // what was done, under the moderator's name; then the answer.
  const done = (result, action, target = "", detail = "") => {
    if (result.ok) {
      modlog.record(mod.username, action, target, result.detail || detail);
    }
    reply(result.ok ? 200 : 400, result.ok ? {ok: result.ok} : {error: result.error});
  };

  switch (route) {
    // who is signed in here, their role and what it allows: for a client to
    // show only the buttons that will work.
    case "GET /mod/api/me":
      reply(200, {username: mod.username, role: roles.roleOf(mod), permissions: roles.permissionsOf(mod)});
      return;
  }

  // custom items (lib/customitems.js), for whoever may make them.
  if (url.pathname.startsWith("/mod/api/items")) {
    if (!roles.can(mod, "items.create")) {
      reply(403, {error: "Your role does not allow that."});
      return;
    }
    itemRoutes(route, url, body, reply, done, mod);
    return;
  }
  // everything else shows players and what they did: not for a role that
  // only makes things.
  if (!roles.can(mod, "player.view")) {
    reply(403, {error: "Your role does not allow that."});
    return;
  }

  switch (route) {
    case "GET /mod/api/overview":
      reply(200, {online: world.players().length, reports: reports.openCount(), requests: support.nameRequests(false).length + bans.openAppeals(),
        paintings: masterpieces.list(masterpieces.PENDING).length});
      return;

    case "GET /mod/api/players": {
      if (url.searchParams.get("by") !== "address") {
        reply(200, {players: findPlayers(url.searchParams.get("q"))});
        return;
      }
      // by address: only the address typed, which is written down (once
      // for each address, though the page asks again every few seconds).
      // for the roles that ban addresses (lib/roles.js), not every staff member.
      if (!roles.can(mod, "address.ban")) {
        reply(403, {error: "Your role cannot do that."});
        return;
      }
      const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
      const found = staff.byAddress(query);
      if (found.error) {
        reply(400, found);
        return;
      }
      if (addressSearched.get(mod.id) !== query) {
        addressSearched.set(mod.id, query);
        modlog.record(mod.username, "searched by address", "", `${query} · ${found.players.length} found`);
      }
      const online = playing();
      reply(200, {players: found.players.map(entry => ({...playerRow(accounts.byName(entry.username), online), matchedAt: entry.lastAt}))});
      return;
    }

    case "GET /mod/api/stats":
      reply(200, stats.report(Number(url.searchParams.get("days")), Number(url.searchParams.get("offset"))));
      return;

    case "GET /mod/api/player": {
      const account = accounts.byName(url.searchParams.get("username") || "");
      reply(account ? 200 : 404, account ? playerDetail(account) : {error: "No such player."});
      return;
    }

    case "POST /mod/api/act": {
      const target = accounts.byName(String(body.username || ""));
      if (!target) {
        reply(404, {error: "No such player."});
        return;
      }
      done(act(mod, target, body), String(body.action), target.username);
      return;
    }

    // what players typed (lib/chatlog.js): a page of lines, or the lines
    // around one of them.
    case "GET /mod/api/chat": {
      const params = url.searchParams;
      const lines = chatlog.search({username: (params.get("username") || "").trim().slice(0, 100), room: (params.get("room") || "").trim().slice(0, 100),
        text: (params.get("text") || "").trim().slice(0, 100), before: Number(params.get("before")) || 0});
      reply(200, {lines, more: lines.length === chatlog.PAGE, days: config.chatLogDays});
      return;
    }
    case "GET /mod/api/chat/around": {
      const found = chatlog.around(url.searchParams.get("id"));
      reply(found ? 200 : 404, found || {error: "No such line."});
      return;
    }

    case "GET /mod/api/reports":
      reply(200, {reports: reports.list(url.searchParams.get("handled") === "1"), open: reports.openCount()});
      return;

    case "POST /mod/api/report":
      done(reports.markHandled(Number(body.id)) ? {ok: "Marked as dealt with."} : {error: "No such report waiting."}, "report dealt with", "", `#${Number(body.id)}`);
      return;

    // requests for another username, and ban appeals.
    case "GET /mod/api/requests": {
      const handled = url.searchParams.get("handled") === "1";
      reply(200, {names: support.nameRequests(handled), appeals: staff.appealsFor(handled).map(({addressKey, address, ...appeal}) => ({...appeal, ofAddress: Boolean(address)}))});
      return;
    }
    case "POST /mod/api/request": {
      if (body.action === "appealApprove" || body.action === "appealDeny") {
        const result = staff.answerAppeal(body.id, body.action === "appealApprove", body.reply, mod.username);
        done(result, body.action === "appealApprove" ? "appeal approved" : "appeal denied", result.username, bans.clean(body.reply, bans.MAX_REPLY));
      }
      else if (body.action === "approve" || body.action === "deny") {
        const result = staff.answerNameRequest(body.id, body.action === "approve");
        done(result, body.action === "approve" ? "name request approved" : "name request denied", result.username);
      }
      else {
        reply(400, {error: "Unknown action."});
      }
      return;
    }

    case "GET /mod/api/bans":
      reply(200, {accounts: staff.disciplined(), addresses: bans.addressBans().map(maskedAddress)});
      return;

    case "POST /mod/api/address": {
      if (!roles.can(mod, "address.ban")) {
        reply(403, {error: "Your role cannot do that."});
        return;
      }
      const ban = bans.addressBans().find(entry => sha256(entry.key).slice(0, 16) === String(body.id));
      done(ban && bans.unbanAddress(ban.key, mod.username) ? {ok: "No longer banned."} : {error: "Not banned."}, "address unbanned", "", ban ? ban.reason : "");
      return;
    }

    // paintings players framed (lib/masterpieces.js).
    case "GET /mod/api/masterpieces":
      reply(200, {waiting: masterpieces.list(masterpieces.PENDING), approved: masterpieces.list(masterpieces.APPROVED)});
      return;

    case "GET /mod/api/masterpiece": {
      const picture = masterpieces.image(url.searchParams.get("id") || "");
      if (!picture) {
        reply(404, {error: "No such painting."});
        return;
      }
      res.setHeader("Cache-Control", "private, max-age=3600");
      web.send(res, 200, picture, "image/jpeg");
      return;
    }

    case "POST /mod/api/masterpiece": {
      const id = String(body.id || "");
      const maker = masterpieces.creatorOf(id);
      const result = body.action === "approve"
        ? (world.approveMasterpiece(id) ? {ok: "Approved."} : {error: "No such painting waiting."})
        : body.action === "reject" || body.action === "remove"
          ? (world.removeMasterpiece(id) ? {ok: "Removed for good. Its maker was told and given a Masterpiece Token."} : {error: "No such painting."})
          : {error: "Unknown action."};
      done(result, `painting ${body.action === "approve" ? "approved" : "removed"}`, maker ? maker.username : "", id);
      return;
    }

    default:
      reply(404, {error: "not_found"});
  }
};

// GET /mod/api/items: the custom items, the newest first.
// GET /mod/api/items/base?kind=clothing|den&id=N: an item of the game's to
//   make one from (its name and colours), to check before making it.
// POST /mod/api/items {action: "create", kind, base, name, cost, members, colors}
//   or {action: "update", kind, id, and any of name, cost, members, colors, inShop}.
const itemRoutes = (route, url, body, reply, done, mod) => {
  switch (route) {
    case "GET /mod/api/items":
      reply(200, {items: customItems.list().map(entry => ({...entry, baseName: customItems.baseName(entry)})), firstId: customItems.FIRST_ID});
      return;
    case "GET /mod/api/items/base": {
      const kind = url.searchParams.get("kind") === "den" ? "den" : "clothing";
      const id = Number(url.searchParams.get("id"));
      const def = kind === "den" ? defpacks.denItemDef(id) : defpacks.itemDef(id);
      if (!def || id >= customItems.FIRST_ID || (kind === "clothing" && def.type !== "1")) {
        reply(404, {error: `No ${kind === "den" ? "den item" : "clothing"} with that id.`});
        return;
      }
      reply(200, kind === "den"
        ? {kind, id, name: defpacks.string(def.nameStrId) || def.abbrName, art: def.abbrName, cost: Number(def.cost)}
        : {kind, id, name: defpacks.string(def.titleStrId), art: Number(def.layerDefId), cost: Number(def.value), colors: String(def.colors).split(",").map(Number)});
      return;
    }
    case "POST /mod/api/items": {
      const kind = String(body.kind || "");
      const result = body.action === "update"
        ? customItems.update(kind, body.id, body)
        : body.action === "create" ? customItems.create(kind, body, mod.username) : {error: "Unknown action."};
      if (result.error) {
        done(result);
        return;
      }
      const {item} = result;
      done({ok: `${item.name} (${item.kind === "den" ? "den item" : "clothing"} ${item.id}) ${body.action === "update" ? "changed" : "made"}.`},
        body.action === "update" ? "item changed" : "item made", "", `${item.kind} ${item.id} ${item.name}`);
      return;
    }
    default:
      reply(404, {error: "not_found"});
  }
};

const moderators = () => accounts.all().filter(account => roles.roleOf(account))
  .map(account => ({username: account.username, role: roles.roleOf(account), twoStep: totp.isOn(account), lastSeen: account.lastSeen || null}))
  .sort((a, b) => a.username.localeCompare(b.username));

module.exports = {handle, forget, moderators};

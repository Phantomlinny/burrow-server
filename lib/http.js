"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const accounts = require("./accounts.js");
const admin = require("./admin.js");
const bans = require("./bans.js");
const captcha = require("./captcha.js");
const cdn = require("./cdn.js");
const config = require("../config.js");
const defpacks = require("./defpacks.js");
const limits = require("./limits.js");
const manage = require("./manage.js");
const modpanel = require("./modpanel.js");
const badges = require("./badges.js");
const extraMusic = require("./extramusic.js");
const masterpieces = require("./masterpieces.js");
const panel = require("./panel.js");
const totp = require("./totp.js");
const world = require("./world.js");

// stands in for every web service the launcher and the SWF talk to:
// www (flashvars), authenticator, player-session-data, ajelectronapi, the
// game host page and the content CDN.

const CROSS_DOMAIN = '<?xml version="1.0"?><cross-domain-policy><site-control permitted-cross-domain-policies="all"/>'
  + '<allow-access-from domain="*" to-ports="*"/><allow-http-request-headers-from domain="*" headers="*"/></cross-domain-policy>';

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".xml": "text/xml",
  ".swf": "application/x-shockwave-flash",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain",
  ".otf": "font/otf",
};

const flashVars = () => ({
  content: config.baseUrl,
  // the game's own server to the SWF, whatever its name: it loads the card
  // badges, the bio and ban icons and the chat filter's lists from here,
  // and calls /api here. the client lets the game load from no other name.
  website: config.baseUrl,
  mdUrl: `${config.baseUrl}game/`,
  playerWallHost: `${config.baseUrl}wall`,
  smartfoxServer: config.host,
  blueboxServer: config.host,
  smartfoxPort: String(config.gamePort),
  blueboxPort: String(config.httpPort),
  build_version: config.buildVersion,
  deploy_version: config.deployVersion,
  // for the custom client: are its advanced login settings honoured here?
  loginChoices: config.loginChoices,
  smoke_version: config.deployVersion,
  clientURL: `${config.baseUrl}${config.deployVersion}/ajclient.swf?v=${config.buildVersion}`,
  startupRoom: config.startupRoom,
  // "-1" turns the client's stats socket off.
  sbStatTrackerIp: "-1",
  sbStatModulator: "0",
  currentTimestamp: Math.floor(Date.now() / 1000),
  country: "US",
  locale: "en",
});

const readJson = req => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on("data", chunk => {
    size += chunk.length;
    if (size > 64 * 1024) {
      reject(new Error("body too large"));
      req.destroy();
    }
    else {
      chunks.push(chunk);
    }
  });
  req.on("end", () => {
    try {
      resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
    }
    catch (err) {
      reject(err);
    }
  });
  req.on("error", reject);
});

const readBody = (req, maxBytes) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on("data", chunk => {
    size += chunk.length;
    if (size > maxBytes) {
      reject(new Error("body too large"));
      req.destroy();
    }
    else {
      chunks.push(chunk);
    }
  });
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});

// the parts of a multipart/form-data body, as a Map of field name ->
// Buffer. empty when the body is not one.
const formParts = (contentType, body) => {
  const parts = new Map();
  const boundary = /boundary=("?)([^";]{1,200})\1/.exec(contentType || "");
  if (!boundary) {
    return parts;
  }
  const mark = Buffer.from(`--${boundary[2]}`);
  let at = body.indexOf(mark);
  while (at !== -1) {
    const next = body.indexOf(mark, at + mark.length);
    const headEnd = body.indexOf("\r\n\r\n", at);
    if (next === -1 || headEnd === -1 || headEnd > next) {
      break;
    }
    const name = /name="([^"]{1,100})"/.exec(body.toString("latin1", at + mark.length, headEnd));
    if (name) {
      parts.set(name[1], body.subarray(headEnd + 4, next - 2)); // without the line break before the mark
    }
    at = next;
  }
  return parts;
};

const send = (res, status, body, type = "application/json") => {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(status, {"Content-Type": type, "Content-Length": data.length});
  res.end(res.req && res.req.method === "HEAD" ? undefined : data);
};

// wrong passwords allowed per address before further tries from it are
// refused for a while. the address is what is blocked, never the account:
// blocking an account would let anybody keep its owner out by guessing at
// it, and guessing from many addresses is what makes it dear.
const TEN_MINUTES_MS = 600000;
const failuresByAddress = limits.limiter(config.failedLoginsPerTenMinutes, TEN_MINUTES_MS);
const searches = limits.limiter(120, 60000); // item finder searches, per address
const cacheMisses = limits.limiter(config.cacheMissesPerTenMinutes, TEN_MINUTES_MS); // files fetched from the official CDN for one address
const errorReports = limits.limiter(config.errorReportsPerMinute, 60000);
const paintingPosts = limits.limiter(60, TEN_MINUTES_MS); // per address; each also needs a token from the game
const PAINTING_PATH = /^\/masterpieces\/([0-9a-f-]{36})$/;

// where clients ask for the HUD artwork; ours is a changed copy.
const HUD_ASSETS_PATH = cdn.hashedPath("assets/HUDAssets.swf");
const MAX_REPORT_LENGTH = 4000;

// client errors are also kept in a file of their own, so they outlive a
// server whose output only went to a terminal.
const CLIENT_ERROR_FILE = path.join(config.dataDir, "client-errors.log");
const MAX_CLIENT_ERROR_FILE = 5 * 1024 * 1024;
const keepClientError = text => {
  fs.promises.stat(CLIENT_ERROR_FILE).then(stat => stat.size, () => 0)
    .then(size => (size < MAX_CLIENT_ERROR_FILE ? fs.promises.appendFile(CLIENT_ERROR_FILE, text) : null))
    .catch(() => {});
};
const THEMED_ROOM = /^(\d+)\/roomDefs\/theme_(\d+)\/(.+)$/;

// the web pages, as against what the game and the client load
const SITE_PAGES = /^\/(?:register|terms|privacy|commands|shop|account|mod)?\/?$/;

// origins a client's own page has: a file, as browsers name it.
const CLIENT_ORIGINS = ["null", "file://"];

// one of this server's plain pages (sign-up, the commands, the item finder),
// with the headers the account page and the panel have: nothing loaded from
// elsewhere, nothing sent elsewhere, no frame.
const PAGE_HEADERS = {
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; "
    + "form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
};
// the same, for the pages that show the captcha (lib/captcha.js)
const CAPTCHA_PAGE_HEADERS = {...PAGE_HEADERS, "Content-Security-Policy": captcha.policy(PAGE_HEADERS["Content-Security-Policy"])};
// the terms and the privacy policy carry who runs this server and where to
// write, from config.js.
const LEGAL_VALUES = {legalEmail: config.legalEmail, adminEmail: config.adminEmail, operator: config.operator, hostedIn: config.hostedIn,
  version: config.termsVersion, site: new URL(config.siteUrl).host};
const escapeHtml = text => String(text).replace(/[&<>"]/g, sign => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"})[sign]);
const sendLegalPage = async (res, file) => {
  for (const [name, value] of Object.entries(PAGE_HEADERS)) {
    res.setHeader(name, value);
  }
  const page = (await fs.promises.readFile(path.join(config.publicDir, file), "utf8"))
    .replace(/\{\{(\w+)\}\}/g, (whole, name) => (Object.hasOwn(LEGAL_VALUES, name) ? escapeHtml(LEGAL_VALUES[name]) : whole));
  send(res, 200, page, MIME[".html"]);
};
// a web address or a path on this server; anything else is dropped
const pageLink = text => (/^https?:\/\/[^\s"<>]+$/.test(text) || /^\/[^/\s"<>][^\s"<>]*$/.test(text) ? text : "");
const HOME_VALUES = {downloadUrl: pageLink(config.downloadUrl), githubUrl: pageLink(config.githubUrl), discordUrl: pageLink(config.discordUrl)};
const sendHomePage = async res => {
  for (const [name, value] of Object.entries(PAGE_HEADERS)) {
    res.setHeader(name, value);
  }
  const page = (await fs.promises.readFile(path.join(config.publicDir, "home.html"), "utf8"))
    .replace(/\{\{(\w+)\}\}/g, (whole, name) => (Object.hasOwn(HOME_VALUES, name) ? escapeHtml(HOME_VALUES[name]) : whole));
  send(res, 200, page, MIME[".html"]);
};
const sendPage = async (res, file, headers = PAGE_HEADERS) => {
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
  send(res, 200, captcha.withScriptVersion(await fs.promises.readFile(path.join(config.publicDir, file))), MIME[".html"]);
};

// A username that was rejected (lib/moderation.js) is replaced as part of
// signing in: the sign-in that proved who it is gets a ticket in place of a
// login token, and the ticket with a new name finishes the sign-in. A ticket
// is good for a few minutes and a few tries.
const RENAME_TICKET_MS = 600000;
const RENAME_TRIES = 20;
const renameTickets = new Map(); // SHA-256 of a ticket -> {id, expiry, tries, deviceToken}
const ticketHash = ticket => crypto.createHash("sha256").update(String(ticket)).digest("hex");

const renameTicket = (account, deviceToken) => {
  for (const [hash, entry] of renameTickets) {
    if (entry.expiry < Date.now() || entry.id === account.id) {
      renameTickets.delete(hash);
    }
  }
  const ticket = crypto.randomBytes(24).toString("hex");
  renameTickets.set(ticketHash(ticket), {id: account.id, expiry: Date.now() + RENAME_TICKET_MS, tries: 0, deviceToken});
  return ticket;
};

// the second half of such a sign-in: {rename_ticket, new_username}.
const renameAndSignIn = (res, body, from) => {
  const hash = ticketHash(body.rename_ticket);
  const entry = renameTickets.get(hash);
  const account = entry && entry.expiry > Date.now() ? accounts.byId(entry.id) : null;
  if (!account || !account.nameRejected || account.locked || world.moderation.banRemaining(account) !== 0 || bans.addressBan(from.address)
    || ++entry.tries > RENAME_TRIES) {
    renameTickets.delete(hash);
    send(res, 401, {error_code: 101, error: "rename_expired"});
    return;
  }
  const wanted = typeof body.new_username === "string" ? body.new_username.trim() : "";
  world.disconnect(account);
  const problem = wanted.toLowerCase() === account.username.toLowerCase() ? "same_name" : accounts.rename(account, wanted);
  if (problem) {
    send(res, 401, {error_code: 101, error: "name_rejected", rename_ticket: body.rename_ticket, name_error: problem});
    return;
  }
  renameTickets.delete(hash);
  delete account.nameRejected;
  manage.forget(account);
  accounts.recordLogin(account, "launcher", from.address);
  accounts.save();
  console.log(`[accounts] a rejected username was replaced by "${account.username}"`);
  accounts.setLoginChoices(account, body.login_choices);
  const token = accounts.issueToken(account);
  send(res, 200, {auth_token: token, refresh_token: token, device_token: entry.deviceToken});
};

const authenticate = async (req, res, from) => {
  const body = await readJson(req);
  if (body.rename_ticket !== undefined) {
    renameAndSignIn(res, body, from);
    return;
  }
  const byRefresh = body.refresh_token !== undefined;
  const accountKey = String(body.username).trim().toLowerCase();
  if (!from.local && failuresByAddress.blocked(from.key)) {
    send(res, 429, {error_code: 429, error: "too_many_attempts"});
    return;
  }
  // a password is not looked at before the captcha. the custom client
  // knows these errors; the official launcher shows them as a wrong password.
  const captchaProblem = byRefresh ? null : await captcha.check(body, from, "login", accounts.byName(accountKey));
  if (captchaProblem) {
    send(res, captchaProblem === "captcha_unavailable" ? 503 : 401, {error_code: 101, error: captchaProblem});
    return;
  }
  const account = byRefresh
    ? accounts.byToken(body.refresh_token)
    : await accounts.authenticateAsync(body.username, body.password);
  if (!account) {
    failuresByAddress.record(from.key);
    if (!byRefresh) {
      // A wrong password shows in the account's own login history.
      const tried = accounts.byName(accountKey);
      if (tried) {
        accounts.recordLogin(tried, "launcher", from.address, false);
        accounts.save();
      }
    }
    // error_code 100 = expired refresh token, 101 = wrong credentials
    send(res, 401, {error_code: byRefresh ? 100 : 101});
    return;
  }
  // banned: said here, with how long is left (-1 for good), where a client
  // can show it. the game itself would only be refused at its socket with
  // the one line it has for that, which says neither. the password (or the
  // saved sign-in) was right, so this tells nobody anything a player's card
  // does not.
  // the reason goes with it: whoever got this far is the banned player.
  const ban = world.moderation.banOf(account);
  if (ban) {
    send(res, 401, {error_code: 101, error: "account_banned", banned_seconds: ban.seconds, ban_reason: ban.reason});
    return;
  }
  // A banned address (lib/bans.js): for good, whoever signs in from it.
  const addressBan = bans.addressBan(from.address);
  if (addressBan) {
    send(res, 401, {error_code: 101, error: "address_banned", banned_seconds: world.moderation.PERMANENT, ban_reason: addressBan.reason});
    return;
  }
  // locked by its owner on the account page: the password is right, and
  // still nobody gets in. the launcher shows this as a failed sign-in.
  if (account.locked) {
    send(res, 401, {error_code: 101, error: "account_locked"});
    return;
  }
  // two-step sign-in (lib/totp.js): after the password, a code from the
  // player's authenticator app, unless this device gave one in the last 30
  // days and kept the token it got for it. A saved sign-in is not asked:
  // it was given after a code, and lasts no longer than such a token. the
  // custom client knows these errors; the official launcher shows them as a
  // wrong password, and cannot give a code.
  let deviceToken;
  if (!byRefresh && totp.isOn(account) && !totp.deviceTrusted(account, body.device_token)) {
    if (body.totp === undefined || body.totp === "") {
      send(res, 401, {error_code: 101, error: "totp_required", captcha_pass: captcha.issuePass(account, from)});
      return;
    }
    if (!totp.verify(account, String(body.totp))) {
      failuresByAddress.record(from.key);
      accounts.recordLogin(account, "launcher", from.address, false);
      accounts.save();
      send(res, 401, {error_code: 101, error: "totp_wrong", captcha_pass: captcha.issuePass(account, from)});
      return;
    }
    if (body.remember_device === true) {
      deviceToken = totp.trustDevice(account, "launcher");
    }
  }
  // its username was rejected: a new one first (above). the official
  // launcher shows this as a wrong password; the account page asks too.
  if (account.nameRejected) {
    accounts.save(); // a two-step code just used stays used
    send(res, 401, {error_code: 101, error: "name_rejected", rename_ticket: renameTicket(account, deviceToken)});
    return;
  }
  if (!byRefresh) {
    accounts.recordLogin(account, "launcher", from.address);
    accounts.save();
  }
  // the custom client's advanced settings; the official launcher sends none.
  accounts.setLoginChoices(account, body.login_choices);
  const token = byRefresh ? body.refresh_token : accounts.issueToken(account);
  send(res, 200, {auth_token: token, refresh_token: token, device_token: deviceToken});
};

const player = (req, res) => {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  const account = match && accounts.byToken(match[1]);
  if (!account) {
    send(res, 401, {error: "invalid_token"});
    return;
  }
  send(res, 200, {
    id: account.id,
    screen_name: account.username,
    game_account_type: account.accountType,
    language: "en",
    game_server: config.host,
  });
};

const handle = async (req, res) => {
  const url = new URL(req.url, config.baseUrl);
  const route = `${req.method} ${url.pathname}`;

  const from = limits.clientOf(req);

  // the web pages live under the site's name (config.siteUrl): one asked
  // for under the game server's name is sent there. what the game and the
  // client load stays here, the client's captcha page among it.
  if ((req.method === "GET" || req.method === "HEAD") && config.siteUrl !== config.baseUrl
    && String(req.headers.host || "").toLowerCase() === new URL(config.baseUrl).host && SITE_PAGES.test(url.pathname)) {
    res.writeHead(301, {Location: new URL(url.pathname + url.search, config.siteUrl).href, "Content-Length": 0});
    res.end();
    return;
  }

  const isAdmin = url.pathname === "/admin" || url.pathname.startsWith("/admin/");
  const isAccount = url.pathname === "/account" || url.pathname.startsWith("/account/");
  const isMod = url.pathname === "/mod" || url.pathname.startsWith("/mod/");

  // the pages that keep a cookie answer only under this server's own names:
  // a request sent here by a page of another name (one whose name was made
  // to point at this machine, say) is not theirs to make. nor is such a
  // request ever this machine's own, wherever it came from.
  if (!limits.hostAllowed(req)) {
    if (isAdmin || isAccount || isMod) {
      send(res, 421, {error: "wrong_host"});
      return;
    }
    from.local = false;
  }

  // the admin panel sets its own, stricter headers: none of the cross-origin
  // allowances below apply to it. on a public server it is not there at all
  // for anyone but this machine and the addresses named (config.adminAllow).
  if (isAdmin) {
    if (config.isPublic && !from.direct && !config.adminAllow.includes(from.address)) {
      send(res, 404, "Not found", "text/plain");
      return;
    }
    await panel.handle(req, res, url, from, {send, readJson});
    return;
  }

  if (isAccount) {
    await manage.handle(req, res, url, from, {send, readJson});
    return;
  }

  // and the moderator panel (lib/modpanel.js), which is there for anyone to
  // reach: its moderators are players, wherever they are.
  if (isMod) {
    await modpanel.handle(req, res, url, from, {send, readJson});
    return;
  }

  // the clients' own pages are files, which browsers call the origin "null":
  // those and this server's pages may read what the rest answers. no cookie
  // is used outside /account and /admin.
  const {origin} = req.headers;
  if (origin && (CLIENT_ORIGINS.includes(origin) || limits.originAllowed(req))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    // the item finder's API changes accounts, so other sites open in a
    // browser on this machine must not be able to call it.
    if (!limits.originAllowed(req)) {
      send(res, 403, {error: "forbidden"});
      return;
    }
    if (url.pathname === "/api/search" && !from.local && !searches.allow(from.key)) {
      send(res, 429, {error: "too_many_requests"});
      return;
    }
    const result = await admin.handle(route, url.searchParams, req.method === "POST" ? await readJson(req) : null, from);
    send(res, result.status, result.body);
    return;
  }

  const signupArt = req.method === "GET" && /^\/signup\/((?:thumb|hero)_[a-z]+\.svg)$/.exec(url.pathname);
  if (signupArt) {
    const art = await fs.promises.readFile(path.join(config.publicDir, "signup", signupArt[1])).catch(() => null);
    res.setHeader("Cache-Control", "public, max-age=86400");
    send(res, art ? 200 : 404, art || "Not found", art ? MIME[".svg"] : "text/plain");
    return;
  }

  // the font of the web pages, which is the game's own text font and the
  // client's (public/fonts/).
  const font = req.method === "GET" && /^\/fonts\/(CCDigitalDelivery-(?:Regular|Bold)\.otf)$/.exec(url.pathname);
  if (font) {
    res.setHeader("Cache-Control", "public, max-age=604800");
    send(res, 200, await fs.promises.readFile(path.join(config.publicDir, "fonts", font[1])), MIME[".otf"]);
    return;
  }

  // the chat filter's two word lists (public/filter/), which each player's
  // game fetches and applies itself. read from disk each time, so that a
  // change to a list is there for the next player to start the game.
  const wordList = req.method === "GET" && /^\/filter\/(level[12]\.txt)$/.exec(url.pathname);
  if (wordList) {
    const list = await fs.promises.readFile(path.join(config.publicDir, "filter", wordList[1])).catch(() => null);
    send(res, list ? 200 : 404, list || "Not found", "text/plain; charset=utf-8");
    return;
  }

  // updates for the installed clients (config.clientUpdatesDir). each is
  // signed, and the clients check that themselves; the bundle's name
  // carries its version, so it never changes once published.
  const clientUpdate = req.method === "GET" && /^\/client\/(latest\.json|app-\d+\.\d+\.\d+\.burrow)$/.exec(url.pathname);
  if (clientUpdate) {
    const file = await fs.promises.readFile(path.join(config.clientUpdatesDir, clientUpdate[1])).catch(() => null);
    const manifest = clientUpdate[1] === "latest.json";
    res.setHeader("Cache-Control", manifest ? "no-cache" : "public, max-age=31536000, immutable");
    send(res, file ? 200 : 404, file || "Not found", file ? (manifest ? MIME[".json"] : "application/octet-stream") : "text/plain");
    return;
  }

  // the badges and the Discord mark on player cards (public/badges/, lib/badges.js).
  const badgeArt = req.method === "GET" && /^\/badges\/([a-z0-9]{1,30}\.png)$/.exec(url.pathname);
  if (badgeArt) {
    const art = await fs.promises.readFile(path.join(config.publicDir, "badges", badgeArt[1])).catch(() => null);
    res.setHeader("Cache-Control", "public, max-age=3600");
    send(res, art ? 200 : 404, art || "Not found", art ? MIME[".png"] : "text/plain");
    return;
  }

  switch (route) {
    case "GET /register":
      await sendPage(res, "register.html", CAPTCHA_PAGE_HEADERS);
      return;
    // the captcha on its own, for the client, whose login page is a file
    // that cloudflare's widget does not run in.
    case "GET /captcha":
      await sendPage(res, "captcha.html", CAPTCHA_PAGE_HEADERS);
      return;
    case "GET /captcha.js": {
      const text = await fs.promises.readFile(path.join(config.publicDir, "captcha.js"), "utf8");
      send(res, 200, captcha.script(text), "text/javascript; charset=utf-8");
      return;
    }
    case "GET /terms":
      await sendLegalPage(res, "terms.html");
      return;
    case "GET /privacy":
      await sendLegalPage(res, "privacy.html");
      return;
    case "GET /":
      await sendHomePage(res);
      return;
    case "GET /logo.png":
    case "GET /logo-square.png":
    case "GET /favicon.ico":
      res.setHeader("Cache-Control", "public, max-age=86400");
      send(res, 200, await fs.promises.readFile(path.join(config.publicDir, url.pathname === "/logo.png" ? "logo.png" : "logo-square.png")), MIME[".png"]);
      return;
    case "GET /ban-icon.png": // the banned label on player cards (swf-src/BuddyCard.as)
      res.setHeader("Cache-Control", "public, max-age=86400");
      send(res, 200, await fs.promises.readFile(path.join(config.publicDir, "ban-icon.png")), MIME[".png"]);
      return;
    case "GET /bio-icon.png": // the button of the card's Bio tab
      res.setHeader("Cache-Control", "public, max-age=86400");
      send(res, 200, await fs.promises.readFile(path.join(config.publicDir, "bio-icon.png")), MIME[".png"]);
      return;
    case "GET /commands":
      await sendPage(res, "commands.html");
      return;
    case "GET /shop":
      await sendPage(res, "shop.html");
      return;
    case "GET /flashvars":
      send(res, 200, flashVars());
      return;
    case "POST /authenticate":
      await authenticate(req, res, from);
      return;
    case "GET /player":
      player(req, res);
      return;
    case "POST /v1/login":
      await readJson(req);
      send(res, 200, {});
      return;
    case "POST /v1/reportError": {
      // the launcher and the SWF both report crashes here; they are the best
      // clue for what the server got wrong. the patched SWF also sends
      // progress traces for media loads this way, which are only worth
      // having while debugging locally.
      const report = await readJson(req);
      // later lines are indented so a report cannot pass off its own text as
      // one of the server's log lines.
      const message = String(report.message).slice(0, MAX_REPORT_LENGTH).replace(/[^\x20-\x7e\n\t]/g, "?").replace(/\n\s*/g, "\n\t");
      const section = String(report.section).slice(0, 20).replace(/[^\w-]/g, "?");
      const trace = message.startsWith("media ");
      if (trace ? config.logPackets : from.local || errorReports.allow(from.key)) {
        console.log(`[${trace ? "client-trace" : "client-error"}] (${section}) ${message}`);
        if (!trace) {
          keepClientError(`${new Date().toISOString()} (${section}) ${message}\n`);
        }
      }
      send(res, 200, {});
      return;
    }
    // the Jammer Wall service (playerWallHost in the flashvars); every
    // command carries a token the game socket handed out, see lib/walls.js.
    case "POST /wall":
      send(res, 200, world.walls.http(await readJson(req)));
      return;
    // the Art Studio posts a painting to be made a masterpiece of (the
    // mdUrl flashvar + "mp"): a form with the token the game socket handed
    // out and the picture. ArtStudioPainting.onSendComplete reads the reply.
    case "POST /game/mp": {
      if (!from.local && !paintingPosts.allow(from.key)) {
        send(res, 429, {success: false});
        return;
      }
      const parts = formParts(req.headers["content-type"], await readBody(req, masterpieces.MAX_IMAGE_BYTES + 16 * 1024));
      const uuid = masterpieces.upload(String(parts.get("authToken") || ""), parts.get("image"));
      send(res, 200, uuid ? {success: true, uuid} : {success: false});
      return;
    }
    case "GET /crossdomain.xml":
      send(res, 200, CROSS_DOMAIN, "text/xml");
      return;
    case "GET /gameClient/game/index.html":
      // not to be put in a frame of anyone's; the client shows it in a view of its own.
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "no-referrer");
      send(res, 200, await fs.promises.readFile(path.join(config.publicDir, "game.html")), MIME[".html"]);
      return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    console.log(`[http] unhandled ${route}`);
    send(res, 404, {error: "not_found"});
    return;
  }

  if (config.logPackets) {
    console.log(`[http] GET ${url.pathname}`);
  }

  // asset SWFs import their fonts from this fixed path next to the game page;
  // the launcher ships its own copy.
  if (url.pathname === "/gameClient/sharedFonts.swf") {
    send(res, 200, await fs.promises.readFile(config.sharedFontsSwf), MIME[".swf"]);
    return;
  }

  // the patched client is served in place of the CDN's own copy.
  if (url.pathname.endsWith("/ajclient.swf")) {
    send(res, 200, await fs.promises.readFile(config.clientSwf), MIME[".swf"]);
    return;
  }

  // A painting, by its id (MasterpieceFileServer).
  const painting = PAINTING_PATH.exec(url.pathname);
  if (painting) {
    const playingFrom = account => {
      const session = world.findOnline(account.username);
      return session ? limits.key(session.address) : null;
    };
    const picture = masterpieces.mayView(painting[1], from.key, playingFrom) || from.local ? masterpieces.image(painting[1]) : null;
    send(res, picture ? 200 : 404, picture || "Not found", picture ? MIME[".jpg"] : "text/plain");
    return;
  }

  const relPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (relPath === HUD_ASSETS_PATH) {
    send(res, 200, await fs.promises.readFile(config.hudAssetsSwf), MIME[".swf"]);
    return;
  }
  // the name tag badges of ours and the card's Bio tab, which the CDN has no file for.
  const badgeMedia = badges.mediaFile(relPath) || badges.cardMedia(relPath);
  if (badgeMedia) {
    const body = await fs.promises.readFile(badgeMedia).catch(() => null);
    send(res, body ? 200 : 404, body || "Not found", body ? MIME[".swf"] : "text/plain");
    return;
  }
  // the extra den music tracks, which the CDN does not have as files.
  const extra = await extraMusic.asset(relPath);
  if (extra) {
    send(res, extra.body ? 200 : 404, extra.body || "Not found", extra.body ? extra.type : "text/plain");
    return;
  }
  const clientPack = await defpacks.clientPack(relPath);
  if (clientPack) {
    send(res, 200, clientPack, "application/octet-stream");
    return;
  }
  // A room file in a seasonal theme ("<build>/roomDefs/theme_<other
  // build>/...", see roomAsSeenBy in world.js) comes from that other build,
  // or from the current one when the room did not exist yet back then.
  const themed = THEMED_ROOM.exec(relPath);
  const mayFetch = () => from.local || cacheMisses.allow(from.key);
  const body = (themed && Object.values(config.themes).some(theme => theme.build === Number(themed[2])) && await cdn.get(`${themed[2]}/roomDefs/${themed[3]}`, mayFetch))
    || await cdn.get(themed ? `${themed[1]}/roomDefs/${themed[3]}` : relPath, mayFetch);
  if (!body) {
    console.log(`[http] 404 ${url.pathname}`);
    send(res, 404, "Not found", "text/plain");
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
  send(res, 200, body, MIME[path.extname(relPath).toLowerCase()] || "application/octet-stream");
};

const start = () => new Promise((resolve, reject) => {
  const onRequest = (req, res) => {
    handle(req, res).catch(err => {
      console.log(`[http] ${req.method} ${req.url} failed: ${err.message}`);
      if (!res.headersSent) {
        send(res, 500, {error: "server_error"});
      }
      else {
        res.destroy();
      }
    });
  };
  const server = config.webTls
    ? https.createServer({cert: fs.readFileSync(config.webTls.certFile), key: fs.readFileSync(config.webTls.keyFile)}, onRequest)
    : http.createServer(onRequest);
  // nobody gets to hold a request open by trickling it in, nor a reply by
  // never reading it; and there is an end to how many connections there
  // may be, in all and from one address.
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.timeout = config.httpSocketTimeoutMs;
  server.maxConnections = config.maxHttpConnections;
  const open = new Map(); // address, as limits count it -> connections
  server.on("connection", socket => {
    const address = limits.key(socket.remoteAddress);
    // behind a proxy every connection is the proxy's own.
    if (limits.isLoopback(socket.remoteAddress)) {
      return;
    }
    const count = (open.get(address) || 0) + 1;
    if (count > config.maxHttpConnectionsPerAddress) {
      socket.destroy();
      return;
    }
    open.set(address, count);
    socket.once("close", () => {
      const left = open.get(address) - 1;
      if (left > 0) {
        open.set(address, left);
      }
      else {
        open.delete(address);
      }
    });
  });
  server.once("error", reject);
  server.listen(config.httpPort, config.bindAddress, () => {
    console.log(`[http] listening on ${config.bindAddress}:${config.httpPort}${config.webTls ? " (TLS)" : ""}`);
    resolve(server);
  });
});

module.exports = {start};

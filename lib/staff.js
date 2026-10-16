"use strict";

const accounts = require("./accounts.js");
const bans = require("./bans.js");
const manage = require("./manage.js");
const support = require("./support.js");
const world = require("./world.js");

// what the admin panel (lib/panel.js) and the moderator panel
// (lib/modpanel.js) both do. `by` is who is doing it, for the record:
// "admin", or a moderator's username.

const disciplined = () => accounts.all()
  .map(account => {
    const ban = world.moderation.banOf(account);
    return {
      username: account.username,
      banned: ban ? ban.seconds : 0,
      reason: ban ? ban.reason : "",
      by: ban ? ban.by : "",
      since: ban ? ban.since : null,
      silenced: world.moderation.silenceRemaining(account),
    };
  })
  .filter(entry => entry.banned !== 0 || entry.silenced !== 0)
  .sort((a, b) => a.username.localeCompare(b.username));

// the accounts that signed in from an address, or from any address that
// starts with what was typed ("203.0.113." for the lot): from the sign-in
// histories, which hold the last 90 days (lib/accounts.js). failed tries
// are left out, being anyone's. returns {error} or {players: [{username,
// online, addresses: [{address, at}], lastAt}]}, the latest first.
const MIN_ADDRESS_QUERY = 3;
const MAX_ADDRESS_FOUND = 100;
const byAddress = query => {
  const wanted = String(query || "").trim().toLowerCase().replace(/^::ffff:/, "").slice(0, 60);
  if (wanted.length < MIN_ADDRESS_QUERY || !/^[0-9a-f.:]+$/.test(wanted) || !/[.:]/.test(wanted)) {
    return {error: "Type at least the start of an IP address, like 203.0.113."};
  }
  const players = [];
  for (const account of accounts.all()) {
    const seen = new Map();
    for (const login of account.logins) {
      if (login.ok && login.address && login.address.toLowerCase().startsWith(wanted)) {
        seen.set(login.address, Math.max(seen.get(login.address) || 0, login.at));
      }
    }
    if (seen.size > 0) {
      const addresses = [...seen].map(([address, at]) => ({address, at})).sort((one, other) => other.at - one.at);
      players.push({username: account.username, online: Boolean(world.findOnline(account.username)), addresses, lastAt: addresses[0].at});
    }
  }
  return {players: players.sort((one, other) => other.lastAt - one.lastAt).slice(0, MAX_ADDRESS_FOUND)};
};

const ADDRESS_ERRORS = {
  not_an_address: "Not an IP address.",
  own_address: "That is this machine's own address: with a proxy or a tunnel in front, everyone's.",
  already: "Already banned.",
  too_many: "Too many banned addresses.",
};

// bans an address for good and puts out whoever plays from it.
// returns {ban, out} or {error: text}.
const banAddress = (address, reason, by) => {
  const result = bans.banAddress(address, reason, by);
  return result.error ? {error: ADDRESS_ERRORS[result.error]} : {ban: result.ban, out: world.disconnectAddress(result.ban.address)};
};

// appeals with what each is against, as it stands now.
const appealsFor = handled => bans.appeals(handled).map(appeal => {
  const account = accounts.byId(appeal.accountId);
  const ban = account ? world.moderation.banOf(account) : null;
  const address = appeal.addressKey ? bans.addressBan(appeal.addressKey) : null;
  return {...appeal, username: account ? account.username : appeal.username, gone: !account,
    ban: ban && {seconds: ban.seconds, reason: ban.reason}, address: address && {key: address.key, reason: address.reason}};
});

// an appeal answered: approved lifts the account's ban, and the ban on the
// address it was written from when it was about that.
const answerAppeal = (accountId, approved, reply, by) => {
  const appeal = bans.waitingAppeal(accountId);
  if (!appeal) {
    return {error: "No such appeal waiting."};
  }
  bans.answerAppeal(appeal.accountId, approved, reply, by);
  const account = accounts.byId(appeal.accountId);
  if (!approved) {
    return {ok: `${appeal.username} stays banned.`, username: appeal.username};
  }
  if (account) {
    world.moderation.actions.unban(account, by);
  }
  if (appeal.addressKey) {
    bans.unbanAddress(appeal.addressKey, by);
  }
  return {ok: `${appeal.username} is no longer banned.`, username: appeal.username};
};

// A player's request for another username, approved or denied. the player
// picked the name under the sign-up rules; they are checked again, since it
// may have been taken while it waited.
const answerNameRequest = (id, approve) => {
  const request = support.nameRequestById(id);
  const account = request && accounts.byId(request.accountId);
  if (!request) {
    return {error: "No such request waiting."};
  }
  if (!approve || !account) {
    support.answerNameRequest(request.id, false);
    return {ok: account ? `${account.username} keeps their name.` : "That account is gone; the request was closed.", username: account ? account.username : ""};
  }
  world.disconnect(account);
  manage.forget(account);
  const oldName = account.username;
  const problem = accounts.rename(account, request.newName);
  if (problem) {
    return {error: problem === "username_taken" ? "That username has been taken since. Deny the request."
      : "That name does not pass the sign-up rules."};
  }
  support.answerNameRequest(request.id, true);
  return {ok: `${oldName} is now called ${account.username}. They log in with the new name and the same password.`, username: account.username};
};

module.exports = {disciplined, byAddress, banAddress, appealsFor, answerAppeal, answerNameRequest};

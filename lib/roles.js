"use strict";

const totp = require("./totp.js");

// staff roles, and what each may do. an account holds at most one role
// (`role` on the account), set by the admin. an account from before roles
// that is only marked `moderator` counts as a moderator, so nothing that
// worked before stops working.
//
// a role is a list of permissions, and every staff action checks the one it
// needs, in the moderator panel (lib/modpanel.js) and in the game
// (lib/commands.js) alike. a higher role holds everything a lower one does.
// staff never act on staff of their own rank or above: that is for someone
// higher up, and for the admin in the end.

const PERMISSIONS = {
  "player.view": "see players, chat, reports, requests, bans and paintings in the moderator panel",
  "staff.list": "see which staff are online (!staff)",
  "player.warn": "warn a player and send them a message (!warn, !warnings, !message)",
  "player.goto": "go to the room a player is in (!goto)",
  "chat.silence": "silence and unsilence a player (!silence)",
  "player.kick": "disconnect a player (!kick)",
  "player.summon": "bring a player to the room you are in (!summon)",
  "player.ban": "ban, unban and change a ban's reason",
  "player.names": "reject or accept a name, clear a bio",
  "address.ban": "ban the address a player last signed in from",
  "items.create": "make new items from the game's art, and change them (!item)",
};

const HELPER = ["player.view", "staff.list", "player.warn", "player.goto", "chat.silence"];
const MODERATOR = [...HELPER, "player.kick", "player.summon", "player.ban", "player.names", "address.ban"];
const ADMIN = [...MODERATOR, "items.create"];
// a developer makes things, and moderates nobody.
const DEVELOPER = ["staff.list", "items.create"];

const ROLES = {
  developer: {rank: 1, label: "Developer", permissions: DEVELOPER},
  helper: {rank: 1, label: "Helper", permissions: HELPER},
  moderator: {rank: 2, label: "Moderator", permissions: MODERATOR},
  admin: {rank: 3, label: "Admin", permissions: ADMIN},
};

// the role an account holds, or null.
const roleOf = account => {
  if (!account) {
    return null;
  }
  if (Object.hasOwn(ROLES, account.role)) {
    return account.role;
  }
  return account.moderator ? "moderator" : null;
};

const rankOf = account => {
  const role = roleOf(account);
  return role ? ROLES[role].rank : 0;
};

// may this account act as staff at all right now? as for the moderator
// panel: a role, 2FA turned on, not locked and not banned. `banned` says
// whether the account is banned (passed in, so that this file needs nothing
// of the world's).
const isActiveStaff = (account, banned = false) =>
  Boolean(roleOf(account) && totp.isOn(account) && !account.locked && !banned);

const permissionsOf = account => {
  const role = roleOf(account);
  return role ? [...ROLES[role].permissions] : [];
};

const can = (account, permission, banned = false) =>
  isActiveStaff(account, banned) && ROLES[roleOf(account)].permissions.includes(permission);

// may `actor` act on `target`? never on themselves, nor on staff of their
// own rank or above.
const outranks = (actor, target) => actor !== target && rankOf(actor) > rankOf(target);

// sets the role (one of ROLES, or null for none). `moderator` is kept in
// step for anything that still reads it.
const setRole = (account, role) => {
  if (role === null || role === "" || role === "none") {
    delete account.role;
    delete account.moderator;
    return true;
  }
  if (!Object.hasOwn(ROLES, role)) {
    return false;
  }
  account.role = role;
  account.moderator = true;
  return true;
};

module.exports = {PERMISSIONS, ROLES, roleOf, rankOf, isActiveStaff, permissionsOf, can, outranks, setRole};

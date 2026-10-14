"use strict";

const accounts = require("./accounts.js");
const achievements = require("./achievements.js");
const config = require("../config.js");
const defpacks = require("./defpacks.js");
const epicDens = require("./epicdens.js");
const masterpieces = require("./masterpieces.js");
const {CURRENCIES, MAX_DEN_ITEMS, hasRoom, activeAvatar, resolvePurchase, isUint} = require("./player.js");

// den items: owning, placing and recycling furniture (client side:
// DenXtCommManager, DenItemHolder, DenEditor).

const MAX_DENS = 200;
const MAX_SAVED_AT_ONCE = 1000; // den items in one save: as many as a den holds (gui.DenEditor)
const MAX_RECYCLED_AT_ONCE = 500;
const DEF_DEN_ROOM = 1040;

// den privacy (BuddyCard.onDenPrivacyResponse)
const DEN_LOCKED = 0;
const DEN_BUDDIES_ONLY = 1;
const DEN_OPEN = 2;

// loadRoom's roomType for a den (DenXtCommManager.denChangeResponse)
const ROOM_TYPE_DEN = 2;

const activeDen = account => account.dens.find(den => den.inv === account.activeDen) || account.dens[0];

const canEnter = (owner, visitor) => owner === visitor || owner.denPrivacy === DEN_OPEN
  || (owner.denPrivacy === DEN_BUDDIES_ONLY && owner.buddies.includes(visitor.username.toLowerCase()));
const RECYCLE_FRACTION = 0.3; // matches recyclePercentage sent at login
const FIELDS_PER_SAVED_ITEM = 17;
const REF_DEN_ITEM = "0"; // "1" would be a pet placed in the den
const CURRENCY_DIAMONDS = 3;

// mannequins: den items (special type 4) that stand as an animal in clothes
// of the owner's. what one wears is kept on the den item as `mannequin`:
// {colors: [base, pattern, eyes], pattern, eyes, worn: [tail, leg, back,
// neck, head]}, the five being inventory ids of clothing, 0 for none. A 0
// colour or def means the animal type's own (MannequinData.setupBodMods).
// the clothes stay in the owner's inventory and may leave it; a mannequin
// simply stops wearing what is no longer there.
const SPECIAL_MANNEQUIN = "4";
// which clothing layers go in which of the five places (MannequinData.updateLayer).
const MANNEQUIN_SLOT_LAYERS = [["4"], ["5"], ["6"], ["7"], ["8", "9", "10"]];
const LAYER_PATTERN = "2";
const LAYER_EYES = "3";

const isMannequin = item => (defpacks.denItemDef(item.def) || {}).specialType === SPECIAL_MANNEQUIN;

const mannequinOf = item => item.mannequin || {colors: [0, 0, 0], pattern: 0, eyes: 0, worn: [0, 0, 0, 0, 0]};

const mannequinBody = ({colors, pattern, eyes}) => [colors[0], colors[1], pattern, colors[2], eyes];

// the clothing a mannequin of `owner`'s wears, slot by slot (undefined for
// an empty slot or a piece the owner no longer has).
const mannequinClothes = (owner, item) => mannequinOf(item).worn.map(inv => (inv ? owner.items.find(piece => piece.inv === inv) : undefined));

// for the owner's own list (MannequinData.setupDataInvIdsOnly): the body,
// then the five inventory ids.
const mannequinOwnFields = (owner, item) =>
  (isMannequin(item) ? [...mannequinBody(mannequinOf(item)), ...mannequinClothes(owner, item).map(piece => (piece ? piece.inv : 0))] : []);

// for whoever looks at the den (setupDataFull): the body, then for each
// slot the clothing's def id and, when there is one, its colour and
// inventory id.
const mannequinShownFields = (owner, item) =>
  (isMannequin(item) ? [...mannequinBody(mannequinOf(item)), ...mannequinClothes(owner, item).flatMap(piece => (piece ? [piece.def, piece.color, piece.inv] : [0]))] : []);

// what the den editor sent for one mannequin, checked: [baseColor,
// patternColor, patternDefId, eyeColor, eyeDefId, tail, leg, back, neck,
// head]. null when any of it is not a whole number in range.
const readMannequin = (account, fields) => {
  if (fields.length !== 10 || !fields.every(isUint)) {
    return null;
  }
  const [base, patternColor, pattern, eyeColor, eyes, ...worn] = fields.map(Number);
  const bodyPart = (defId, layer) => (defId && (defpacks.itemDef(defId) || {}).layerId === layer ? defId : 0);
  return {
    colors: [base, patternColor, eyeColor],
    pattern: bodyPart(pattern, LAYER_PATTERN),
    eyes: bodyPart(eyes, LAYER_EYES),
    worn: worn.map((inv, slot) => {
      const piece = inv && account.items.find(candidate => candidate.inv === inv);
      const def = piece && defpacks.itemDef(piece.def);
      return def && MANNEQUIN_SLOT_LAYERS[slot].includes(def.layerId) ? inv : 0;
    }),
  };
};

// DenXtCommManager.denItemsResponse: [activeDenIdx, count, ?, (invIdx, defId,
// placed, version, approved, imageId, creatorDbId, creatorUuid, [mannequin],
// denStoreInvId)...]. the three after "approved" are a masterpiece's
// (lib/masterpieces.js); one not approved yet the client keeps out of dens,
// trades and the recycler.
const sendDenItems = session => {
  const {account} = session;
  const {denItems} = account;
  session.sendXt("di", -1, account.activeDen, denItems.length, 0,
    ...denItems.flatMap(item => [item.inv, item.def, item.placed ? 1 : 0, item.version, masterpieces.itemApproved(item), ...masterpieces.itemFields(item),
      ...mannequinOwnFields(account, item), 0]));
};

// DenXtCommManager.denStateResponse: [itemCount, petCount, forceReload,
// (invIdx, defId, placed, x, y, version, flipped, userNameLink, imageId,
// creatorDbId, creatorUuid, [mannequin], ?)...]. forceReload makes the client finish a
// pending room change, so it is set when the den has just been entered.
const sendDenState = (session, room, forceReload = true) => {
  const placed = room.denOwner.denItems.filter(item => item.placed && item.den === room.denOwner.activeDen && masterpieces.itemApproved(item));
  session.sendXt("ds", room.id, placed.length, 0, forceReload ? 1 : 0,
    ...placed.flatMap(item => [item.inv, item.def, 1, item.x, item.y, item.version, item.flip, "", ...masterpieces.itemFields(item),
      ...mannequinShownFields(room.denOwner, item), 0]));
};

// adds a den item to an account; used by purchases, prizes and the item
// finder. null when the inventory is full.
const giveDenItem = (account, defId, version = 0) => {
  if (!hasRoom(account, "denItems")) {
    return null;
  }
  const item = {inv: account.nextInv++, def: Number(defId), version: Number(version) || 0, placed: false, den: account.activeDen, x: 0, y: 0, flip: 0};
  account.denItems.push(item);
  accounts.save();
  return item;
};

// puts every placed item back in the owner's inventory and empties the den
// on the screens of everyone inside it (DenXtCommManager.denEmptyResponse).
const clearDen = (owner, findOnline) => {
  // kept so that "!den undo" can put it back (lib/commands.js).
  const placed = owner.denItems.filter(item => item.placed && item.den === owner.activeDen);
  if (placed.length) {
    owner.denUndo = {den: owner.activeDen, items: placed.map(item => ({def: item.def, version: item.version, x: item.x, y: item.y, flip: item.flip}))};
  }
  for (const item of owner.denItems.filter(candidate => candidate.den === owner.activeDen)) {
    item.placed = false;
    item.x = item.y = item.flip = 0;
  }
  accounts.save();
  const ownerSession = findOnline(owner.username);
  const room = ownerSession && ownerSession.room && ownerSession.room.denOwner === owner ? ownerSession.room : null;
  for (const session of room ? room.sessions : []) {
    session.sendXt("de", room.id);
  }
  if (ownerSession) {
    sendDenItems(ownerSession);
  }
};

// the room a player's den in use is: {base, defId, enviroType, roomType, secondaryDefId}.
const denRoom = owner => {
  const den = activeDen(owner);
  const base = defpacks.denRoomName(den.def) || defpacks.denRoomName(config.denDefId);
  const def = defpacks.roomDef(base);
  return {base, defId: Number(def.id), enviroType: Number(def.type), roomType: ROOM_TYPE_DEN, secondaryDefId: den.def};
};

// RoomXtCommManager.roomPropertiesResponse -> RoomManagerWorld.loadRoom
// (path, enviroType, roomType, secondaryDefId, zoom, roomDefId, customData)
const sendRoomProperties = (session, room) => {
  // customData is JSON the room is made with; made when asked for, so that
  // it is current (a function on the room, or nothing).
  const customData = room.customData ? JSON.stringify(room.customData()) : "";
  session.sendXt("rp", room.id, room.base, room.enviroType, room.roomType, room.secondaryDefId, 100, room.defId, customData);
};

const handlers = ({others, findOnline}) => {
  const inOwnDen = session => session.room && session.room.denOwner === session.account;

  // DenXtCommManager.denListResponse: [count, (invId, denDefId)...]
  const sendDenList = session => {
    const {dens} = session.account;
    session.sendXt("dl", -1, dens.length, ...dens.flatMap(den => [den.inv, den.def]));
  };

  // A den room from a den shop, paid for in gems. the client asks for the
  // den list again by itself once the purchase is confirmed.
  // A den's inventory id is the slot it sits in on the den switcher (0 to
  // 199): the client asks for the slot it wants filled, keeps its den list
  // by that number and looks the new den up there when the purchase is
  // confirmed (DenSwitcher.purchasedDenRoomCallback).
  const freeSlot = (account, wanted) => {
    const taken = new Set(account.dens.map(den => den.inv));
    if (Number.isInteger(wanted) && wanted >= 0 && wanted < MAX_DENS && !taken.has(wanted)) {
      return wanted;
    }
    return Array.from({length: MAX_DENS}, (_, slot) => slot).find(slot => !taken.has(slot));
  };

  const buyDen = (session, defId, isDiamond, slot) => {
    const {account} = session;
    // den rooms priced in gems have no currency field of their own.
    const purchase = resolvePurchase(defId, isDiamond, "denRoom", id => ({cost: Number((defpacks.denRoomDef(id) || {}).cost) || 0, currencyType: 0}));
    const currency = purchase && CURRENCIES[purchase.currencyType];
    if (!purchase || !defpacks.denRoomDef(purchase.defId) || !defpacks.denRoomName(purchase.defId) || account.dens.length >= MAX_DENS
      || (account.currency[currency] || 0) < purchase.cost) {
      session.sendXt("db", -1, 0, "", 0, 0, 0);
      return;
    }
    account.currency[currency] -= purchase.cost;
    achievements.currencyChanged(account, currency, -purchase.cost);
    account.dens.push({inv: freeSlot(account, /^\d{1,3}$/.test(String(slot)) ? Number(slot) : NaN), def: purchase.defId});
    accounts.save();
    session.sendXt("db", -1, 1, account.currency[currency], 0, purchase.currencyType, 0);
    sendDenList(session);
  };

  // A painting framed: the Art Studio's purchase (lib/masterpieces.js, step
  // 3), paid with two diamonds or with a Masterpiece Token from the
  // inventory. the reply's last field is the new item's inventory id.
  const buyMasterpiece = (session, defId, frame, withToken, paintingId) => {
    const {account} = session;
    const diamond = defpacks.diamondDef(defId);
    const cost = diamond ? Number(diamond.cost) : 0;
    const token = account.denItems.find(item => item.def === masterpieces.TOKEN_DEN_ITEM);
    if (defId !== masterpieces.DIAMOND_DEF || !diamond || !masterpieces.claimable(account, paintingId, frame)
      || account.denItems.length >= MAX_DEN_ITEMS || (withToken ? !token : (account.currency.diamonds || 0) < cost)) {
      session.sendXt("db", -1, 0, "", 0, 0, 0);
      return;
    }
    if (withToken) {
      account.denItems.splice(account.denItems.indexOf(token), 1);
    }
    else {
      account.currency.diamonds -= cost;
      achievements.currencyChanged(account, "diamonds", -cost);
    }
    masterpieces.claim(paintingId, frame);
    const item = giveDenItem(account, masterpieces.DEN_ITEM, frame);
    item.image = String(paintingId);
    accounts.save();
    console.log(`[world] ${account.username} made masterpiece ${item.image}${masterpieces.itemApproved(item) ? "" : " (waiting for review in the admin panel)"}`);
    session.sendXt("db", -1, 1, account.currency.diamonds || 0, 0, CURRENCY_DIAMONDS, item.inv);
    sendDenItems(session);
  };

  return {
    di(session) {
      sendDenItems(session);
    },

    // PlayerWallGui.setupMasterpieces and the like: [username] -> the
    // approved masterpieces that player has (denMasterpieceInventoryResponse:
    // [count, (defId, invIdx, version, approved, imageId, creatorDbId,
    // creatorUuid)...]).
    dmi(session, roomId, [username]) {
      const owner = accounts.byName(username);
      const hung = owner ? owner.denItems.filter(item => item.image && masterpieces.itemApproved(item)) : [];
      session.sendXt("dmi", -1, hung.length, ...hung.flatMap(item => [item.def, item.inv, item.version, "true", ...masterpieces.itemFields(item)]));
    },

    // MasterpiecePreview: [ownerName, paintingId] -> [who painted it]
    dmc(session, roomId, [, paintingId]) {
      const maker = masterpieces.creatorOf(paintingId);
      session.sendXt("dmc", -1, maker ? maker.username : "");
    },

    // DenXtCommManager.requestBuy: ["0" item | "-1" den room, shopId, defId,
    // version (items) or den slot (rooms), isDiamondItem, ...]. for something
    // priced in diamonds defId is its diamond def's id. the reply
    // (denBuyResponse) is [status, newAmount, ?, currencyType, ?].
    db(session, roomId, [kind, shopId, defId, version, isDiamondItem, isMasterpiece, withToken, paintingId]) {
      const {account} = session;
      if (kind === "-1") {
        buyDen(session, defId, isDiamondItem === "1", version);
        return;
      }
      if (kind === "0" && isMasterpiece === "1") {
        buyMasterpiece(session, Number(defId), Number(version), withToken === "1", paintingId);
        return;
      }
      const purchase = resolvePurchase(defId, isDiamondItem === "1", "denItem", id => {
        const own = defpacks.denItemDef(id);
        return {cost: own ? Number(own.cost) : 0, currencyType: own ? Number(own.currencyType) : -1};
      });
      const def = purchase && defpacks.denItemDef(purchase.defId);
      const currency = purchase && CURRENCIES[purchase.currencyType];
      // combined costs and special item types other than mannequins are refused.
      if (kind !== "0" || !def || !defpacks.denItemIds().includes(purchase.defId) || !currency
        || account.denItems.length >= MAX_DEN_ITEMS || (account.currency[currency] || 0) < purchase.cost) {
        session.sendXt("db", -1, 0, "", 0, 0, 0);
        return;
      }
      account.currency[currency] -= purchase.cost;
      achievements.currencyChanged(account, currency, -purchase.cost);
      achievements.add(account, achievements.VARS.denItemsBought);
      giveDenItem(account, purchase.defId, version);
      session.sendXt("db", -1, 1, account.currency[currency], 0, purchase.currencyType, 0);
      sendDenItems(session);
    },

    // DenXtCommManager.requestDenStateChange: [count, (refType, invIdx, placed,
    // x, y, flipped, userNameLink, 10 mannequin fields)...]. the reply
    // (DenEditor.onDenSaveSet) lists the inventory ids that were applied.
    ds(session, roomId, params) {
      const {account} = session;
      const count = Number(params[0]);
      if (!Number.isInteger(count) || count < 0 || count > MAX_SAVED_AT_ONCE || params.length !== 1 + count * FIELDS_PER_SAVED_ITEM) {
        session.sendXt("dss", -1);
        return;
      }
      const applied = [];
      const byInv = new Map(account.denItems.map(candidate => [candidate.inv, candidate]));
      const mannequins = account.denItems.filter(candidate => candidate.mannequin);
      for (let i = 0; i < count; i++) {
        const [refType, invIdx, placed, x, y, flip, , ...outfit] = params.slice(1 + i * FIELDS_PER_SAVED_ITEM, 1 + (i + 1) * FIELDS_PER_SAVED_ITEM);
        const item = byInv.get(Number(invIdx));
        if (refType !== REF_DEN_ITEM || !item || ![x, y, flip].every(value => Number.isInteger(Number(value)))
          || (placed === "1" && !masterpieces.itemApproved(item))) {
          continue;
        }
        item.placed = placed === "1";
        item.den = account.activeDen;
        item.x = item.placed ? Number(x) : 0;
        item.y = item.placed ? Number(y) : 0;
        item.flip = item.placed ? Number(flip) : 0;
        const mannequin = isMannequin(item) && readMannequin(account, outfit);
        if (mannequin) {
          // A piece of clothing is on one mannequin at a time.
          for (const other of mannequins) {
            if (other !== item && other.mannequin) {
              other.mannequin.worn = other.mannequin.worn.map(inv => (mannequin.worn.includes(inv) ? 0 : inv));
            }
          }
          if (!item.mannequin) {
            mannequins.push(item);
          }
          item.mannequin = mannequin;
        }
        applied.push(item.inv);
      }
      accounts.save();
      session.sendXt("dss", -1, ...applied);
      if (inOwnDen(session)) {
        for (const other of others(session)) {
          sendDenState(other, session.room, false);
        }
      }
    },

    // DenXtCommManager.requestRecycle: ["0" items | "-1" den rooms, "inv,inv,..."].
    // the reply (denRecycleResponse) is [count, newGemTotal, ...recycledInvIdx],
    // and the recycling window then waits for a den item list (its
    // recycleDiCallback) before it lets go of its spinner.
    dr(session, roomId, [kind, invList]) {
      const {account} = session;
      const recycled = [];
      for (const invIdx of kind === "0" ? new Set(String(invList).split(",", MAX_RECYCLED_AT_ONCE).map(Number)) : []) {
        const index = account.denItems.findIndex(item => item.inv === invIdx);
        if (index === -1 || !masterpieces.itemApproved(account.denItems[index])) {
          continue;
        }
        const def = defpacks.denItemDef(account.denItems[index].def);
        if (def && def.currencyType === "0") {
          const refund = Number(def.recycleValue) || Math.floor(Number(def.cost) * RECYCLE_FRACTION);
          account.currency.gems += refund;
          achievements.currencyChanged(account, "gems", refund);
        }
        account.denItems.splice(index, 1);
        recycled.push(invIdx);
      }
      accounts.save();
      session.sendXt("dr", -1, recycled.length, account.currency.gems, ...recycled);
      if (recycled.length) {
        sendDenItems(session);
      }
      if (recycled.length && inOwnDen(session)) {
        for (const other of others(session)) {
          sendDenState(other, session.room, false);
        }
      }
    },

    // DenXtCommManager.requestEmptyDen: the owner's own "clear den" button.
    de(session) {
      clearDen(session.account, findOnline);
      if (!inOwnDen(session)) {
        session.sendXt("de", -1);
      }
    },

    dl(session) {
      sendDenList(session);
    },

    // DenXtCommManager.requestDenChange: [denInvIdx]. the reply
    // (denChangeResponse: [denDefId, perUserAvId, petInvId]) makes the owner's
    // client load the new den; visitors are sent the new room as well.
    dc(session, roomId, [invIdx]) {
      const {account} = session;
      const den = account.dens.find(candidate => candidate.inv === Number(invIdx));
      if (!den) {
        return;
      }
      account.activeDen = den.inv;
      accounts.save();
      const avatar = activeAvatar(account);
      session.sendXt("dc", -1, den.def, avatar.perUserAvId, avatar.petInvId);
      if (inOwnDen(session)) {
        const {room} = session;
        Object.assign(room, denRoom(account));
        for (const other of others(session)) {
          sendRoomProperties(other, room);
        }
        for (const occupant of room.sessions) {
          sendDenState(occupant, room);
        }
      }
    },

    // the "Epic Dens" list on the world map (denHighestResponse: [count,
    // name...]): today's showcase dens, see lib/epicdens.js.
    dh(session) {
      const names = epicDens.list();
      session.sendXt("dh", -1, names.length, ...names);
    },

    // ["1", username]: who may enter that player's den?
    // (BuddyManager.onDenPrivacyResponse: [username, setting])
    // ["0", setting]: change one's own setting.
    dp(session, roomId, [mode, value]) {
      if (mode === "1") {
        const owner = accounts.byName(value);
        session.sendXt("dp", -1, value, owner ? owner.denPrivacy : DEN_LOCKED);
      }
      else if ([DEN_LOCKED, DEN_BUDDIES_ONLY, DEN_OPEN].includes(Number(value))) {
        session.account.denPrivacy = Number(value);
        accounts.save();
      }
    },
  };
};

module.exports = {handlers, sendDenState, sendDenItems, sendRoomProperties, giveDenItem, clearDen, denRoom, canEnter, DEF_DEN_ROOM};

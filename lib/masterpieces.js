"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const config = require("../config.js");
const accounts = require("./accounts.js");
const limits = require("./limits.js");
const imageModeration = require("./image-moderation.js");

// masterpieces: paintings from the Art Studio, framed and hung in a den
// (client side: game.artStudioPainting.ArtStudioPainting, the same in
// ArtStudioGridDrawing, masterpiece.MasterpieceDisplayItem,
// gui.MasterpiecePreview).
//
// how one comes about, in the client's order:
//   1. the game asks for an upload token over the game socket ("gmtkn").
//   2. it posts the painting, a JPEG, with that token to the web server
//      (the mdUrl flashvar + "mp") and is told the painting's id.
//   3. it buys the Masterpiece den item (diamond def 221) naming that id
//      and the frame picked, for two diamonds or a Masterpiece Token.
//   4. the item is in the inventory but "not approved": the client will
//      not place, trade or recycle it. whoever runs the server looks at it
//      in the admin panel and approves or rejects it. (That review can be
//      switched off there; paintings are then approved as they are bought.)
// Everyone's client fetches a painting from "masterpieces/<id>" on the
// content server when it has to draw it.
//
// A painting lives here, in a table of its own: who made it and where it
// stands. the picture is a file, data/masterpieces/<id>.jpg (the table's
// `image` column held it once, and is left empty now: pictures made the
// one file with every account in it many times its size). the den item made from it carries the painting's id
// (`image` on the den item, see lib/dens.js) and can change hands; the
// painting's maker stays who it was.

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS masterpieces (
    id          TEXT PRIMARY KEY,
    creator_id  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    status      INTEGER NOT NULL,
    frame       INTEGER NOT NULL,
    reviewed_at INTEGER,
    likes       TEXT NOT NULL,
    image       BLOB NOT NULL
  );
`;

const UPLOADED = 0; // posted, not made into an item yet
const PENDING = 1; // an item, waiting to be looked at
const APPROVED = 2;

const DEN_ITEM = 2725; // "Masterpiece" (DenItem.isCustom)
const TOKEN_DEN_ITEM = 2947; // "Masterpiece Token": pays for one in place of diamonds
const DIAMOND_DEF = 221; // what the Art Studio buys
// the frames, in the order the client numbers them (generic list 424; a
// masterpiece's den item "version" is an index into it), with each one's
// name string. they are media files; the order is ours, since the game's
// own list is gone, and must not change once masterpieces exist.
const FRAMES = [
  [4813, 25174], [4816, 25175], [4814, 25177], [4815, 25176], [4851, 25308], [4888, 25306], [4892, 25307], [4941, 25305],
  [5688, 28858], [5733, 29009], [5780, 29304], [5948, 29967], [5949, 29968], [6075, 30265], [6077, 30266], [6170, 30375],
  [6921, 31954], [7139, 32409], [7164, 32479], [7186, 32594], [7232, 32663], [7254, 32753], [7277, 32754], [7324, 32755],
];
const LIST_FRAMES_OFFERED = 416;
const LIST_FRAMES_IN_ORDER = 424;

const REVIEW_SETTING = "masterpiece_review"; // "0" = approve as they are bought
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const TOKEN_MINUTES = 15;
const UNCLAIMED_MINUTES = 60;
const MAX_WAITING_PER_ACCOUNT = 30; // waiting to be looked at
const MAX_APPROVED_PER_ACCOUNT = 300; // on show, of one maker's
const MAX_SIDE = 4096; // pixels, either way
const NO_IMAGE = Buffer.alloc(0);
const folder = () => path.join(config.dataDir, "masterpieces");
const fileOf = id => path.join(folder(), `${id}.jpg`);
const GALLERY_SPOTS = 12; // PartyManager.setupMasterpiecesInRoom

const uploadsPerHour = limits.limiter(30, 3600000);
const now = () => Math.floor(Date.now() / 1000);
const db = () => accounts.database();

const known = new Map(); // id -> {id, creator, createdAt, status, frame, likes: [account ids]}
const tokens = new Map(); // upload token -> {account id, expires (ms)}

const load = () => {
  db().exec(SCHEMA);
  fs.mkdirSync(folder(), {recursive: true});
  // pictures still in the table move out into files, once.
  for (const row of db().prepare("SELECT id FROM masterpieces WHERE length(image) > 0").all()) {
    const {image: picture} = db().prepare("SELECT image FROM masterpieces WHERE id = ?").get(row.id);
    fs.writeFileSync(fileOf(row.id), Buffer.from(picture));
    db().prepare("UPDATE masterpieces SET image = ? WHERE id = ?").run(NO_IMAGE, row.id);
  }
  for (const row of db().prepare("SELECT id, creator_id, created_at, status, frame, likes FROM masterpieces").all()) {
    known.set(row.id, {id: row.id, creator: row.creator_id, createdAt: row.created_at, status: row.status, frame: row.frame, likes: JSON.parse(row.likes)});
  }
};

const needsReview = () => accounts.setting(REVIEW_SETTING) !== "0";
const setNeedsReview = on => accounts.setSetting(REVIEW_SETTING, on ? "1" : "0");

const forget = id => {
  known.delete(id);
  db().prepare("DELETE FROM masterpieces WHERE id = ?").run(id);
  fs.rmSync(fileOf(id), {force: true});
};

// paintings posted and never framed are thrown away after a while.
const sweep = () => {
  for (const [token, entry] of tokens) {
    if (entry.expires < Date.now()) {
      tokens.delete(token);
    }
  }
  for (const painting of [...known.values()]) {
    if (painting.status === UPLOADED && painting.createdAt < now() - UNCLAIMED_MINUTES * 60) {
      forget(painting.id);
    }
  }
};
setInterval(() => {
  try {
    sweep();
  }
  catch (err) {
    console.error(`[masterpieces] sweep failed: ${err.message}`);
  }
}, 600000).unref();

// A token for one upload by this account (step 1).
const issueToken = account => {
  for (const [token, entry] of tokens) {
    if (entry.account === account.id) {
      tokens.delete(token);
    }
  }
  const token = crypto.randomBytes(16).toString("hex");
  tokens.set(token, {account: account.id, expires: Date.now() + TOKEN_MINUTES * 60000});
  return token;
};

// is this a JPEG picture, whole and of a sane size? every viewer's game
// decodes it, so it is read through here first: the start mark, then one
// well-formed segment after another up to the picture data, among them a
// frame header saying how big it is, and the end mark last.
const looksLikeJpeg = image => {
  if (image.length < 100 || image[0] !== 0xFF || image[1] !== 0xD8 || image[image.length - 2] !== 0xFF || image[image.length - 1] !== 0xD9) {
    return false;
  }
  let at = 2;
  let sized = false;
  while (at + 4 <= image.length) {
    if (image[at] !== 0xFF) {
      return false;
    }
    const marker = image[at + 1];
    if (marker === 0xFF) {
      at++; // padding between segments
      continue;
    }
    const length = image.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > image.length) {
      return false;
    }
    // start of frame: baseline, extended or progressive. [precision, height, width, ...]
    if (marker >= 0xC0 && marker <= 0xC2) {
      const height = image.readUInt16BE(at + 5);
      const width = image.readUInt16BE(at + 7);
      if (length < 8 || height < 1 || width < 1 || height > MAX_SIDE || width > MAX_SIDE) {
        return false;
      }
      sized = true;
    }
    // start of scan: the picture data follows, to the end mark.
    if (marker === 0xDA) {
      return sized;
    }
    at += 2 + length;
  }
  return false;
};

// step 2. resolves to the new painting's id, or null when the token is not
// good, the picture is not a JPEG of a sane size, or the account has posted
// too many.
const upload = async (token, image) => {
  const entry = typeof token === "string" ? tokens.get(token) : null;
  tokens.delete(token);
  if (!entry || entry.expires < Date.now() || !Buffer.isBuffer(image) || image.length > MAX_IMAGE_BYTES || !looksLikeJpeg(image)
    || !uploadsPerHour.allow(entry.account)) {
    return null;
  }
  const safety = await imageModeration.scan(image);
  if (safety.blocked) {
    console.log(`[masterpieces] rejected unsafe upload from account ${entry.account}`);
    return null;
  }
  // one painting at a time is between the easel and the frame.
  for (const painting of [...known.values()]) {
    if (painting.creator === entry.account && painting.status === UPLOADED) {
      forget(painting.id);
    }
  }
  const painting = {id: crypto.randomUUID(), creator: entry.account, createdAt: now(), status: UPLOADED, frame: 0, likes: []};
  fs.writeFileSync(fileOf(painting.id), image);
  db().prepare("INSERT INTO masterpieces (id, creator_id, created_at, status, frame, likes, image) VALUES (?, ?, ?, ?, ?, '[]', ?)")
    .run(painting.id, painting.creator, painting.createdAt, painting.status, painting.frame, NO_IMAGE);
  known.set(painting.id, painting);
  return painting.id;
};

const setStatus = (painting, status) => {
  painting.status = status;
  db().prepare("UPDATE masterpieces SET status = ?, frame = ?, reviewed_at = ? WHERE id = ?")
    .run(status, painting.frame, status === APPROVED ? now() : null, painting.id);
};

// may this account make an item of that painting, in that frame? (Step 3,
// before anything is paid.)
const claimable = (account, id, frame) => {
  const painting = known.get(String(id));
  const mine = [...known.values()].filter(other => other.creator === account.id);
  const waiting = mine.filter(other => other.status === PENDING).length;
  const shown = mine.filter(other => other.status === APPROVED).length;
  return Boolean(painting) && painting.creator === account.id && painting.status === UPLOADED
    && Number.isInteger(frame) && frame >= 0 && frame < FRAMES.length && waiting < MAX_WAITING_PER_ACCOUNT && shown < MAX_APPROVED_PER_ACCOUNT;
};

// step 3, paid for: the painting is an item now. true when it is approved
// on the spot.
const claim = (id, frame) => {
  const painting = known.get(String(id));
  painting.frame = frame;
  setStatus(painting, needsReview() ? PENDING : APPROVED);
  return painting.status === APPROVED;
};

const get = id => known.get(String(id)) || null;

// the picture itself, or null. (Ids are the ones made here, so the file's
// name is never a visitor's to choose.)
const image = id => {
  if (!known.has(String(id))) {
    return null;
  }
  try {
    return fs.readFileSync(fileOf(String(id)));
  }
  catch (err) {
    return null;
  }
};

// may the picture be handed to whoever asks at this address (as limits
// count addresses)? once approved, to anyone: every game that draws it asks
// for it. before that only to its maker, known by the address their game is
// connected from: a picture nobody has looked at is not something this
// server puts on show for the world at a link. `addressOf` gives the
// address an account is playing from, or null.
const mayView = (id, address, addressOf) => {
  const painting = known.get(String(id));
  if (!painting) {
    return false;
  }
  const maker = accounts.byId(painting.creator);
  return painting.status === APPROVED || Boolean(maker && addressOf(maker) && addressOf(maker) === address);
};

const approve = id => {
  const painting = get(id);
  if (!painting || painting.status !== PENDING) {
    return false;
  }
  setStatus(painting, APPROVED);
  return true;
};

// is a den item fit to be shown, traded and recycled? anything that is not
// a painting is.
const itemApproved = item => !item.image || (known.has(item.image) && known.get(item.image).status === APPROVED);

const creatorOf = id => {
  const painting = get(id);
  return painting ? accounts.byId(painting.creator) : null;
};

// the three fields that follow a den item wherever the client is told of
// one: the painting's id, and its maker's database id and uuid.
const itemFields = item => {
  const maker = item.image ? creatorOf(item.image) : null;
  return [item.image || "", maker ? maker.id : -1, maker ? maker.uuid : ""];
};

// the like button of the preview window: one like an account.
const like = (id, account) => {
  const painting = get(id);
  if (!painting || painting.status !== APPROVED || painting.creator === account.id || painting.likes.includes(account.id)) {
    return false;
  }
  painting.likes.push(account.id);
  db().prepare("UPDATE masterpieces SET likes = ? WHERE id = ?").run(JSON.stringify(painting.likes), painting.id);
  return true;
};

// what hangs in the Masterpiece Gallery party and on Jammer Central's
// board: approved paintings, the most liked first and the newest among
// equals ({pool, pluspool} of MasterpieceDisplayItem.initFromPool objects).
const gallery = () => {
  const hung = [...known.values()].filter(painting => painting.status === APPROVED && creatorOf(painting.id))
    .sort((one, other) => other.likes.length - one.likes.length || other.createdAt - one.createdAt)
    .slice(0, GALLERY_SPOTS * 2)
    .map(painting => {
      const maker = creatorOf(painting.id);
      return {frameId: painting.frame, resourceId: painting.id, userName: maker.username, creatorDBId: maker.id, creatorId: maker.uuid};
    });
  return {pool: hung.slice(0, GALLERY_SPOTS), pluspool: hung.slice(GALLERY_SPOTS)};
};

const list = status => [...known.values()].filter(painting => painting.status === status)
  .sort((one, other) => other.createdAt - one.createdAt)
  .map(painting => {
    const maker = creatorOf(painting.id);
    return {id: painting.id, creator: maker ? maker.username : "(deleted account)", createdAt: painting.createdAt, frame: painting.frame, likes: painting.likes.length};
  });

// both lists for the panels, narrowed to makers whose names have
// `creator` in them (the one of exactly that name first): {waiting,
// approved}, newest first.
const listsFor = creator => {
  const wanted = String(creator || "").trim().toLowerCase().slice(0, 100);
  const narrowed = paintings => (wanted ? paintings.filter(painting => painting.creator.toLowerCase().includes(wanted))
    .sort((one, other) => Number(other.creator.toLowerCase() === wanted) - Number(one.creator.toLowerCase() === wanted)) : paintings);
  return {waiting: narrowed(list(PENDING)), approved: narrowed(list(APPROVED))};
};

const madeBy = account => [...known.values()].filter(painting => painting.creator === account.id).map(painting => painting.id);

// generic lists: (mediaId, name string id) pairs, or null when `listId` is
// not one of the frame lists (GenericListXtCommManager.handleMediaResponse).
const frameList = listId =>
  ([LIST_FRAMES_OFFERED, LIST_FRAMES_IN_ORDER].includes(Number(listId)) ? FRAMES.flat() : null);

module.exports = {
  load, issueToken, upload, claimable, claim, get, image, mayView, approve, forget, itemApproved, itemFields, creatorOf, like, gallery, list, listsFor, frameList,
  needsReview, setNeedsReview, madeBy,
  PENDING, APPROVED, DEN_ITEM, TOKEN_DEN_ITEM, DIAMOND_DEF, MAX_IMAGE_BYTES,
};

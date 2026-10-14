"use strict";

const zlib = require("zlib");
const amf3 = require("./amf3.js");
const cdn = require("./cdn.js");

// extra den music: sounds found in the game's files that nothing plays, or
// that only one room plays, made into music den items (see "Odd audio" in
// DISCOVERIES.md). they are not in any shop; the item finder and the admin
// panel's gifts give them by id.
//
// A music den item plays "audio/<its abbrName>.mp3" from the content server
// (DenItemHolder), and the CDN has no such files for these. each one's
// sound sits inside a media file or a room file as an MP3 (a DefineSound
// tag of a zlib-compressed SWF), so the file is cut out of there when a
// client first asks for it. nothing of it is kept in this repository.

const FIRST_ID = 6001; // the official den items end at 5925
const STRING_BASE = 9000100;
const VOLUME = "40"; // the def's `flag`, as the official tracks have it
const TEMPLATE = 614; // "Jam On": each new row starts as a copy of this track's

// {file, title, sound: the sound's exported name ("" for the only, unnamed
// one), and where it is: a media id, or a room file and the asset in it}
const TRACKS = [
  {file: "XtraNarration", title: "Narration", media: 1904, sound: "Narration"},
  {file: "XtraUnnamed", title: "Unnamed Sound", media: 46, sound: ""},
  {file: "XtraPhantomKings", title: "Phantom Kings", media: 2680, sound: "ajq_q7phntmKings.wav"},
  {file: "XtraYearBook", title: "TV Yearbook", media: 5828, sound: "ajq_tvYearBook"},
  {file: "XtraUSBKey", title: "Phantom USB Key", media: 5828, sound: "ajq_phntmUSBkey"},
  {file: "XtraNightingale", title: "Nightingale", media: 2365, sound: "ajq_nightingaleFull"},
  {file: "XtraVolcano", title: "Volcano", media: 2507, sound: "aj_musVolcanoFull"},
  ...[1, 2, 3, 4].map(layer => ({file: `XtraConcert${layer}`, title: `Concert Layer ${layer}`,
    room: "party/venue_concert", asset: "Concert\\Concert_Party_Front_Lights.swf", sound: `layer${layer}`})),
].map((track, index) => ({...track, id: FIRST_ID + index, stringId: STRING_BASE + index}));

const ids = TRACKS.map(track => track.id);

// rows for the den item pack, each a copy of an official track's row.
const defs = template => TRACKS.map(track => ({
  ...template, id: String(track.id), nameStrId: String(track.stringId), abbrName: track.file, cost: "0", membersOnly: "0",
  flag: VOLUME, availabilityStartTime: null, availabilityEndTime: null,
}));

const strings = () => Object.fromEntries(TRACKS.map(track => [track.stringId, track.title]));

const TAG_DEFINE_SOUND = 14;
const TAG_EXPORT = 56;
const TAG_SYMBOL_CLASS = 76;
const FORMAT_MP3 = 2;

const soundIn = (swf, name) => {
  if (swf.toString("latin1", 0, 3) !== "CWS") {
    return null;
  }
  const body = zlib.inflateSync(swf.subarray(8));
  const sounds = new Map(); // character id -> MP3 data
  const names = new Map(); // character id -> exported name
  let at = Math.ceil((5 + 4 * (body[0] >> 3)) / 8) + 4; // past the frame size, rate and count
  while (at + 2 <= body.length) {
    const head = body.readUInt16LE(at);
    at += 2;
    let length = head & 0x3F;
    if (length === 0x3F) {
      length = body.readUInt32LE(at);
      at += 4;
    }
    const tag = body.subarray(at, at + length);
    at += length;
    if (head >> 6 === TAG_DEFINE_SOUND && tag.length > 9 && tag[2] >> 4 === FORMAT_MP3) {
      sounds.set(tag.readUInt16LE(0), tag.subarray(9)); // id, flags, sample count, seek samples, then the frames
    }
    else if (head >> 6 === TAG_SYMBOL_CLASS || head >> 6 === TAG_EXPORT) {
      let pos = 2;
      for (let left = tag.readUInt16LE(0); left > 0 && pos + 2 < tag.length; left--) {
        const end = tag.indexOf(0, pos + 2);
        names.set(tag.readUInt16LE(pos), tag.toString("utf8", pos + 2, end));
        pos = end + 1;
      }
    }
  }
  for (const [id, data] of sounds) {
    if ((names.get(id) || "") === name) {
      return Buffer.from(data);
    }
  }
  return null;
};

const extract = async track => {
  if (track.media) {
    const swf = await cdn.get(cdn.hashedPath(`media/${track.media}`));
    return swf ? soundIn(swf, track.sound) : null;
  }
  const room = await cdn.get(cdn.hashedPath(`roomDefs/${track.room}.xroom`));
  const asset = room && amf3.decode(zlib.inflateSync(room)).assets
    .find(candidate => String(candidate.name).toLowerCase() === track.asset.toLowerCase());
  return asset && Buffer.isBuffer(asset.ba) ? soundIn(asset.ba, track.sound) : null;
};

const audioPaths = new Map(TRACKS.map(track => [cdn.hashedPath(`audio/${track.file}.mp3`), track]));
const made = new Map(); // track -> promise of its MP3

// what to answer a content request with when it is for one of these
// tracks' audio: {body, type}; undefined when it is not, and {body: null}
// when the source could not be read. (Music items have no picture: the
// den's music list shows their names.)
const asset = async relPath => {
  const track = audioPaths.get(relPath);
  if (!track) {
    return undefined;
  }
  if (!made.has(track)) {
    made.set(track, extract(track).catch(() => null));
  }
  const body = await made.get(track);
  if (!body) {
    made.delete(track); // offline, perhaps: try again next time
  }
  return {body, type: "audio/mpeg"};
};

module.exports = {TRACKS, ids, defs, strings, asset, TEMPLATE};

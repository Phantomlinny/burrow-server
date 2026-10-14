"use strict";

// minimal AMF3 reader, enough for the game's defPacks (objects, arrays,
// strings and numbers).

class Amf3Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
    this.strings = [];
    this.objects = [];
    this.traits = [];
  }

  u29() {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.buf[this.pos++];
      if (i === 3) {
        return (value << 8) | b;
      }
      value = (value << 7) | (b & 0x7f);
      if (!(b & 0x80)) {
        break;
      }
    }
    return value;
  }

  string() {
    const ref = this.u29();
    if (!(ref & 1)) {
      return this.strings[ref >> 1];
    }
    const len = ref >> 1;
    if (len === 0) {
      return "";
    }
    const str = this.buf.toString("utf8", this.pos, this.pos + len);
    this.pos += len;
    this.strings.push(str);
    return str;
  }

  value() {
    const type = this.buf[this.pos++];
    switch (type) {
      case 0x00: return undefined;
      case 0x01: return null;
      case 0x02: return false;
      case 0x03: return true;
      case 0x04: {
        const n = this.u29();
        return n & 0x10000000 ? n - 0x20000000 : n;
      }
      case 0x05: {
        const n = this.buf.readDoubleBE(this.pos);
        this.pos += 8;
        return n;
      }
      case 0x06: return this.string();
      case 0x08: {
        const ref = this.u29();
        if (!(ref & 1)) {
          return this.objects[ref >> 1];
        }
        const date = new Date(this.buf.readDoubleBE(this.pos));
        this.pos += 8;
        this.objects.push(date);
        return date;
      }
      case 0x09: return this.array();
      case 0x0a: return this.object();
      case 0x0c: {
        const ref = this.u29();
        if (!(ref & 1)) {
          return this.objects[ref >> 1];
        }
        const bytes = this.buf.subarray(this.pos, this.pos + (ref >> 1));
        this.pos += ref >> 1;
        this.objects.push(bytes);
        return bytes;
      }
      // Vector.<int>, Vector.<uint>, Vector.<Number>, Vector.<Object>
      case 0x0d:
      case 0x0e:
      case 0x0f:
      case 0x10: {
        const ref = this.u29();
        if (!(ref & 1)) {
          return this.objects[ref >> 1];
        }
        const out = [];
        this.objects.push(out);
        this.pos += 1; // fixed-length flag
        if (type === 0x10) {
          this.string(); // element class name
        }
        for (let i = 0; i < ref >> 1; i++) {
          if (type === 0x10) {
            out.push(this.value());
          }
          else if (type === 0x0f) {
            out.push(this.buf.readDoubleBE(this.pos));
            this.pos += 8;
          }
          else {
            out.push(type === 0x0d ? this.buf.readInt32BE(this.pos) : this.buf.readUInt32BE(this.pos));
            this.pos += 4;
          }
        }
        return out;
      }
      default:
        throw new Error(`Unsupported AMF3 type 0x${type.toString(16)} at ${this.pos - 1}`);
    }
  }

  array() {
    const ref = this.u29();
    if (!(ref & 1)) {
      return this.objects[ref >> 1];
    }
    const dense = ref >> 1;
    const assoc = {};
    let hasAssoc = false;
    const out = [];
    this.objects.push(out);
    for (let key = this.string(); key !== ""; key = this.string()) {
      assoc[key] = this.value();
      hasAssoc = true;
    }
    for (let i = 0; i < dense; i++) {
      out.push(this.value());
    }
    if (hasAssoc) {
      Object.assign(out, assoc);
    }
    return out;
  }

  object() {
    const ref = this.u29();
    if (!(ref & 1)) {
      return this.objects[ref >> 1];
    }
    let traits;
    if (!(ref & 2)) {
      traits = this.traits[ref >> 2];
    }
    else {
      if (ref & 4) {
        throw new Error("Externalizable AMF3 objects are not supported");
      }
      traits = {dynamic: Boolean(ref & 8), names: []};
      const count = ref >> 4;
      this.string(); // class name
      for (let i = 0; i < count; i++) {
        traits.names.push(this.string());
      }
      this.traits.push(traits);
    }
    const out = {};
    this.objects.push(out);
    for (const name of traits.names) {
      out[name] = this.value();
    }
    if (traits.dynamic) {
      for (let key = this.string(); key !== ""; key = this.string()) {
        out[key] = this.value();
      }
    }
    return out;
  }
}

// writer for what the reader above produces from a defPack: plain objects,
// arrays (with or without string keys), strings, numbers, booleans and null.
// nothing is written as a reference except repeated strings.
class Amf3Writer {
  constructor() {
    this.parts = [];
    this.strings = new Map();
  }

  u29(value) {
    if (value < 0x80) {
      this.parts.push(Buffer.from([value]));
    }
    else if (value < 0x4000) {
      this.parts.push(Buffer.from([(value >> 7) | 0x80, value & 0x7f]));
    }
    else if (value < 0x200000) {
      this.parts.push(Buffer.from([(value >> 14) | 0x80, ((value >> 7) & 0x7f) | 0x80, value & 0x7f]));
    }
    else {
      this.parts.push(Buffer.from([(value >> 22) | 0x80, ((value >> 15) & 0x7f) | 0x80, ((value >> 8) & 0x7f) | 0x80, value & 0xff]));
    }
  }

  string(text) {
    if (text === "") {
      this.u29(1);
    }
    else if (this.strings.has(text)) {
      this.u29(this.strings.get(text) << 1);
    }
    else {
      this.strings.set(text, this.strings.size);
      const bytes = Buffer.from(text, "utf8");
      this.u29((bytes.length << 1) | 1);
      this.parts.push(bytes);
    }
  }

  pairs(entries) {
    for (const [key, value] of entries) {
      this.string(key);
      this.value(value);
    }
    this.string("");
  }

  value(value) {
    if (value === undefined) {
      this.parts.push(Buffer.from([0x00]));
    }
    else if (value === null) {
      this.parts.push(Buffer.from([0x01]));
    }
    else if (typeof value === "boolean") {
      this.parts.push(Buffer.from([value ? 0x03 : 0x02]));
    }
    else if (typeof value === "number") {
      if (Number.isInteger(value) && value >= -0x10000000 && value < 0x10000000) {
        this.parts.push(Buffer.from([0x04]));
        this.u29(value & 0x1fffffff);
      }
      else {
        const bytes = Buffer.alloc(9);
        bytes[0] = 0x05;
        bytes.writeDoubleBE(value, 1);
        this.parts.push(bytes);
      }
    }
    else if (typeof value === "string") {
      this.parts.push(Buffer.from([0x06]));
      this.string(value);
    }
    else if (Array.isArray(value)) {
      this.parts.push(Buffer.from([0x09]));
      this.u29((value.length << 1) | 1);
      // string keys set on the array beside its numbered elements.
      this.pairs(Object.entries(value).filter(([key]) => !/^\d+$/.test(key)));
      for (const element of value) {
        this.value(element);
      }
    }
    else if (typeof value === "object" && !Buffer.isBuffer(value)) {
      // A dynamic object of no class, with its traits written in place.
      this.parts.push(Buffer.from([0x0a, 0x0b]));
      this.string("");
      this.pairs(Object.entries(value));
    }
    else {
      throw new Error("Cannot write this value as AMF3");
    }
  }
}

module.exports = {
  decode: buf => new Amf3Reader(buf).value(),
  encode: value => {
    const writer = new Amf3Writer();
    writer.value(value);
    return Buffer.concat(writer.parts);
  },
};

"use strict";

// a value from outside (a username, an address, what a client sent) as it
// may go into a line of the server's log: on one line, and with no control
// characters, so that it cannot pass for a line of the server's own (a name
// with a line break in it, "...\n[admin] signed in") or move the terminal's
// cursor about. (U+2028 and U+2029, which end a line too, are in the second.)
const OTHER_BREAKS_AND_CONTROLS = new RegExp("[\x00-\x1f\x7f-\x9f\u2028\u2029]", "g");

const logText = value => String(value)
  .replace(/[\r\n]+/g, " ")
  .replace(OTHER_BREAKS_AND_CONTROLS, "?");

module.exports = {logText};

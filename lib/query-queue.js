"use strict";

// One outstanding query at a time avoids overflowing the console while several
// browsers load the same mix. A missing answer cannot stop later queries.
class QueryQueue {
  constructor(send, { delay = 15, timeout = 350, attempts = 3 } = {}) {
    this.send = send;
    this.delay = delay;
    this.timeout = timeout;
    this.attempts = attempts;
    this.pending = new Map();
    this.active = null;
    this.timer = null;
  }
  request(address, priority = false) {
    if (this.pending.has(address)) {
      if (priority) this.pending.get(address).priority = true;
      return;
    }
    this.pending.set(address, { attempts: 0, priority });
    if (!this.timer && !this.active) this.pump();
  }
  pump() {
    this.timer = null;
    const first = [...this.pending.entries()].find(([, item]) => item.priority) || this.pending.entries().next().value;
    if (!first) return;
    const [address, item] = first;
    this.active = address;
    item.attempts++;
    this.timer = setTimeout(() => {
      this.active = null;
      if (item.attempts >= this.attempts) this.pending.delete(address);
      else { this.pending.delete(address); this.pending.set(address, item); }
      this.pump();
    }, this.timeout);
    this.send({ address: address + "/?", args: [] });
  }
  received(address) {
    this.pending.delete(address);
    if (this.active !== address) return;
    clearTimeout(this.timer);
    this.active = null;
    this.timer = setTimeout(() => this.pump(), this.delay);
  }
  clear() {
    clearTimeout(this.timer);
    this.timer = null;
    this.active = null;
    this.pending.clear();
  }
}
module.exports = { QueryQueue };

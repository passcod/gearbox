module.exports = {
  // HELLO(boxid, counter) -- Say hello to a new gearbox, passing our own {boxid} and {counter}
  hello (boxid, counter) {
    return { op: 'HELLO', boxid, counter }
  },

  // LOG(counter) -- Returns the log since {counter}
  log (counter = 0) {
    return { op: 'LOG', counter }
  },

  // SET(key, value) -- Replaces {key} with {value}, whether it exists or not.
  set (key, value) {
    return { op: 'SET', key, value }
  },

  // INCR(key, n = 1) -- Increments {key} by {n}, iff {key} is a number.
  incr (key, n = 1) {
    if (isNaN(+`${n}`)) n = 1
    return { op: 'INCR', key, n }
  },

  // DECR(key, n = 1) -- Decrements {key} by {n}, iff {key} is a number.
  decr (key, n = 1) {
    if (isNaN(+`${n}`)) n = 1
    return { op: 'DECR', key, n }
  },

  // DELETE(key) -- Deletes {key} if it exists.
  delete (key) {
    return { op: 'DELETE', key }
  },

  // SADD(key, items...) -- Adds {items} to {key}. If {key} is not a set, add its value to the set.
  sadd (key, ...items) {
    return { op: 'SADD', key, items }
  },

  // SREM(key, items...) -- Removes {items} from {key}. If {key} is not a set, ignore.
  srem (key, ...items) {
    return { op: 'SREM', key, items }
  },

  // SSET(key, items...) -- Replaces {key} with a set containing {items}.
  sset (key, ...items) {
    return { op: 'SSET', key, items }
  },
}

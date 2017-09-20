'use strict'

const ops = require('./ops')

const GEARBOX_REGEX = /^gear::box_(\w+)$/

class Boxes {
  constructor (gear, box) {
    this.boxes = new Set
    this.gear = gear
    this.ownbox = box
    this.ownbox.boxes = this
    this.timer = setInterval(() => {
      this.updateBoxes().catch((err) => {
        console.error(err)
      })
    }, 1000)
  }

  async updateBoxes () {
    const newBoxes = new Set
    const servers = await this.gear.status()
    console.log('Oplog', this.ownbox.counter, this.ownbox.oplog)
    console.log('State', this.ownbox.state)

    for (const fns of servers) {
      for (const [ name, { workers } ] of Object.entries(fns)) {
        if (workers < 1) continue
        if (name === this.ownbox.gearname) continue

        const [, id] = GEARBOX_REGEX.exec(name) || []
        if (!id) continue

        if (!this.boxes.has(id)) await this.sendHello(id)
        newBoxes.add(id)
      }
    }

    this.boxes = newBoxes
    console.log(this.boxes)
  }

  get [Symbol.iterator] () {
    return function* () {
      for (const id of this.boxes) {
        yield id
      }
    }
  }

  sendHello (boxid) {
    return this.asyncJob(boxid, ops.hello(this.ownbox.id, this.ownbox.counter))
  }

  sendHelloToAll () {
    return Promise.all(Array.from(this.boxes).map((id) => this.sendHello(id)))
  }

  syncJob (boxid, payload) {
    console.log('SYNC  JOB to', boxid, 'about', payload)
    return this.gear.submitJob(...makeJob(boxid, payload)).then((payload) => {
      console.log('GotPayload', payload)
      try { return JSON.parse(payload) }
      catch (e) { return payload }
    })
  }

  asyncJob (boxid, payload) {
    console.log('ASYNC JOB to', boxid, 'about', payload)
    return this.gear.submitJobBg(...makeJob(boxid, payload))
  }
}

function makeJob (tobox, payload) {
  return [
    `gear::box_${tobox}`,
    { priority: 'high', uniqueid: '' + Math.random() },
    Buffer.from(JSON.stringify(Object.assign({ tobox }, payload)))
  ]
}

const box = require('./box')
const gear = require('./gear')
module.exports = new Boxes(gear, box)

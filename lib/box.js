'use strict'

const ops = require('./ops')

function boxid () {
  const boxbuf = Buffer.alloc(12)
  boxbuf.writeDoubleLE(+new Date, 0)
  boxbuf.writeDoubleLE(Math.random(), 4)
  return boxbuf.toString('base64').replace(/[=/+]/g, '').substr(0, 12)
}

class Box {
  constructor (gear) {
    this.gear = gear
    this.id = boxid()
    this.gearname = `gear::box_${this.id}`

    this.leader = null
    this.oplog = []
    this.state = {}

    this.gear.registerWorker(this.gearname, this.worker.bind(this))
  }

  get counter () {
    return this.oplog.length
  }

  async worker (task) {
    const payload = JSON.parse(task.payload)
    console.log('Hit', payload)

    if (!payload.op) return JSON.stringify({ error: 'no op provided' })

    const method = `op${payload.op[0].toUpperCase()}${payload.op.slice(1).toLowerCase()}`
    console.log('Method', method)
    if (this[method]) {
      const data = await this[method](payload)
      return data || '{}'
    }

    return JSON.stringify({ error: 'no such op' })
  }

  async opHello ({ boxid, counter }) {
    console.log('Hello', counter, boxid)
    if (counter > this.counter) {
      this.leader = boxid
      const log = await this.boxes.syncJob(this.leader, ops.log(this.counter))
      console.log('GotLog', log)
      for (const l of log) this.oplog.push(l)
    }
  }

  opLog ({ counter }) {
    console.log('Log', counter)
    if (counter <= this.counter) {
      this.leader = null
      return JSON.stringify(this.oplog.slice(counter))
    }
  }

  opSet ({ key, value }) {
    if (this.leader) {
      return this.boxes.syncJob(this.leader, ops.set(key, value))
    } else {
      this.oplog.push(ops.set(key, value))
      return this.boxes.sendHelloToAll()
    }
  }
}

const gear = require('./gear')
module.exports = new Box(gear)

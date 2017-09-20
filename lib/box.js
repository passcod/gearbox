'use strict'

const ops = require('./ops')
const ssri = require('ssri')

function boxid () {
  const boxbuf = Buffer.alloc(12)
  boxbuf.writeDoubleLE(+new Date, 0)
  boxbuf.writeDoubleLE(Math.random(), 4)
  return boxbuf.toString('base64').replace(/[=/+]/g, '').substr(0, 12)
}

function integrity (data) {
  return ssri.fromData(JSON.stringify(data), {
    algorithms: ['sha512']
  }).toString('\n')
}

function check (data, integr) {
  return ssri.checkData(JSON.stringify(data), integr)
}

class Box {
  constructor (gear) {
    this.gear = gear
    this.id = boxid()
    this.gearname = `gear::box_${this.id}`

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
      const { ssri, log } = await this.boxes.syncJob(boxid, ops.log(this.counter))
      console.log('GotSSRI', ssri)

      if (check(this.oplog, ssri)) {
        console.log('GotLog', log)
        this.oplog.push(...log)
      } else {
        console.log('LogConflict!')
        const { log } = await this.boxes.syncJob(boxid, ops.log())
        this.oplog = log
      }
    }
  }

  opLog ({ counter }) {
    console.log('Log', counter)
    return JSON.stringify({
      ssri: integrity(this.oplog.slice(0, counter)),
      log: this.oplog.slice(counter)
    })
  }

  opSet ({ key, value }) {
    this.oplog.push(ops.set(key, value))
    return this.boxes.sendHelloToAll()
  }
}

const gear = require('./gear')
module.exports = new Box(gear)

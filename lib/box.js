'use strict'

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

		this.state = { counter: 0 }

    this.gear.registerWorker(this.gearname, this.worker.bind(this))
  }

  worker (task) {
		const payload = JSON.parse(task.payload)
    console.log('Hit', payload)

		if (payload.counter > this.state.counter) {
			this.state.counter = payload.counter
		}

		return 'ok'
  }

	getState () {
		return this.state
	}
}

const gear = require('./gear')
module.exports = new Box(gear)

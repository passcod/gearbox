'use strict'

const GEARBOX_REGEX = /^gear::box_(\w+)$/

class Boxes {
	constructor (gear, box) {
		this.boxes = new Set
		this.gear = gear
		this.ownbox = box
    this.ownbox.setUpdater(this.updateAll.bind(this))
		this.timer = setInterval(() => {
			this.updateBoxes().catch((err) => {
				console.error(err)
			})
		}, 1000)
	}

	async updateBoxes () {
		const newBoxes = new Set
		const servers = await this.gear.status()
		console.log('State', this.ownbox.state)

		for (const fns of servers) {
			for (const [ name, { workers } ] of Object.entries(fns)) {
				if (workers < 1) continue
				if (name === this.ownbox.gearname) continue

				const [, id] = GEARBOX_REGEX.exec(name) || []
				if (!id) continue

				if (!this.boxes.has(id)) await this.sendState(id)
				newBoxes.add(id)
			}
		}

		this.boxes = newBoxes
		console.log(this.boxes)
	}

  async updateAll () {
    for (const id of this.boxes) {
      await this.sendState(id)
    }
  }

	sendState (boxid) {
		return this.gear.submitJobBg(`gear::box_${boxid}`, {
			priority: 'high',
			uniqueid: Math.random()+''
		}, Buffer.from(JSON.stringify(this.ownbox.getState())))
	}
}

const box = require('./box')
const gear = require('./gear')
module.exports = new Boxes(gear, box)

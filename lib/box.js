'use strict'

const crypto = require('crypto')

function randstr (n = 12) {
  return crypto
    .randomBytes(n)
    .toString('base64')
    .replace(/[=/+]/g, '')
    .substr(0, n)
}

function sleep (n) {
  return new Promise((resolve) => setTimeout(resolve, n))
}

function jittery (min, max) {
  return Math.round(Math.random() * (max - min) + min)
}

class Box {
  constructor (gear) {
    this.gear = gear
    this.id = randstr()
    this.gear.registerWorker('gearbox::worker', this.worker.bind(this))
  }

  async worker (task) {
    const payload = JSON.parse(task.payload)
    console.log('Hit', payload)
    return JSON.stringify({ error: 'no such op' })
  }
}

const gear = require('./gear')
module.exports = new Box(gear)

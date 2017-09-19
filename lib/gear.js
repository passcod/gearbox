'use strict'

const abraxas = require('abraxas')
module.exports = abraxas.Client.connect({
  servers: ['127.0.0.1:4730'],
  // packetDump: true
})

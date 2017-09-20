const box = require('./box')
const Koa = require('koa')
const r = require('koa-route')
const jsonIn = require('koa-bodyparser')({ enableTypes: ['json'] })
const jsonOut = require('koa-json')()

const app = new Koa()
app.use(jsonIn)
app.use(jsonOut)

const server = app.listen(
  +process.env.PORT || 0,
  () => console.log(server.address())
)

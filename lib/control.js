const box = require('./box')
const Koa = require('koa')
const r = require('koa-route')
const json = require('koa-json')

const app = new Koa()
app.use(json())
app.use(r.get('/incr'), () => box.addState({ counter: 1 }))

const server = app.listen(0, () => console.log(server.address()))

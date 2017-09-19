const box = require('./box')
const Koa = require('koa')
const r = require('koa-route')
const jsonIn = require('koa-bodyparser')({ enableTypes: ['json'] })
const jsonOut = require('koa-json')()
const ops = require('./ops')

const app = new Koa()
app.use(jsonIn)
app.use(jsonOut)
app.use(r.get('/incr', () => box.opSet(ops.set('key', 'value'))))
app.use(r.post('/append/:key', (_, key) => box.appendTo(key, ctx.body)))

const server = app.listen(0, () => console.log(server.address()))

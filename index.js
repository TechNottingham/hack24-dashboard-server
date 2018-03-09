require('dotenv').config()

const WebSocket = require('ws')
const Twitter = require('twitter')
const pino = require('pino')()

const WebSocketServer = WebSocket.Server

function broadcastEvent (wss, event, data) {
  const packet = JSON.stringify({ event, data })
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(packet)
    }
  })
}

function sendEvent (ws, event, data) {
  const packet = JSON.stringify({ event, data })
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(packet)
  }
}

function createServer (port, host) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port, host })

    wss.on('connection', function connection (ws) {
      sendEvent(ws, 'hello', { hello: 'world' })
    })

    wss.on('listening', function () {
      resolve(wss)
    })
  })
}

function connectTwitterStream () {
  return new Promise((resolve, reject) => {
    const client = new Twitter({
      consumer_key: process.env.TWITTER_CONSUMER_KEY,
      consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
      access_token_key: process.env.TWITTER_ACCESS_TOKEN,
      access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
    })

    const stream = client.stream('statuses/filter', { track: 'javascript' })

    stream.on('response', function () {
      resolve(stream)
    })
  })
}

function setGracefullyClose (wss, logger) {
  process.on('SIGINT', function () {
    logger.info('Closing Websocket server...')
    wss.close(function () {
      process.exit(0)
    })
  })
}

async function init (logger) {
  pino.info('Creating Websocket server...')
  const wss = await createServer(process.env.PORT || 1235, process.env.HOST)

  pino.info('Connecting to Twitter...')
  const twitter = await connectTwitterStream()

  pino.info('Ready')
  return { wss, twitter }
}

function bind (logger, wss, twitter) {
  const broadcast = (event, data) => broadcastEvent(wss, event, data)

  twitter.on('data', function (event) {
    broadcast('tweet', { text: event.text })
  })

  twitter.on('error', function (err) {
    logger.error(err, 'twitter stream error')
  })
}

init(pino).catch((err) => {
  pino.error(err, 'Initialisation failed')
  process.exit(1)
}).then(({ wss, twitter }) => {
  setGracefullyClose(wss, pino)
  bind(pino, wss, twitter)
})

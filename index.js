require('dotenv').config()

const WebSocket = require('ws')
const Twitter = require('twitter')
const pino = require('pino')()

const WebSocketServer = WebSocket.Server

const wss = new WebSocketServer({
  port: process.env.PORT || 1235,
  host: process.env.HOST
})

const twitter = new Twitter({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token_key: process.env.TWITTER_ACCESS_TOKEN,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
})

function closeWebsocketServer () {
  pino.info('Closing Websocket server...')
  wss.close(function () {
    process.exit(0)
  })
}
process.on('SIGTERM', closeWebsocketServer)
process.on('SIGINT', closeWebsocketServer)

function startWebSocketServer (logger, port, host) {
  return new Promise((resolve, reject) => {
    wss.on('listening', function () {
      resolve()
    })
  })
}

function connectTwitterStream () {
  return new Promise((resolve, reject) => {
    const stream = twitter.stream('statuses/filter', { track: '#hack24' })
    stream.on('response', function () {
      resolve(stream)
    })
  })
}

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

async function init () {
  pino.info('Creating Websocket server...')
  await startWebSocketServer()

  pino.info('Connecting to Twitter...')
  const stream = await connectTwitterStream()

  pino.info('Ready')
  return stream
}

function backfillTweets (ws) {
  twitter.get('search/tweets', {
    q: '#hack24',
    result_type: 'recent',
    count: 5
  }, (err, tweets, response) => {
    if (err) {
      pino.error(err, 'Unable to fetch recent tweets')
      return
    }

    tweets.statuses.forEach((event) => {
      sendEvent(ws, 'tweet', {
        ts: event.timestamp_ms,
        text: event.text,
        user: {
          screen_name: event.user.screen_name,
          name: event.user.name,
          profile_image_url: event.user.profile_image_url
        }
      })
    })
  })
}

function backfillNewClients () {
  wss.on('connection', (ws) => {
    backfillTweets(ws)
  })
}

function bindTwitterStream (stream) {
  const broadcast = (event, data) => broadcastEvent(wss, event, data)

  stream.on('data', function (event) {
    broadcast('tweet', {
      ts: event.timestamp_ms,
      text: event.text,
      user: {
        screen_name: event.user.screen_name,
        name: event.user.name,
        profile_image_url: event.user.profile_image_url
      }
    })
  })

  stream.on('error', function (err) {
    pino.error(err, 'twitter stream error')
  })
}

init().catch((err) => {
  pino.error(err, 'Initialisation failed')
  process.exit(1)
}).then((stream) => {
  bindTwitterStream(stream)
  backfillNewClients()
})

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
})

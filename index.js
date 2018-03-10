require('dotenv').config()

const http = require('http')
const fs = require('fs')
const Primus = require('primus')
const Twitter = require('twitter')
const pino = require('pino')()
const moment = require('moment')
const uglifyjs = require('uglify-js')

const EventBuffer = require('./event-buffer')

const buffer = new EventBuffer()

function setTimeoutAsPromised (timeout) {
  return new Promise((resolve) => setTimeout(function () {
    resolve()
  }, timeout))
}

const primusLibraryFilename = `${__dirname}/primus.min.js`

const server = http.createServer(function (req, res) {
  if (req.url === '/js/primus.min.js') {
    res.setHeader('Content-Type', 'application/javascript')
    fs.createReadStream(primusLibraryFilename).pipe(res)
    return
  }

  res.setHeader('Content-Type', 'text/html')
  res.write("I'm here!")
  res.statusCode = 200
  res.end()
})

const primus = new Primus(server, { pathname: '/events' })
primus.on('connection', function (spark) {
  pino.info('New Primus connection received')
  buffer.replay((packet) => spark.write(packet))
})

buffer.on('event', (packet) => primus.write(packet))

function preparePrimusClientLibrary () {
  return new Promise((resolve, reject) => {
    const source = primus.library()
    const minified = uglifyjs.minify(source)

    fs.writeFile(primusLibraryFilename, minified.code, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

const twitter = new Twitter({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token_key: process.env.TWITTER_ACCESS_TOKEN,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
})

function startWebServer (port, host) {
  return new Promise((resolve, reject) => {
    server.listen(port, host, function () {
      resolve()
    })
  })
}

async function connectTwitterStream () {
  function connect () {
    return new Promise((resolve, reject) => {
      function connectionError (err) {
        reject(err)
      }

      const stream = twitter.stream('statuses/filter', { track: '#hack24' })
      stream.on('response', function (response) {
        stream.removeListener('error', connectionError)
        resolve(stream)
      })
      stream.once('error', connectionError)
    })
  }

  let stream

  while (true) {
    try {
      stream = await connect()
      break
    } catch (err) {
      pino.error({ message: err.message }, 'Connection to Twitter stream failed, retrying in 5 sec...')
      await setTimeoutAsPromised(5000)
    }
  }
  return stream
}

function convertTweetCreatedAtToTimestamp (createdAt) {
  return moment(createdAt, 'ddd MMM DD HH:mm:ss ZZ YYYY').valueOf()
}

async function init () {
  pino.info('Creating primus client library...')
  await preparePrimusClientLibrary()

  pino.info('Creating Websocket server...')
  await startWebServer(process.env.PORT || 1235, process.env.HOST)

  pino.info('Connecting to Twitter...')
  const stream = await connectTwitterStream()

  pino.info('Ready')
  return stream
}

function backfillTweets () {
  return new Promise((resolve, reject) => {
    twitter.get('search/tweets', {
      q: '#hack24',
      result_type: 'recent',
      count: 20
    }, (err, tweets, response) => {
      if (err) {
        pino.error(err, 'Unable to fetch recent tweets')
        return reject(err)
      }

      tweets.statuses.forEach((event) => {
        buffer.push('tweet', {
          ts: convertTweetCreatedAtToTimestamp(event.created_at),
          text: event.text,
          user: {
            screen_name: event.user.screen_name,
            name: event.user.name,
            profile_image_url: event.user.profile_image_url
          }
        })
      })

      resolve()
    })
  })
}

function bindTwitterStream (stream) {
  stream.on('data', function (event) {
    buffer.push('tweet', {
      ts: Number(event.timestamp_ms),
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

function closeWebServer (server) {
  return new Promise((resolve) => {
    pino.info('Closing Web server...')
    server.close(function () {
      resolve()
    })
  })
}

function closeTwitterStream (stream) {
  return new Promise((resolve) => {
    pino.info('Closing Twitter stream...')
    stream.once('end', function () {
      resolve()
    })
  })
}

init().catch((err) => {
  pino.error(err, 'Initialisation failed')
  process.exit(1)
}).then(async (stream) => {
  async function close () {
    await closeWebServer(server)
    await closeTwitterStream(stream)
    process.exit(0)
  }

  process.on('SIGTERM', close)
  process.on('SIGINT', close)

  await backfillTweets()
  bindTwitterStream(stream)
})

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
})

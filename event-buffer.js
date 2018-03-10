const { EventEmitter } = require('events')

class EventBuffer extends EventEmitter {
  constructor () {
    super()
    this.bufferLimit = 20
    this.buffer = []
  }

  push (event, data) {
    const packet = { event, data }
    this.buffer.unshift(packet)

    while (this.buffer.length > this.bufferLimit) {
      this.buffer.pop()
    }

    this.emit('event', packet)
  }

  replay (cb) {
    for (let packet of this.buffer) {
      cb(packet)
    }
  }
}

module.exports = EventBuffer

module.exports = function(RED) {
  const mediasoup = require("mediasoup");
  const workers = {};
  const routers = {};
  const transports = {};
  const producers = {};
  const consumers = {};

  const mediaCodecs =
  [
    {
      kind        : "audio",
      mimeType    : "audio/opus",
      clockRate   : 48000,
      channels    : 2
    }
  ];

//announcedIp: '127.0.0.1',
  const defaultTransportOptions = { // listenIps: [],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true
  }

  const createWorker = (node,rtcMinPort,rtcMaxPort,logLevel) => {
    const worker = mediasoup.createWorker({
      rtcMinPort: rtcMinPort,
      rtcMaxPort: rtcMaxPort,
      logLevel: logLevel
    })
    .then((worker) => {
      worker.on('died', (error) => {
        // This implies something serious happened, so kill the application
        node.error('mediasoup worker has died');
        setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
      });
      return worker;
    });
    return worker;
  };

  const createRouter = (worker,routerOptions) => worker.createRouter(routerOptions);

  const createTransport = (router,transportOptions,type) => {
    const transport = (type == 'plain') ? router.createPlainTransport(transportOptions) : router.createWebRtcTransport(transportOptions)
    .then((transport) => {
      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') {
          transport.close();
        }
      });
      transport.on('close', () => {
        //console.log('transport closed');
      });
      return transport;
    })
    return transport;
  }


  class Router {
    constructor (worker) {
      this.worker = worker;

    }
  }

const transportConnect = (transport,dtlsParameters) => {
  return transport.connect(dtlsParameters);
}

  class Worker {
    constructor(rtcMinPort,rtcMaxPort,logLevel) {
      //this.name = name; // Name the worker?
      this.rtcMinPort = rtcMinPort;
      this.rtcMaxPort = rtcMaxPort;
      this.logLevel = logLevel;
      this.routers = [];
      this.worker = createWorker(rtcMinPort,rtcMaxPort,logLevel);
    }
    //get name() {
    //  return this.name;
    //}
  }


  function mediasoupWorker(n) {
    // Will create or close an existing worker if msg.payload == 'close'
    RED.nodes.createNode(this, n);
    let node = this;
    this.name = n.name;
    this.rtcMinPort = n.rtcMinPort || 10000;
    this.rtcMaxPort = n.rtcMaxPort || 20000;
    this.logLevel = n.logLevel || 'error';

    node.on("input", (msg) => {
      let rtcMinPort = msg.rtcMinPort || this.rtcMinPort;
      let rtcMaxPort = msg.rtcMaxPort || this.rtcMaxPort;
      let logLevel = msg.logLevel || this.logLevel;

      if('worker' in msg && 'id' in msg.worker && msg.worker.id in workers) { // Worker ID sent
        // Get existing worker by id
        if('payload' in msg && msg.payload == 'close') {
          // Close worker
          workers[msg.worker.id].close();
          delete workers[msg.worker.id];
          node.send(msg);
        }
      } else {
        // Worker not sent, let's create one for them and use the pid
        createWorker(node,rtcMinPort,rtcMaxPort,logLevel)
        .then((worker) => {
          workers[worker.pid] = worker;
          msg.worker = {
            id: worker.pid
          }
          node.send(msg);
        });
      }
    });
    node.on('close', () => {
      for (const worker in workers) {
        console.log("Closing worker: " + worker);
        workers[worker].close();
        delete workers[worker];
      }
    })
  }

  function mediasoupRouter(n) {
    // Will create or close an existing router if msg.payload == 'close'
    RED.nodes.createNode(this, n);
    var node = this;
    this.name = n.name;

    node.on("input", function(msg) {
      if('payload' in msg && msg.payload == 'close') {
        if('router' in msg && 'id' in msg.router && msg.router.id in routers) {
          // Close router
          routers[msg.router.id].close();
          delete routers[msg.router.id];
          node.log(Object.keys(routers).length);
          node.send(msg);
        }
      } else {
        if('worker' in msg && 'id' in msg.worker && msg.worker.id in workers) {
          // Get worker
          const worker = workers[msg.worker.id];
          const codecs = ('mediaCodecs' in msg) ? msg.mediaCodecs : mediaCodecs;
          node.log(JSON.stringify({ mediaCodecs: codecs }));
          const router = createRouter(worker,{ mediaCodecs: codecs })
          .then((router) => {
            routers[router.id] = router;
            msg.router = {
              id: router.id
            }
            node.send(msg);
          });
        }
      }
    });

    node.on("close", () => {
      for (router in routers) {
        console.log("Closing router: " + router);
        routers[router].close();
        delete routers[router];
      }
    });
  }

  function mediasoupCapabilities(n) {
    // Used to get a worker or router's capabilities
    RED.nodes.createNode(this, n);
    var node = this;
    this.name = n.name;

    node.on("input", function(msg) {
      if('router' in msg && 'id' in msg.router && msg.router.id in routers) {
        // Get worker
        const router = routers[msg.router.id];
        msg.router.capabilities = {
          rtpCapabilities: router.rtpCapabilities
        }
      } else {
        msg.capabilities = {
          rtpCapabilities: mediasoup.getSupportedRtpCapabilities()
        }
      }
      node.send(msg);
    });
  }


  function mediasoupTransport(n) {
    // Used to get a worker or router's capabilities
    RED.nodes.createNode(this, n);
    var node = this;
    this.name = n.name;
    this.listenIps = n.listenIps;

    node.on("input", function(msg) {
      if('router' in msg && 'id' in msg.router && msg.router.id in routers) {
        const router = routers[msg.router.id];
        let transportType;
        let transportOptions = defaultTransportOptions;
        if('transportOptions' in msg) {
          transportOptions = {
            ...defaultTransportOptions,
            ...msg.transportOptions
          }
          if(!('listenIps' in transportOptions))
            transportOptions.listenIps = this.listenIps;
        } else {
          transportOptions.listenIps = this.listenIps;
        }
        if('transportType' in msg && msg.transportType == 'plain'){
          transportType = 'plain';
          transportOptions.listenIp = transportOptions.listenIps[0]; // Listen on the first IP address
          delete transportOptions.listenIps;
        }
        transport = createTransport(router,transportOptions,transportType)
        .then((transport) => {
          transports[transport.id] = transport;
          transports[transport.id].router = msg.router;
          if('transportType' in msg && msg.transportType == 'plain'){
            msg.transport = {
              id: transport.id,
              tuple: transport.tuple,
              rtcpTuple: transport.rtcpTuple
            }
          } else  {
            msg.transport = {
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters
            }
          }
          node.send(msg);
        });
      }
    });
  }

  function mediasoupConnect(n) {
    RED.nodes.createNode(this, n);
    var node = this;
    this.name = n.name;

    node.on("input", function(msg) {
      if('transport' in msg && 'id' in msg.transport && msg.transport.id in transports && 'connect' in msg) {
        const transport = transports[msg.transport.id];
        transportConnect(transport,msg.connect)
        .then((t) => {
          // Should be connected
          node.send(msg);
        });
      }
    });
  }

  function mediasoupProduce(n) {
    RED.nodes.createNode(this, n);
    var node = this;
    this.name = n.name;

    node.on("input", function(msg) {
      if('transport' in msg && 'id' in msg.transport && msg.transport.id in transports && 'producerOptions' in msg && 'kind' in msg.producerOptions && 'rtpParameters' in msg.producerOptions) {
        const transport = transports[msg.transport.id];
        node.log(JSON.stringify(msg.producerOptions));
        transport.produce(msg.producerOptions)
        .then((producer) => {
          producers[producer.id] = producer;
          producer.on('transportclose', () => {
            producer.close();
          })
          msg.producer = {
            id: producer.id
          }
          node.send(msg);
        })
        .catch((err) => {
          node.log(err);
        })
      }
    });
  }

  function mediasoupConsume(n) {
    RED.nodes.createNode(this, n);
    var node = this;
    this.name = n.name;

    node.on("input", function(msg) {
      if('consumer' in msg && 'id' in msg.consumer && msg.consumer.id in consumers && 'paused' in msg) {
        // Perhaps they want a state change?
        const consumer = consumers[msg.consumer.id];
        if(msg.paused)
          consumer.pause();
        else
          consumer.resume();
          node.send(msg);
      }
      else if('producer' in msg && 'rtpCapabilities' in msg && 'transport' in msg && 'id' in msg.transport && msg.transport.id in transports) {
        const transport = transports[msg.transport.id];
        const router = routers[transport.router.id];
        const consumeOptions = {
          producerId: msg.producer.id,
          rtpCapabilities: msg.rtpCapabilities
        }
        if(router.canConsume(consumeOptions)) {
          if('paused' in msg) consumeOptions.paused = (msg.paused) ? true : false;
          transport.consume(consumeOptions)
          .then((consumer) => {
            consumer.on('transportclose', () => {
              //Send something??
            })
            consumer.on('producerclose', () => {
              //Send something??
            })
            consumers[consumer.id] = consumer;
            msg.consumer = {
              id: consumer.id,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters
            }
            node.send(msg);
          })
        }
      }
    });
  }

  RED.nodes.registerType("mediasoup-worker",mediasoupWorker);
  RED.nodes.registerType("mediasoup-router",mediasoupRouter);
  RED.nodes.registerType("mediasoup-capabilities",mediasoupCapabilities);
  RED.nodes.registerType("mediasoup-transport",mediasoupTransport);
  RED.nodes.registerType("mediasoup-connect",mediasoupConnect);
  RED.nodes.registerType("mediasoup-produce",mediasoupProduce);
  RED.nodes.registerType("mediasoup-consume",mediasoupConsume);
};

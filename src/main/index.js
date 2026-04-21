/* eslint-disable no-case-declarations */
import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import crypto from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import fs from 'fs'
import { connection } from './js/proxy/proxyhandler'
import { checkProxy } from './js/proxy/proxycheck'
import { scrapeProxy } from './js/proxy/proxyscrape'
import {
  salt,
  delay,
  genName,
  botMode,
  sendEvent,
  proxyEvent,
  notify,
  cleanText
} from './js/misc/utils'
import { easyMcAuth } from './js/misc/customAuth'
import EventEmitter from 'node:events'
const Store = require('electron-store')
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
import { antiafk } from './js/misc/antiafk'
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

async function sendWebhook(content) {
  const config = storeinfo()
  if (!config.boolean.enableWebhook || !config.value.webhookLink) return
  try {
    await fetch(config.value.webhookLink, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: null,
        embeds: [{
          title: 'TrafficerMC Notification',
          description: content,
          color: 5814783,
          timestamp: new Date().toISOString()
        }]
      })
    })
  } catch (err) {
    console.error('Webhook error:', err)
  }
}

const botApi = new EventEmitter()
botApi.setMaxListeners(0)
const store = new Store()

let stopBot = false
let stopScript = false
let stopProxyTest = false
let currentProxy = 0
let proxyUsed = 0

let configCache = store.get('config') || {}
function storeinfo() {
  return configCache
}

let clientVersion = 3.1

let playerList = []

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 500,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    resizable: is.dev,
    maximizable: is.dev,
    webPreferences: {
      devTools: is.dev,
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  ipcMain.on('loaded', () => {
    store.set('version', {
      current: clientVersion
    })
    mainWindow.webContents.send('setConfig', store.get('config'), store.get('version'))
    if (!storeinfo()) {
      mainWindow.webContents.send('initConfig')
    }
    if (store.get('config.namefile')) {
      mainWindow.webContents.send('fileSelected', 'nameFileLabel', store.get('config.namefile'))
    }
    mainWindow.show()
  })

  ipcMain.on('playerList', (event, list) => {
    playerList = list
  })

  ipcMain.on('open', (event, id, name) => {
    dialog
      .showOpenDialog(mainWindow, {
        title: name,
        filters: [{ name: 'Text File', extensions: ['txt'] }],
        properties: ['openFile', 'multiSelections']
      })
      .then((result) => {
        if (!result.canceled) {
          store.set('config.namefile', result.filePaths[0])
          mainWindow.webContents.send('fileSelected', id, result.filePaths[0])
        }
      })
      .catch((error) => {
        console.log(error)
        return
      })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/index.html`)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.rattleshyper.trafficermc')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
    optimizer.registerFramelessWindowIpc(window)
  })

  createMainWindow()
})

ipcMain.on('setConfig', (event, type, id, value) => {
  if (!configCache[type]) configCache[type] = {}
  configCache[type][id] = value
  store.set(`config.${type}.${id}`, value)
})

ipcMain.on('deleteConfig', () => {
  store.delete('config')
})



ipcMain.on('btnClick', (event, btn) => {
  switch (btn) {
    case 'btnStart':
      connectBot()
      break
    case 'btnStop':
      stopBot = true
      notify('Info', 'Stopped sending bots.', 'success')
      break
    case 'btnChat':
      exeAll('chat ' + storeinfo().value.chatMsg)
      break
    case 'btnDisconnect':
      exeAll('disconnect')
      break
    case 'btnSetHotbar':
      exeAll('sethotbar ' + storeinfo().value.hotbarSlot)
      break
    case 'btnUseheld':
      exeAll('useheld')
      break
    case 'btnWinClickRight':
      exeAll('winclick ' + storeinfo().value.invSlot + ' 1')
      break
    case 'btnWinClickLeft':
      exeAll('winclick ' + storeinfo().value.invSlot + ' 0')
      break
    case 'btnDropSlot':
      exeAll('drop ' + storeinfo().value.invSlot)
      break
    case 'btnDropAll':
      exeAll('dropall')
      break
    case 'btnCloseWindow':
      exeAll('closewindow')
      break
    case 'btnStartMove':
      exeAll('resetmove')
      exeAll('startmove ' + (storeinfo().value.moveType || 'forward'))
      break
    case 'btnStopMove':
      exeAll('stopmove ' + (storeinfo().value.moveType || 'forward'))
      break
    case 'btnResetMove':
      exeAll('resetmove')
      break
    case 'btnLook':
      exeAll('look ' + storeinfo().value.lookDirection)
      break
    case 'btnAfkOn':
      exeAll('afkon')
      break
    case 'btnAfkOff':
      exeAll('afkoff')
      break
    case 'runScript':
      playerList.forEach((username) => {
        startScript(username)
      })
      break
    case 'stopScript':
      stopScript = true
      break
    case 'proxyTestStart':
      testProxy(storeinfo().value.proxyList)
      break
    case 'proxyTestStop':
      stopProxyTest = true
      proxyEvent('', 'stop', '', '')
      break
    case 'proxyScrape':
      if (storeinfo().value.proxyType === 'none')
        return notify('Error', 'Select proxy type', 'error')
      notify('Info', 'Scraping proxies...', 'success')
      setProxy()
      break
    case 'webhookTest':
      sendWebhook('This is a test notification from TrafficerMC!')
      notify('Webhook', 'Test sent!', 'success')
      break
    case 'btnPathGoto':
      const px = storeinfo().value.pathX
      const py = storeinfo().value.pathY
      const pz = storeinfo().value.pathZ
      if (px === undefined || py === undefined || pz === undefined) return notify('Error', 'Invalid coordinates', 'error')
      exeAll(`goto ${px} ${py} ${pz}`)
      break
    case 'btnPathStop':
      exeAll('pathstop')
      break
    case 'btnInteractRight':
      const coordsR = (storeinfo().value.interactCoords || '').split(' ')
      if (coordsR.length !== 3) return notify('Error', 'Invalid coordinates (X Y Z)', 'error')
      exeAll(`interact ${coordsR[0]} ${coordsR[1]} ${coordsR[2]} right`)
      break
    case 'btnInteractLeft':
      const coordsL = (storeinfo().value.interactCoords || '').split(' ')
      if (coordsL.length !== 3) return notify('Error', 'Invalid coordinates (X Y Z)', 'error')
      exeAll(`interact ${coordsL[0]} ${coordsL[1]} ${coordsL[2]} left`)
      break
    default:
      break
  }
})

function setProxy() {
  scrapeProxy(storeinfo().value.proxyType)
    .then((result) => {
      proxyEvent('', 'scraped', result, '')
    })
    .catch((err) => {
      console.log(err)
      notify('Error', 'Failed to scrape proxies', 'error')
    })
}

async function testProxy(list) {
  stopProxyTest = false
  const server = storeinfo().value.server
  const [serverHost, serverPort] = server.split(':')
  if (!serverHost) return notify('Error', 'Invalid server address', 'error')
  if (!list) return notify('Error', 'Please enter proxy list', 'error')
  notify('Info', 'Testing proxies...', 'success')
  proxyEvent('', 'start', '', '')
  const lines = list.split(/\r?\n/).filter((l) => l.trim().length > 0)
  let testedCount = 0
  const maxConcurrency = 10
  let currentIndex = 0

  async function checkNext() {
    if (currentIndex >= lines.length || stopProxyTest) return
    const i = currentIndex++
    const count = `${i + 1}/${lines.length}`
    const [host, port, username, password] = lines[i].split(':')

    try {
      const result = await checkProxy(
        configCache.value.proxyType,
        host,
        port,
        username,
        password,
        serverHost,
        serverPort || 25565,
        configCache.value.proxyCheckTimeout || 5000
      )
      proxyEvent(result.proxy, 'success', '', count)
    } catch (error) {
      proxyEvent(error.proxy, 'fail', error.reason, count)
    } finally {
      testedCount++
      if (testedCount === lines.length || (stopProxyTest && testedCount === currentIndex)) {
        proxyEvent('', 'stop', '', '')
      }
      await delay(configCache.value.proxyCheckDelay || 50)
      if (!stopProxyTest) checkNext()
    }
  }

  for (let j = 0; j < Math.min(maxConcurrency, lines.length); j++) {
    checkNext()
  }
}

async function startScript(username) {
  stopScript = false
  if (!storeinfo().value.scriptText) return
  const scriptLines = storeinfo().value.scriptText.split(/\r?\n/)
  for (let i = 0; i < scriptLines.length; i++) {
    if (stopScript) break
    const args = scriptLines[i].split(' ')
    const command = args.shift().toLowerCase()
    switch (command) {
      case 'delay':
        await delay(parseInt(args[0]))
        break
      default:
        botApi.emit('botEvent', username, command, args.slice(0))
    }
  }
}

async function exeAll(command) {
  if (!command) return
  const list = playerList
  const cmd = command.split(' ')
  if (list.length == 0) return notify('Error', 'No bots selected', 'error')
  for (let i = 0; i < list.length; i++) {
    botApi.emit('botEvent', list[i], cmd[0], cmd.slice(1))
    if (storeinfo().boolean.isLinear) {
      await delay(storeinfo().value.linearDelay || 100)
    }
  }
  sendEvent('Executed', 'chat', 'Script: ' + command)
}

async function startFile() {
  BrowserWindow.getAllWindows()[0].webContents.send('showBottab')
  const filePath = storeinfo().namefile
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)
  const count = storeinfo().value.botMax || lines.length

  for (let i = 0; i < count; i++) {
    if (stopBot) break
    newBot(getBotInfo(lines[i]))
    await delay(storeinfo().value.joinDelay || 1000)
  }
}

async function connectBot() {
  stopBot = false
  currentProxy = 0
  proxyUsed = 0
  const count = storeinfo().value.botMax || 1

  if (storeinfo().value.nameType === 'file' && storeinfo().namefile) {
    BrowserWindow.getAllWindows()[0].webContents.send('showBottab')
  } else if (storeinfo().value.nameType !== 'file' && storeinfo().value.nameType !== 'default') {
    BrowserWindow.getAllWindows()[0].webContents.send('showBottab')
  }

  for (let i = 0; i < count; i++) {
    if (stopBot) break

    let botInfo

    switch (storeinfo().value.nameType) {
      case 'random':
        botInfo = getBotInfo(salt(10))
        break
      case 'legit':
        botInfo = getBotInfo(genName())
        break
      case 'file':
        if (!storeinfo().namefile) {
          notify('Error', 'Please select name file', 'error')
        } else {
          startFile()
        }
        return
      default:
        if (!storeinfo().value.username) return notify('Error', 'Please insert username', 'error')
        const username =
          count == 1 ? storeinfo().value.username : storeinfo().value.username + '_' + i
        botInfo = getBotInfo(username)
        if (i == 0) BrowserWindow.getAllWindows()[0].webContents.send('showBottab')
    }

    newBot(botInfo)
    await delay(storeinfo().value.joinDelay || 1000)
  }
}

function getBotInfo(botName) {
  const server = storeinfo().value.server || 'localhost:25565'
  const [serverHost, serverPort] = server.split(':')
  const parsedPort = parseInt(serverPort) || 25565

  const options = {
    host: serverHost,
    port: parsedPort,
    username: botName,
    version: storeinfo().value.version,
    auth: storeinfo().value.authType,
    hideErrors: true,
    joinMessage: storeinfo().value.joinMessage,
    ...botMode(storeinfo().value.botMode),
    ...getProxy(storeinfo().value.proxyType)
  }

  if (options.auth === 'easymc') {
    options.auth = easyMcAuth
    options.sessionServer = 'https://sessionserver.easymc.io'
  }

  return options
}

function getProxy(proxyType) {
  if (proxyType === 'none' || !storeinfo().value.proxyList) return

  const proxyList = storeinfo().value.proxyList.split(/\r?\n/)
  const randomIndex = crypto.randomInt(0, proxyList.length)

  const proxyPerBot = storeinfo().value.proxyPerBot

  if (proxyUsed >= proxyPerBot) {
    proxyUsed = 0
    currentProxy++
    if (currentProxy >= proxyList.length) {
      currentProxy = 0
    }
  }

  proxyUsed++

  const index = storeinfo().boolean.randomizeOrder ? randomIndex : currentProxy
  const [host, port, username, password] = proxyList[index].split(':')
  return {
    protocol: proxyType,
    proxyHost: host,
    proxyPort: port,
    proxyUsername: username,
    proxyPassword: password
  }
}

function newBot(options) {
  let bot

  if (options.auth === 'easymc') {
    if (options.easyMcToken?.length !== 20) {
      return sendEvent(options.username, 'easymcAuth')
    }
    options.auth = easyMcAuth
    options.sessionServer ||= 'https://sessionserver.easymc.io'
  }

  const connectProxy = async (client) => {
    try {
      const socket = await connection(
        storeinfo().value.proxyType,
        options.proxyHost,
        options.proxyPort,
        options.proxyUsername,
        options.proxyPassword,
        options.host,
        options.port
      )
      client.setSocket(socket)
      client.emit('connect')
    } catch (error) {
      if (storeinfo().boolean.proxyLogChat) {
        sendEvent(
          client.username,
          'chat',
          options.proxyHost + ':' + options.proxyPort + ' ' + error
        )
      }
      return
    }
  }

  if (storeinfo().value.proxyType !== 'none') {
    options.connect = connectProxy
  }

  bot = mineflayer.createBot({
    ...options,
    plugins: {
      anvil: false,
      book: false,
      boss_bar: false,
      breath: false,
      chest: false,
      command_block: false,
      craft: false,
      creative: false,
      enchantment_table: false,
      experience: false,
      explosion: false,
      fishing: false,
      furnace: false,
      generic_place: false,
      painting: false,
      particle: false,
      place_block: false,
      place_entity: false,
      rain: false,
      ray_trace: false,
      scoreboard: false,
      sound: false,
      spawn_point: false,
      tablist: false,
      team: false,
      time: false,
      title: false,
      villager: false,
      physics: true
    },
    onMsaCode: (data) => {
      sendEvent(options.username, 'authmsg', data.user_code)
      if (storeinfo().boolean.authLogWebhook) {
        sendWebhook(`Bot **${options.username}** needs Microsoft Auth: **${data.user_code}**`)
      }
    }
  })
  bot.loadPlugin(pathfinder)

  let hitTimer = 0

  bot.once('login', () => {
    const username = bot.username || options.username
    sendEvent(username, 'login')
    if (storeinfo().boolean.joinLogWebhook) {
      sendWebhook(`Bot **${username}** has logged in to **${options.host}**`)
    }
    if (storeinfo().boolean.runOnConnect) {
      startScript(username)
    }
    if (storeinfo().value.joinMessage) {
      bot.chat(storeinfo().value.joinMessage)
    }
  })
  bot.once('spawn', () => {
    bot.loadPlugin(antiafk)
  })
  bot.on('spawn', () => {
    if (storeinfo().boolean.runOnSpawn) {
      startScript(bot.username)
    }
  })
  bot.on('messagestr', (msg) => {
    sendEvent(bot.username, 'chat', msg)
  })
  bot.on('windowOpen', (window) => {
    sendEvent(
      bot.username,
      'chat',
      `Window Opened ' ${window.title ? ':' + window.title : ''}`
    )
  })
  bot.on('windowClose', (window) => {
    sendEvent(
      bot.username,
      'chat',
      `Window Closed ' ${window.title ? ':' + window.title : ''}`
    )
  })
  bot.once('kicked', (reason) => {
    try {
      const username = bot.username || options.username
      const parsed = typeof reason === 'string' ? JSON.parse(reason) : reason
      const text = cleanText(parsed)
      sendEvent(username, 'kicked', text)
      if (storeinfo().boolean.kickLogWebhook) {
        sendWebhook(`Bot **${username}** was kicked: ${text}`)
      }
    } catch (e) {
      const username = bot.username || options.username
      sendEvent(username, 'kicked', reason)
      if (storeinfo().boolean.kickLogWebhook) {
        sendWebhook(`Bot **${username}** was kicked (raw): ${reason}`)
      }
    }
  })

  let physicsTickCounter = 0
  let movements = null

  bot.on('physicTick', () => {
    if (!bot.entity) return
    physicsTickCounter++
    const config = storeinfo()
    if (physicsTickCounter % 20 === 0) {
      // reserved for future use
    }
    if (config?.boolean?.nukerToggle && physicsTickCounter % (config.value.nukerBlocksPerTick || 1) === 0) {
      nuker()
    }

    if (physicsTickCounter % 4 !== 0) return
    if (config?.boolean?.killauraToggle && playerList.includes(bot.username)) {
      killaura()
    }
  })

  function nuker() {
    if (!bot.entity || bot.targetDigBlock) return
    const config = storeinfo()
    const rUp = parseInt(config.value.nukerRangeUp || 0)
    const rDown = parseInt(config.value.nukerRangeDown || 0)
    const rLeft = parseInt(config.value.nukerRangeLeft || 0)
    const rRight = parseInt(config.value.nukerRangeRight || 0)
    const rForward = parseInt(config.value.nukerRangeForward || 0)
    const rBack = parseInt(config.value.nukerRangeBack || 0)

    const blocks = (config.value.nukerBlocks || '').split(',').map(b => b.trim().toLowerCase())
    const mode = config.value.nukerTargetMode || 'blacklist'

    const pos = bot.entity.position.floored()
    for (let x = -rLeft; x <= rRight; x++) {
      for (let y = -rDown; y <= rUp; y++) {
        for (let z = -rBack; z <= rForward; z++) {
          const targetPos = pos.offset(x, y, z)
          const block = bot.blockAt(targetPos)
          if (!block || block.name === 'air' || block.name === 'water' || block.name === 'lava') continue

          const isMatch = (blocks.length === 1 && blocks[0] === '') ? false : blocks.includes(block.name)
          const shouldDig = mode === 'whitelist' ? isMatch : !isMatch

          if (shouldDig) {
            if (config.boolean.nukerRotate) bot.lookAt(targetPos)
            bot.dig(block).catch(() => { })
            return
          }
        }
      }
    }
  }



  bot.on('death', () => {
    bot.respawn()
  })

  function killaura() {
    if (!bot.entity) return
    if (hitTimer <= 0) {
      hit(
        storeinfo().boolean.targetPlayer,
        storeinfo().boolean.targetVehicle,
        storeinfo().boolean.targetMob,
        storeinfo().boolean.targetAnimal,
        storeinfo().value.killauraRange,
        storeinfo().boolean.killauraRotate
      )
      hitTimer = storeinfo().value.killauraDelay || 10
    } else {
      hitTimer--
    }
  }

  function hit(player, vehicle, mob, animal, maxDistance, rotate) {
    if (!bot.entity) return
    const maxDistSq = parseFloat(maxDistance) ** 2
    const entities = Object.values(bot.entities)
    for (const entity of entities) {
      if (entity === bot.entity) continue
      const distSq = bot.entity.position.distanceSquared(entity.position)
      if (distSq > maxDistSq) continue

      let isTarget = false
      if (player && entity.type === 'player' && entity.username !== bot.username) isTarget = true
      else if (vehicle && entity.kind === 'Vehicles') isTarget = true
      else if (mob && entity.kind === 'Hostile mobs') isTarget = true
      else if (animal && entity.kind === 'Passive mobs') isTarget = true

      if (isTarget) {
        if (rotate) bot.lookAt(entity.position, true)
        bot.attack(entity)
      }
    }
  }

  const botEventListener = (target, event, ...options) => {
    if (target !== bot._client.username) return
    const optionsArray = options[0]
    switch (event) {
      case 'disconnect':
        bot.quit()
        break
      case 'chat':
        const bypass = storeinfo().boolean.bypassChat ? ' ' + salt(crypto.randomInt(2, 6)) : ''
        bot.chat(
          optionsArray
            .join(' ')
            .replaceAll('{random}', salt(4))
            .replaceAll('{player}', bot._client.username) + bypass
        )
        break
      case 'notify':
        notify(
          'Bot',
          bot._client.username +
          ': ' +
          optionsArray
            .join(' ')
            .replaceAll('{random}', salt(4))
            .replaceAll('{player}', bot._client.username),
          'success'
        )
        break
      case 'sethotbar':
        bot.setQuickBarSlot(parseInt(optionsArray[0] ? optionsArray[0] : 0))
        break
      case 'useheld':
        bot.activateItem()
        break
      case 'winclick':
        bot.clickWindow(parseInt(optionsArray[0]), parseInt(optionsArray[1]), 0)
        break
      case 'drop':
        bot.clickWindow(-999, 0, 0)
        bot.clickWindow(parseInt(optionsArray[0]), 0, 0)
        bot.clickWindow(-999, 0, 0)
        break
      case 'dropall':
        ; (async () => {
          const itemCount = bot.inventory.items().length
          for (var i = 0; i < itemCount; i++) {
            if (bot.inventory.items().length === 0) return
            const item = bot.inventory.items()[0]
            bot.tossStack(item)
            await delay(10)
          }
        })()
        break
      case 'closewindow':
        bot.closeWindow(bot.currentWindow || '')
        break
      case 'startmove':
        bot.setControlState(optionsArray[0], true)
        break
      case 'stopmove':
        bot.setControlState(optionsArray[0], false)
        break
      case 'resetmove':
        bot.clearControlStates()
        break
      case 'look':
        bot.look(parseFloat(optionsArray[0]), 0, true)
        break
      case 'afkon':
        bot.afk.start()
        break
      case 'afkoff':
        bot.afk.stop()
        break
      case 'hit':
        const player = optionsArray[0]
        const vehicle = optionsArray[1]
        const mob = optionsArray[2]
        const animal = optionsArray[3]
        const maxDistance = parseFloat(optionsArray[4])
        const rotate = optionsArray[5]
        hit(player, vehicle, mob, animal, maxDistance, rotate)
        break
      case 'goto':
        const x = parseFloat(optionsArray[0])
        const y = parseFloat(optionsArray[1])
        const z = parseFloat(optionsArray[2])
        if (!movements) {
          movements = new Movements(bot)
          movements.canDig = true
          movements.allow1by1towers = true
          movements.allowParkour = true
          movements.allowSprinting = true
          const scaffoldBlocks = bot.inventory.items().filter(item => bot.registry.blocksByName[item.name]?.boundingBox === 'block')
          movements.scafoldingBlocks = scaffoldBlocks.map(i => i.type)
        }
        bot.pathfinder.setMovements(movements)
        bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z))
        break
      case 'pathstop':
        bot.pathfinder.stop()
        break
      case 'follow':
        const targetPlayer = bot.players[optionsArray[0]]
        if (targetPlayer && targetPlayer.entity) {
          if (!movements) {
            movements = new Movements(bot)
            movements.canDig = true
            movements.allow1by1towers = true
            movements.allowParkour = true
            movements.allowSprinting = true
          }
          bot.pathfinder.setMovements(movements)
          bot.pathfinder.setGoal(new goals.GoalFollow(targetPlayer.entity, 1), true)
        }
        break
      case 'interact':
        const ix = parseFloat(optionsArray[0])
        const iy = parseFloat(optionsArray[1])
        const iz = parseFloat(optionsArray[2])
        const side = optionsArray[3]
        const targetBlock = bot.blockAt(new mineflayer.vec3(ix, iy, iz))
        if (targetBlock) {
          if (side === 'left') {
            bot.dig(targetBlock).catch(() => { })
          } else {
            bot.activateBlock(targetBlock).catch(() => { })
          }
        }
        break
      default:
    }
  }

  botApi.on('botEvent', botEventListener)

  bot.once('end', (reason) => {
    const username = bot.username || options.username
    botApi.removeListener('botEvent', botEventListener)
    sendEvent(username, 'end', reason)
    if (storeinfo().boolean.autoReconnect) {
      setTimeout(() => {
        newBot(options)
      }, Math.max(storeinfo().value.reconnectDelay || 1000, 1000))
    }
  })
}

process.on('uncaughtException', (err) => {
  console.log(err)
})
process.on('UnhandledPromiseRejectionWarning', (err) => {
  console.log(err)
})

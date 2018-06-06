const electron = require('electron');
const app = electron.app;
const Menu = electron.Menu;
const menuTemplate = require('./menutemplate');
const BrowserWindow = electron.BrowserWindow;
const path = require('path');
const url = require('url');
const instagram = require('./instagram');
const autoUpdater = require('./autoupdater');

// fixes electron's timeout inconsistency
// not doing this on windows because the fix doesn't work for windows.
if (process.platform != 'win32') {
  require('./timeout-shim').fix();
}

const RATE_LIMIT_DELAY = 60000;
let pollingInterval = 10000;

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow
let session

function createWindow () {
  if (!mainWindow) {
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      icon: `${__dirname}/../browser/img/icon.png`,
      minWidth: 500,
      minHeight: 400
    })
  }
  mainWindow.setTitle('IG:dm - Instagram Desktop Messenger')

  instagram.checkAuth(session).then((result) => {
    let view = result.isLoggedIn ? '../browser/index.html' : '../browser/login.html'
    session = result.session || session

    mainWindow.loadURL(url.format({
      pathname: path.join(__dirname, view),
      protocol: 'file:',
      slashes: true
    }))
  })

  mainWindow.on('closed', () => mainWindow = null)
}

function getChatList () {
  instagram.getChatList(session).then((chats) => {
    mainWindow.webContents.send('chatList', chats)

    setTimeout(getChatList, pollingInterval);
  }).catch(() => setTimeout(getChatList, RATE_LIMIT_DELAY))
}

let timeoutObj;
let messagesThread;
function getChat (evt, id) {
  // used to get older messages, see #getOlderMessages
  if (messagesThread && messagesThread.threadId != id) {
    messagesThread = null
  }

  instagram.getChat(session, id).then((chat) => {
    mainWindow.webContents.send('chat', chat);

    if (timeoutObj) clearTimeout(timeoutObj)

    timeoutObj = setTimeout(getChat, pollingInterval, {}, id);
  }).catch(() => setTimeout(getChat, RATE_LIMIT_DELAY, evt, id))
}

app.on('ready', () => {
  createWindow();
  // only set the menu template when in production mode/
  // this also leaves the dev console enabled when in dev mode.
  if (!process.defaultApp) {
    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu); 
  }
  autoUpdater.init();
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  // only call createWindow afeter mainWindow is set to null at
  // mainWindow.on('closed')
  if (mainWindow === null) createWindow()
})

// reduce polling frequency when app is not active.
app.on('browser-window-blur', () => {
  pollingInterval = 30000;
})

app.on('browser-window-focus', () => {
  pollingInterval = 10000;
  app.setBadgeCount(0);
})

electron.ipcMain.on('login', (evt, data) => {
  if(data.username === "" || data.password === "") {
    return mainWindow.webContents.send('loginError', "Please enter all required fields");
  }
  instagram.login(data.username, data.password).then((session_) => {
    session = session_
    createWindow()
  }).catch((error) => {
    let message = 'An unknown error occurred.';
    if (error.message) {
      message = error.message;
    } else if (error.hasOwnProperty('json') && !!error.json.two_factor_required) {
      message = 'You have two factor authentication enabled. Two factor authentication is not yet supported.';
    }
    mainWindow.webContents.send('loginError', message);
  })
})

electron.ipcMain.on('logout', () => {
  instagram.logout()
  session = null
  createWindow()
})

electron.ipcMain.on('getLoggedInUser', () => {
  instagram.getLoggedInUser(session).then((user) => {
    mainWindow.webContents.send('loggedInUser', user);
  })
})

electron.ipcMain.on('getChatList', getChatList)

electron.ipcMain.on('getChat', getChat)

electron.ipcMain.on('getOlderMessages', (_, id) => {
  instagram.getOlderMessages(session, messagesThread, id)
    .then((data) => {
      messagesThread = data.thread
      mainWindow.webContents.send('olderMessages', data.messages)
    })
})

electron.ipcMain.on('message', (_, data) => {
  if (data.isNewChat) {
    instagram.sendNewChatMessage(session, data.message, data.users).then((chat) => getChat(null, chat[0].id))
  } else {
    instagram.sendMessage(session, data.message, data.chatId)
  }
})

electron.ipcMain.on('upload', (_, data) => {
  instagram.uploadFile(session, data.filePath, data.recipients)
    .then((chat) => {
      if (data.isNewChat) getChat(null, chat[0].id)
    })
})

electron.ipcMain.on('searchUsers', (_, search) => {
  instagram.searchUsers(session, search).then((users) => {
    mainWindow.webContents.send('searchResult', users);
  })
})

electron.ipcMain.on('markAsRead', (_, thread) => {
  instagram.seen(session, thread)
})

electron.ipcMain.on('increase-badge-count', (_) => {
  app.setBadgeCount(app.getBadgeCount() + 1);
})

electron.ipcMain.on('getUnfollowers', (_) => {
  instagram.getUnfollowers(session).then((users) => {
    mainWindow.webContents.send('unfollowers', users)
  })
})

electron.ipcMain.on('unfollow', (_, userId) => {
  instagram.unfollow(session, userId)
})

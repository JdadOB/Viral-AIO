const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mtg', {
  arena: {
    detectLog: () => ipcRenderer.invoke('arena:detect-log'),
    browseLog: () => ipcRenderer.invoke('arena:browse-log'),
    parseLog: (logPath) => ipcRenderer.invoke('arena:parse-log', logPath),
  },
  claude: {
    recommend: (params) => ipcRenderer.invoke('claude:recommend', params),
    trials: (params) => ipcRenderer.invoke('claude:trials', params),
  },
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    delete: (key) => ipcRenderer.invoke('store:delete', key),
  },
})

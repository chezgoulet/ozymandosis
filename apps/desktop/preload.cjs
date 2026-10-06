// SPDX-License-Identifier: AGPL-3.0-only
// The only bridge between the game page and the desktop shell: local-network
// hosting and discovery (js/net/lan.js calls these as window.ozyLan).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ozyLan', {
  startHost: opts => ipcRenderer.invoke('lan:host', opts),
  stopHost: () => ipcRenderer.invoke('lan:stop'),
  discover: opts => ipcRenderer.invoke('lan:discover', opts),
});

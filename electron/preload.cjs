const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("knowledge", {
  call: (action, payload) => ipcRenderer.invoke("knowledge", action, payload),
  droppedPaths: (files) =>
    files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  onClose: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("prepare-close", handler);
    return () => ipcRenderer.removeListener("prepare-close", handler);
  },
});

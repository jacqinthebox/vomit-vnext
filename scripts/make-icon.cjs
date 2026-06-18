// Render scripts/logo.html headlessly and save a 1024px transparent PNG master.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: false },
  });

  await win.loadFile(path.join(__dirname, 'logo.html'));
  await new Promise((r) => setTimeout(r, 500));

  let img = await win.webContents.capturePage();
  const size = img.getSize();
  if (size.width !== 1024 || size.height !== 1024) {
    img = img.resize({ width: 1024, height: 1024, quality: 'best' });
  }

  const outDir = path.join(process.cwd(), 'build');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'icon-master.png'), img.toPNG());
  console.log('wrote', path.join(outDir, 'icon-master.png'));
  app.quit();
});

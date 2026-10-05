import { app, BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// 用已有 Electron 渲染矢量源，避免新增图片工具依赖及不同平台的 SVG 渲染差异。
const root = resolve(import.meta.dirname, "..");
const requireDesktop = createRequire(join(root, "packages/desktop/package.json"));
const { Icns, IcnsImage } = requireDesktop("@fiahfy/icns");
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

function createIco(frames) {
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  for (const [index, { size, png }] of frames.entries()) {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  }
  return Buffer.concat([header, ...frames.map(({ png }) => png)]);
}

function deriveSvgVariants(svg) {
  const body = svg.match(/<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/)?.[1];
  const viewBox = svg.match(/\bviewBox="([^"]+)"/)?.[1];
  if (!body || !viewBox) throw new Error("Invalid canonical product SVG");
  // 界面透明版是唯一形状源；底板只在系统应用版本合成，轮廓不再独立维护一份路径。
  const application = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" fill="none">
  <defs>
    <linearGradient id="tile" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse">
      <stop stop-color="#EDF8FF"/>
      <stop offset="1" stop-color="#D3E9FD"/>
    </linearGradient>
  </defs>
  <rect data-native-backplate="true" x="1" y="1" width="254" height="254" rx="46" fill="url(#tile)" stroke="#BFDEF5" stroke-width="2"/>
${body.trim()}
</svg>
`;
  const geometry = body
    .replace(/<defs>[\s\S]*?<\/defs>/, "")
    .replace(/\s+(?:fill|stroke|stroke-width|stroke-linejoin)="[^"]*"/g, "")
    .trim();
  const outline = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round">
${geometry}
</svg>
`;
  return { application, outline };
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-device-scale-factor", "1");
async function generateProductIcons() {
  let window;
  try {
    const svg = await readFile(
      join(root, "packages/ui/src/assets/branding/czce-agent.svg"),
      "utf8",
    );
    const { application, outline } = deriveSvgVariants(svg);
    window = new BrowserWindow({
      width: 1024,
      height: 1024,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      webPreferences: { sandbox: true, contextIsolation: true, offscreen: true },
    });
    async function renderIcon(vector) {
      await window.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(
          `<style>html,body{margin:0;width:100%;height:100%;background:transparent}img{display:block;width:100%;height:100%}</style><img src="data:image/svg+xml;base64,${Buffer.from(vector).toString("base64")}">`,
        )}`,
      );
      const image = await window.webContents.capturePage();
      if (image.isEmpty() || image.getSize().width !== 1024 || image.getSize().height !== 1024) {
        throw new Error("Product icon renderer did not return a 1024px image");
      }
      return image;
    }
    const image = await renderIcon(application);
    const frames = sizes.map((size) => ({
      size,
      png: image.resize({ width: size, height: size, quality: "best" }).toPNG(),
    }));
    const icns = new Icns();
    for (const [type, size] of Object.entries({
      icp4: 16,
      icp5: 32,
      icp6: 64,
      ic07: 128,
      ic08: 256,
      ic09: 512,
      ic10: 1024,
    })) {
      icns.append(IcnsImage.fromPNG(frames.find((frame) => frame.size === size).png, type));
    }
    const ico = createIco(frames.filter(({ size }) => size <= 256));
    const publicRoot = join(root, "public/logo/icons");
    const desktopRoot = join(root, "packages/desktop/build");
    const startupRoot = join(root, "packages/desktop/src/renderer/public/branding");
    for (const directory of [publicRoot, join(desktopRoot, "icons"), startupRoot]) {
      await mkdir(directory, { recursive: true });
    }
    for (const { size, png } of frames) {
      await writeFile(join(publicRoot, `${size}x${size}.png`), png);
      await writeFile(join(desktopRoot, "icons", `${size}x${size}.png`), png);
    }
    await writeFile(join(publicRoot, "icon.ico"), ico);
    await writeFile(join(publicRoot, "icon.icns"), icns.data);
    for (const name of ["icon", "icon_installer"]) {
      await writeFile(join(desktopRoot, `${name}.ico`), ico);
      await writeFile(join(desktopRoot, `${name}.icns`), icns.data);
    }
    const master = frames.find(({ size }) => size === 1024).png;
    await writeFile(join(root, "public/icon_512@2x.png"), master);
    for (const name of ["icon.png", "icon_windows.png", "icon_installer.png"]) {
      await writeFile(join(desktopRoot, name), master);
    }
    await writeFile(join(startupRoot, "czce-agent.svg"), svg);
    await writeFile(join(root, "public/logo/czce-agent-app.svg"), application);
    await writeFile(join(root, "packages/ui/src/assets/branding/czce-agent-outline.svg"), outline);
    const transparentImage = await renderIcon(svg);
    const agentIcon = transparentImage.resize({ width: 256, height: 256, quality: "best" }).toPNG();
    await writeFile(join(root, "public/logo/czce-agent.png"), agentIcon);
    await writeFile(join(startupRoot, "czce-agent.png"), agentIcon);
    for (const name of ["icon-glm.png", "icon-glm-for-light.png", "icon-glm-for-dark.png"]) {
      await writeFile(join(root, "packages/ui/src/assets/cli-icons", name), agentIcon);
    }
    process.stdout.write(
      "Generated CZCE Agent icons: transparent interface, themed outline and B native backplate; 9 PNG sizes, ICO and ICNS.\n",
    );
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  } finally {
    window?.destroy();
    app.exit(process.exitCode ?? 0);
  }
}

// Electron ESM 会等待入口模块完成再发出 ready；顶层 await whenReady 会互相等待。
void app.whenReady().then(generateProductIcons);

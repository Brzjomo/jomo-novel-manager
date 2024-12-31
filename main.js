import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import iconv from 'iconv-lite';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { NovelServer } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_NAME = 'JOMO小说管理工具';
const LAST_DIR_KEY = 'lastNovelDirectory';
const SETTINGS_KEY = 'settings';
const DEFAULT_SETTINGS = {
    editor: '', // 默认使用系统默认编辑器
    theme: 'light', // 默认使用浅色主题
    previewLength: 1500 // 默认预览1500字
};

// 读取 package.json 获取版本号
const packageJson = JSON.parse(
    await readFile(
        new URL('./package.json', import.meta.url),
        'utf8'
    )
);
const appVersion = packageJson.version;

let mainWindow;
let settingsWindow = null;
let currentNovelPath = '';
let fileWatcher = null;
let novelServer = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: APP_NAME,
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // 修改窗口标题，加上版本号
    mainWindow.setTitle(`${APP_NAME} v${appVersion}`);

    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    } else {
      Menu.setApplicationMenu(null);
      mainWindow.webContents.on('devtools-opened', () => {
          mainWindow.webContents.closeDevTools();
      });
    }

    mainWindow.loadFile('index.html');

    // 窗口加载完成后尝试加载上次的目录和设置
    mainWindow.webContents.on('did-finish-load', async () => {
        const lastDir = loadLastDirectory();
        if (lastDir) {
            mainWindow.webContents.send('directory-selected', lastDir);
        }
        // 发送初始设置
        const settings = loadSettings();
        mainWindow.webContents.send('init-settings', settings);
        mainWindow.webContents.send('app-version', appVersion);

        // 初始化并启动web服务器
        if (!novelServer) {
            novelServer = new NovelServer(settings, currentNovelPath);
            try {
                await novelServer.start();
                console.log('Web服务器已启动');
            } catch (error) {
                console.error('Web服务器启动失败:', error);
            }
        }
    });
}

app.whenReady().then(createWindow);

function createSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        parent: mainWindow,
        modal: true,
        width: 500,
        height: 300,
        title: APP_NAME + ' - 设置',
        icon: path.join(__dirname, 'icon.ico'),
        minimizable: false,
        maximizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    if (process.env.NODE_ENV === 'development') {
        settingsWindow.webContents.openDevTools();
    } else {
      Menu.setApplicationMenu(null);
      settingsWindow.webContents.on('devtools-opened', () => {
        settingsWindow.webContents.closeDevTools();
      });
    }

    settingsWindow.loadFile('settings.html');
    settingsWindow.setMenu(null);

    // 窗口加载完成后发送当前设置
    settingsWindow.webContents.on('did-finish-load', () => {
        const settings = loadSettings();
        settingsWindow.webContents.send('init-settings', settings);
    });

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}

function loadSettings() {
    try {
        const filePath = path.join(app.getPath('userData'), SETTINGS_KEY);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (err) {
        console.error('加载设置失败:', err);
    }
    return DEFAULT_SETTINGS;
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(
            path.join(app.getPath('userData'), SETTINGS_KEY),
            JSON.stringify(settings),
            'utf8'
        );
    } catch (err) {
        console.error('保存设置失败:', err);
    }
}

// 添加选择目录的处理函数
ipcMain.on('select-directory', async (event) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
        const dirPath = result.filePaths[0];
        currentNovelPath = dirPath;

        try {
            await fsPromises.writeFile(
                path.join(app.getPath('userData'), LAST_DIR_KEY),
                dirPath
            );
            event.reply('directory-selected', dirPath);

            // 更新web服务器的目录
            if (novelServer) {
                novelServer.updateNovelPath(dirPath);
            }

            // 移除旧的监视器
            if (fileWatcher) {
                fileWatcher.close();
            }

            // 添加新的文件监视
            fileWatcher = fs.watch(
                dirPath,
                { recursive: true },
                (eventType, filename) => {
                    if (filename && filename.toLowerCase().endsWith('.txt')) {
                        // 延迟发送更新事件，避免频繁刷新
                        setTimeout(() => {
                            mainWindow.webContents.send('files-changed');
                        }, 100);
                    }
                }
            );
        } catch (err) {
            console.error('保存目录路径失败:', err);
        }
    }
});

function saveLastDirectory(dirPath) {
    try {
        fs.writeFileSync(
            path.join(app.getPath('userData'), LAST_DIR_KEY),
            dirPath,
            'utf8'
        );
    } catch (err) {
        console.error('保存目录失败:', err);
    }
}

function loadLastDirectory() {
    try {
        const filePath = path.join(app.getPath('userData'), LAST_DIR_KEY);
        if (fs.existsSync(filePath)) {
            const dirPath = fs.readFileSync(filePath, 'utf8');
            if (fs.existsSync(dirPath)) {
                currentNovelPath = dirPath;
                return dirPath;
            }
        }
    } catch (err) {
        console.error('加载上次目录失败:', err);
    }
    return null;
}

// 处理获取文件列表请求
ipcMain.on('get-files', async (event, viewType) => {
    if (!currentNovelPath) {
        event.reply('files-list', []);
        return;
    }
    const files = await getAllFiles(currentNovelPath, viewType);
    event.reply('files-list', files);
});

// 读取文件预览内容
ipcMain.on('preview-file', async (event, filePath) => {
    try {
        // 首先尝试 UTF-8
        let content = await fsPromises.readFile(filePath, 'utf8');
        
        // 如果是乱码，尝试 GB2312
        if (containsGarbledText(content)) {
            content = await readFileWithEncoding(filePath, 'gb2312');
            
            // 如果还是乱码，尝试 UTF-16
            if (containsGarbledText(content)) {
                content = await readFileWithEncoding(filePath, 'utf16le');
            }
        }
        
        // 处理不同系统的换行符
        content = content
            .replace(/\r\n/g, '\n')  // Windows 换行符
            .replace(/\r/g, '\n');   // Mac 旧版换行符
        
        // 使用设置中的预览长度
        const settings = loadSettings();
        const preview = content.substring(0, settings.previewLength);
        event.reply('file-preview', preview);
    } catch (err) {
        console.error('读取文件失败:', err);
        event.reply('file-preview', '文件读取失败：' + err.message);
    }
});

async function readFileWithEncoding(filePath, encoding) {
    const buffer = await fsPromises.readFile(filePath);
    
    if (encoding === 'gb2312') {
        return iconv.decode(buffer, 'gb2312');
    } else if (encoding === 'utf16le') {
        return iconv.decode(buffer, 'utf16le');
    }
    return buffer.toString(encoding);
}

function containsGarbledText(text) {
    // 如果文本为空，返回 true 表示需要尝试其他编码
    if (!text || text.length === 0) {
        return true;
    }

    // 检查是否包含常见乱码特征
    const garbledPattern = /[\uFFFD\u0000-\u0008\u000B-\u000C\u000E-\u001F]/;
    
    // 检查中文文本的合理性
    const chinesePattern = /[\u4e00-\u9fa5]/;
    const totalChars = text.length;
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    
    // 计算可打印字符的数量（包括中文、英文字母、数字、常用标点）
    const printableChars = (text.match(/[\u4e00-\u9fa5a-zA-Z0-9\s,.!?，。！？、：；""''（）《》\-]/g) || []).length;
    
    // 计算可打印字符比例
    const printableRatio = printableChars / totalChars;
    
    // 如果文本包含中文
    if (chinesePattern.test(text)) {
        // 中文字符比例过低（小于5%）且可打印字符比例过低（小于60%）时，可能是乱码
        return (chineseChars / totalChars < 0.05 && printableRatio < 0.6) || garbledPattern.test(text);
    }
    
    // 如果文本不包含中文，主要检查可打印字符比例
    return printableRatio < 0.6 || garbledPattern.test(text);
}

// 在默认编辑器中打开文件
ipcMain.on('open-file', async (event, filePath) => {
    const settings = loadSettings();
    if (settings.editor) {
        // 使用自定义编辑器
        try {
            spawn(settings.editor, [filePath], {
                detached: true,
                stdio: 'ignore'
            });
        } catch (err) {
            console.error('打开编辑器失败:', err);
            // 如果自定义编辑器失败，回退到默认方式
            shell.openPath(filePath);
        }
    } else {
        // 使用系统默认编辑器
        shell.openPath(filePath);
    }
});

// 添加设置对话框的处理
ipcMain.on('show-settings', () => {
    createSettingsWindow();
});

// 添加重置设置的处理
ipcMain.on('reset-settings', (event) => {
    saveSettings(DEFAULT_SETTINGS);
    // 通知所有窗口更新设置
    BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('settings-updated', DEFAULT_SETTINGS);
    });
});

// 处理选择编辑器的请求
ipcMain.on('select-editor', async (event) => {
    const result = await dialog.showOpenDialog(settingsWindow, {
        title: '选择文本编辑器',
        filters: [
            { name: '可执行文件', extensions: ['exe'] },
            { name: '所有文件', extensions: ['*'] }
        ],
        properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
        const settings = loadSettings();
        settings.editor = result.filePaths[0];
        saveSettings(settings);
        event.reply('editor-selected', result.filePaths[0]);
    }
});

// 处理重置编辑器设置
ipcMain.on('reset-editor', (event) => {
    saveSettings(DEFAULT_SETTINGS);
    event.reply('editor-selected', '');
});

// 在资源管理器中显示文件
ipcMain.on('show-in-folder', (event, filePath) => {
    shell.showItemInFolder(filePath);
});

async function getAllFiles(dirPath, viewType) {
    try {
        const files = await fsPromises.readdir(dirPath, { withFileTypes: true });
        let result = [];

        for (const file of files) {
            const fullPath = path.join(dirPath, file.name);
            
            if (file.isDirectory()) {
                const subFiles = await getAllFiles(fullPath, viewType);
                if (viewType === 'tree') {
                    if (subFiles.length > 0) {
                        result.push({
                            name: file.name,
                            path: fullPath,
                            type: 'directory',
                            children: subFiles
                        });
                    }
                } else {
                    result = result.concat(subFiles);
                }
            } else if (file.name.toLowerCase().endsWith('.txt')) {
                result.push({
                    name: file.name,
                    path: fullPath,
                    type: 'file'
                });
            }
        }

        return result;
    } catch (err) {
        console.error('Error reading directory:', err);
        return [];
    }
}

ipcMain.on('download-file', async (event, filePath) => {
    try {
        const result = await dialog.showSaveDialog(mainWindow, {
            title: APP_NAME,
            defaultPath: path.basename(filePath),
            filters: [
                { name: 'Text Files', extensions: ['txt'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (!result.canceled && result.filePath) {
            await fsPromises.copyFile(filePath, result.filePath);
        }
    } catch (err) {
        console.error('下载文件失败:', err);
        dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: APP_NAME,
            message: '文件保存失败：' + err.message
        });
    }
});

// 在 ipcMain 中添加主题切换处理
ipcMain.on('change-theme', (event, theme) => {
    const settings = loadSettings();
    settings.theme = theme;
    saveSettings(settings);
    // 通知所有窗口更新主题
    BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('theme-changed', theme);
    });
});

// 添加设置更新处理
ipcMain.on('update-settings', (event, newSettings) => {
    const currentSettings = loadSettings();
    // 合并设置
    const settings = { ...currentSettings, ...newSettings };
    saveSettings(settings);
    
    // 更新web服务器的设置
    if (novelServer) {
        novelServer.updateSettings(settings);
    }
    
    // 通知所有窗口更新设置
    BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('settings-updated', settings);
    });
});

// 处理显示消息对话框的请求
ipcMain.on('show-message', (event, options) => {
    dialog.showMessageBox(mainWindow, {
        type: options.type,
        title: options.title,
        message: options.message,
        buttons: ['确定']
    });
});


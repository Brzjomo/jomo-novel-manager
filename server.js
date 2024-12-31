import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import iconv from 'iconv-lite';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class NovelServer {
    constructor(settings, currentNovelPath) {
        this.app = express();
        this.settings = settings;
        this.currentNovelPath = currentNovelPath;
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json());
        
        let rendererPath, stylesPath;
        
        if (process.env.NODE_ENV === 'release') {
            const appPath = process.type === 'renderer' 
                ? path.join(__dirname, '../..') 
                : path.join(process.resourcesPath, 'app');
            rendererPath = appPath;
            stylesPath = path.join(appPath, 'styles');
        } else {
            // 开发环境路径
            rendererPath = path.join(__dirname, '..');
            stylesPath = path.join(__dirname, 'styles');
        }
        
        console.log('Static paths:', {
            env: process.env.NODE_ENV,
            rendererPath,
            stylesPath
        });
        
        this.app.use(express.static(rendererPath));
        this.app.use('/styles', express.static(stylesPath));
    }

    setupRoutes() {
        // 根路由重定向到web.html
        this.app.get('/', (req, res) => {
            res.redirect('/web.html');
        });

        // 专门处理 web.html 的路由
        this.app.get('/web.html', (req, res) => {
            let webHtmlPath;
            if (process.env.NODE_ENV === 'release') {
                const appPath = process.type === 'renderer' 
                    ? path.join(__dirname, '..') 
                    : path.join(process.resourcesPath, 'app');
                webHtmlPath = path.join(appPath, 'web.html');
            } else {
                webHtmlPath = path.join(__dirname, 'web.html');
            }
            
            // 添加调试日志
            console.log('Web HTML 路径信息:', {
                env: process.env.NODE_ENV,
                __dirname,
                webHtmlPath,
                fileExists: fs.existsSync(webHtmlPath)
            });

            if (!fs.existsSync(webHtmlPath)) {
                res.status(404).send(`文件不存在: ${webHtmlPath}`);
                return;
            }
            
            res.sendFile(webHtmlPath);
        });

        // 专门处理 web-renderer.js 的路由
        this.app.get('/web-renderer.js', (req, res) => {
            let jsPath;
            if (process.env.NODE_ENV === 'release') {
                const appPath = process.type === 'renderer' 
                    ? path.join(__dirname, '..') 
                    : path.join(process.resourcesPath, 'app');
                jsPath = path.join(appPath, 'web-renderer.js');
            } else {
                jsPath = path.join(__dirname, 'web-renderer.js');
            }
            
            // 添加调试日志
            console.log('Web Renderer JS 路径信息:', {
                env: process.env.NODE_ENV,
                __dirname,
                jsPath,
                fileExists: fs.existsSync(jsPath)
            });

            if (!fs.existsSync(jsPath)) {
                res.status(404).send(`文件不存在: ${jsPath}`);
                return;
            }
            
            res.sendFile(jsPath);
        });

        // 获取当前目录
        this.app.get('/api/current-directory', (req, res) => {
            res.json({ path: this.currentNovelPath });
        });

        // 获取文件列表
        this.app.get('/api/files', async (req, res) => {
            try {
                if (!this.currentNovelPath) {
                    res.json([]);
                    return;
                }
                const viewType = req.query.viewType || 'list';
                const files = await this.getAllFiles(this.currentNovelPath, viewType);
                res.json(files);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // 获取文件预览
        this.app.get('/api/preview', async (req, res) => {
            try {
                let filePath = req.query.path;
                if (!filePath) {
                    res.status(400).json({ error: '缺少文件路径参数' });
                    return;
                }

                // 处理路径编码
                try {
                    filePath = decodeURIComponent(filePath);
                } catch (e) {
                    filePath = Buffer.from(filePath, 'binary').toString();
                }

                // 修正路径格式
                filePath = filePath.replace(/^([A-Za-z]):/, (match, drive) => {
                    return `${drive}:\\`;  // 将 E: 转换为 E:\
                });

                // 规范化路径，处理 Windows 路径分隔符
                const fullPath = path.normalize(filePath);
                const normalizedNovelPath = path.normalize(this.currentNovelPath);
                
                // 转换为小写进行比较（Windows 系统不区分大小写）
                const lowerFullPath = fullPath.toLowerCase();
                const lowerNovelPath = normalizedNovelPath.toLowerCase();

                // 调试输出
                console.log('Path comparison:', {
                    originalPath: filePath,
                    fullPath: fullPath,
                    novelPath: normalizedNovelPath,
                    lowerFullPath: lowerFullPath,
                    lowerNovelPath: lowerNovelPath
                });

                // 检查路径是否在允许的目录内
                if (!lowerFullPath.startsWith(lowerNovelPath)) {
                    res.status(403).json({ error: '无权访问该文件' });
                    return;
                }

                // 检查文件是否存在
                try {
                    await fsPromises.access(filePath, fs.constants.F_OK);
                } catch (err) {
                    res.status(404).json({ error: '文件不存在' });
                    return;
                }

                let content = await this.readFileWithEncoding(filePath);
                content = content
                    .replace(/\r\n/g, '\n')
                    .replace(/\r/g, '\n');

                const preview = content.substring(0, this.settings.previewLength);
                res.json({ preview });
            } catch (error) {
                console.error('预览文件失败:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // 下载文件
        this.app.get('/api/download', async (req, res) => {
            try {
                let filePath = req.query.path;
                if (!filePath) {
                    res.status(400).json({ error: '缺少文件路径参数' });
                    return;
                }

                // 处理路径编码
                try {
                    filePath = decodeURIComponent(filePath);
                } catch (e) {
                    filePath = Buffer.from(filePath, 'binary').toString();
                }

                // 修正路径格式
                filePath = filePath.replace(/^([A-Za-z]):/, (match, drive) => {
                    return `${drive}:\\`;  // 将 E: 转换为 E:\
                });

                // 规范化路径
                const fullPath = path.normalize(filePath);
                const normalizedNovelPath = path.normalize(this.currentNovelPath);
                
                // 检查路径是否在允许的目录内
                if (!fullPath.toLowerCase().startsWith(normalizedNovelPath.toLowerCase())) {
                    res.status(403).json({ error: '无权访问该文件' });
                    return;
                }

                // 检查文件是否存在
                if (!fs.existsSync(fullPath)) {
                    res.status(404).json({ error: '文件不存在' });
                    return;
                }

                res.download(fullPath);
            } catch (error) {
                console.error('下载文件失败:', error);
                res.status(500).json({ error: error.message });
            }
        });
    }

    async getAllFiles(dirPath, viewType) {
        try {
            const files = await fsPromises.readdir(dirPath, { withFileTypes: true });
            let result = [];

            for (const file of files) {
                const fullPath = path.join(dirPath, file.name)
                    .replace(/\\/g, '/');
                
                if (file.isDirectory()) {
                    const subFiles = await this.getAllFiles(fullPath, viewType);
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

    async readFileWithEncoding(filePath) {
        const buffer = await fsPromises.readFile(filePath);
        
        // 尝试不同的编码
        const encodings = ['utf8', 'gb2312', 'utf16le'];
        for (const encoding of encodings) {
            try {
                let content;
                if (encoding === 'utf8') {
                    content = buffer.toString();
                } else {
                    content = iconv.decode(buffer, encoding);
                }
                
                if (!this.containsGarbledText(content)) {
                    return content;
                }
            } catch (err) {
                console.error(`Failed to decode with ${encoding}:`, err);
            }
        }
        
        // 如果所有编码都失败，返回UTF-8结果
        return buffer.toString();
    }

    containsGarbledText(text) {
        if (!text || text.length === 0) {
            return true;
        }

        const garbledPattern = /[\uFFFD\u0000-\u0008\u000B-\u000C\u000E-\u001F]/;
        const chinesePattern = /[\u4e00-\u9fa5]/;
        const totalChars = text.length;
        const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        const printableChars = (text.match(/[\u4e00-\u9fa5a-zA-Z0-9\s,.!?，。！？、：；""''（）《》\-]/g) || []).length;
        const printableRatio = printableChars / totalChars;

        if (chinesePattern.test(text)) {
            return (chineseChars / totalChars < 0.05 && printableRatio < 0.6) || garbledPattern.test(text);
        }
        
        return printableRatio < 0.6 || garbledPattern.test(text);
    }

    start(port = 3000) {
        return new Promise((resolve, reject) => {
            try {
                const server = this.app.listen(port, () => {
                    console.log(`小说管理服务器运行在 http://localhost:${port}`);
                    resolve(server);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    updateSettings(settings) {
        this.settings = settings;
    }

    updateNovelPath(path) {
        this.currentNovelPath = path;
    }
} 
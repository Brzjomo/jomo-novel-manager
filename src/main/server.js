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
        
        // 提供静态文件服务
        const rendererPath = path.join(__dirname, '../renderer');
        const stylesPath = path.join(__dirname, '../../styles');
        
        this.app.use(express.static(rendererPath));
        this.app.use('/styles', express.static(stylesPath));
    }

    setupRoutes() {
        // 根路由重定向到web.html
        this.app.get('/', (req, res) => {
            res.redirect('/web.html');
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
        this.app.get('/api/preview/:filename', async (req, res) => {
            try {
                const filePath = path.join(this.currentNovelPath, req.params.filename);
                if (!fs.existsSync(filePath)) {
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
                res.status(500).json({ error: error.message });
            }
        });

        // 下载文件
        this.app.get('/api/download/:filename', (req, res) => {
            try {
                const filePath = path.join(this.currentNovelPath, req.params.filename);
                if (!fs.existsSync(filePath)) {
                    res.status(404).json({ error: '文件不存在' });
                    return;
                }
                res.download(filePath);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }

    async getAllFiles(dirPath, viewType) {
        try {
            const files = await fsPromises.readdir(dirPath, { withFileTypes: true });
            let result = [];

            for (const file of files) {
                const fullPath = path.join(dirPath, file.name);
                
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
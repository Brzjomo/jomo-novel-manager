const { ipcRenderer } = require('electron');

let currentView = 'list';
let currentFile = null;
let allFiles = [];
let searchTimeout = null;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 监听初始设置
    ipcRenderer.on('init-settings', (event, settings) => {
        // 应用主题
        const themeLink = document.getElementById('theme-style');
        themeLink.href = `styles/${settings.theme || 'light'}.css`;
        // 加载文件列表
        loadFiles();
    });

    document.getElementById('settings').addEventListener('click', () => {
        ipcRenderer.send('show-settings');
    });

    document.getElementById('selectDir').addEventListener('click', () => {
        ipcRenderer.send('select-directory');
    });
    
    document.getElementById('toggleView').addEventListener('click', () => {
        currentView = currentView === 'list' ? 'tree' : 'list';
        loadFiles();
    });
    
    document.getElementById('download').addEventListener('click', () => {
        if (currentFile) {
            ipcRenderer.send('download-file', currentFile);
        }
    });
    
    document.getElementById('openFile').addEventListener('click', () => {
        if (currentFile) {
            ipcRenderer.send('open-file', currentFile);
        }
    });
    
    document.getElementById('showInFolder').addEventListener('click', () => {
        if (currentFile) {
            ipcRenderer.send('show-in-folder', currentFile);
        }
    });

    // 添加拖动调整功能
    const resizer = document.getElementById('resizer');
    const fileList = document.querySelector('.file-list');
    let isResizing = false;
    let lastWidth = localStorage.getItem('fileListWidth') || '30%';
    fileList.style.width = lastWidth;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        
        // 防止选中文本
        document.addEventListener('selectstart', preventSelect);
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const containerWidth = document.querySelector('.container').offsetWidth;
        let newWidth = e.clientX;
        
        // 确保宽度在允许范围内
        newWidth = Math.max(200, Math.min(newWidth, containerWidth * 0.5));
        
        // 转换为百分比
        const widthPercent = (newWidth / containerWidth * 100) + '%';
        fileList.style.width = widthPercent;
        
        // 保存当前宽度到 localStorage
        localStorage.setItem('fileListWidth', widthPercent);
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = 'default';
            document.removeEventListener('selectstart', preventSelect);
        }
    });

    // 获取当前设置
    const settings = JSON.parse(localStorage.getItem('settings') || '{"theme":"light"}');
    const themeLink = document.getElementById('theme-style');
    themeLink.href = `styles/${settings.theme}.css`;

    // 搜索框功能
    const searchInput = document.getElementById('searchInput');
    const clearSearch = document.getElementById('clearSearch');

    searchInput.addEventListener('input', (e) => {
        // 使用防抖处理搜索
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }
        searchTimeout = setTimeout(() => {
            const searchTerm = e.target.value.toLowerCase();
            filterAndDisplayFiles(searchTerm);
        }, 300);
    });

    clearSearch.addEventListener('click', () => {
        searchInput.value = '';
        filterAndDisplayFiles('');
    });

    // 修改文件列表接收处理
    ipcRenderer.on('files-list', (event, files) => {
        allFiles = files; // 保存所有文件
        const searchTerm = searchInput.value.toLowerCase();
        filterAndDisplayFiles(searchTerm);
    });

    function filterAndDisplayFiles(searchTerm) {
        const fileTree = document.getElementById('fileTree');
        fileTree.innerHTML = '';
        
        if (!searchTerm) {
            // 没有搜索词时显示所有文件
            if (currentView === 'list') {
                renderFileList(allFiles, fileTree);
            } else {
                renderFileTree(allFiles, fileTree);
            }
            return;
        }

        // 在列表视图中搜索
        if (currentView === 'list') {
            const filteredFiles = allFiles.filter(file => 
                file.name.toLowerCase().includes(searchTerm)
            );
            renderFileList(filteredFiles, fileTree);
        } else {
            // 在树视图中搜索
            const filteredFiles = filterTreeFiles(allFiles, searchTerm);
            renderFileTree(filteredFiles, fileTree);
        }
    }

    function filterTreeFiles(files, searchTerm) {
        return files.reduce((acc, file) => {
            if (file.type === 'directory') {
                const filteredChildren = filterTreeFiles(file.children || [], searchTerm);
                if (filteredChildren.length > 0) {
                    acc.push({
                        ...file,
                        children: filteredChildren
                    });
                }
            } else if (file.name.toLowerCase().includes(searchTerm)) {
                acc.push(file);
            }
            return acc;
        }, []);
    }

    // 添加滚动到顶部功能
    const scrollTopBtn = document.getElementById('scrollTopBtn');
    const fileTree = document.getElementById('fileTree');

    // 监听文件树的滚动事件
    fileTree.addEventListener('scroll', () => {
        // 当滚动超过300px时显示按钮
        if (fileTree.scrollTop > 280) {
            scrollTopBtn.style.display = 'flex';
        } else {
            scrollTopBtn.style.display = 'none';
        }
    });

    // 点击按钮滚动到顶部
    scrollTopBtn.addEventListener('click', () => {
        fileTree.scrollTo({
            top: 0,
            behavior: 'smooth'  // 平滑滚动
        });
    });

    ipcRenderer.on('app-version', (event, version) => {
        document.title = `JOMO小说管理工具 v${version}`;
    });
});

// 阻止文本选择
function preventSelect(e) {
    e.preventDefault();
    return false;
}

// 加载文件列表
function loadFiles() {
    const lastWidth = localStorage.getItem('fileListWidth');
    if (lastWidth) {
        document.querySelector('.file-list').style.width = lastWidth;
    }
    ipcRenderer.send('get-files', currentView);
}

// 添加新的 IPC 监听器
ipcRenderer.on('directory-selected', (event, path) => {
    if (path) {
        currentNovelPath = path;
        loadFiles(); // 重新加载文件列表
    }
});

// 接收文件列表
ipcRenderer.on('files-list', (event, files) => {
    const fileTree = document.getElementById('fileTree');
    fileTree.innerHTML = '';
    
    if (currentView === 'list') {
        renderFileList(files, fileTree);
    } else {
        renderFileTree(files, fileTree);
    }
});

// 渲染文件预览
ipcRenderer.on('file-preview', (event, content) => {
    const previewElement = document.getElementById('preview');
    
    // 如果返回的是错误消息且包含文件不存在的提示，刷新列表
    if (content.startsWith('文件读取失败：') && content.includes('ENOENT')) {
        loadFiles();
        previewElement.textContent = '文件已被删除';
        return;
    }
    
    previewElement.textContent = content;
    // 重置滚动位置到顶部
    previewElement.scrollTop = 0;
});

function renderFileList(files, container) {
    files.forEach(file => {
        const div = document.createElement('div');
        div.className = 'file-item';
        div.textContent = file.name.replace(/\.txt$/i, '');
        div.onclick = () => {
            // 移除其他文件的选中状态
            container.querySelectorAll('.file-item').forEach(item => {
                item.classList.remove('selected');
            });
            // 添加当前文件的选中状态
            div.classList.add('selected');
            currentFile = file.path;
            ipcRenderer.send('preview-file', file.path);
        };
        container.appendChild(div);
    });
}

function renderFileTree(files, container) {
    files.forEach(file => {
        const div = document.createElement('div');
        
        if (file.type === 'directory') {
            const folderDiv = document.createElement('div');
            folderDiv.className = 'directory-item';
            folderDiv.style.marginLeft = '20px';
            
            // 添加折叠图标和文件夹名称
            const titleDiv = document.createElement('div');
            titleDiv.className = 'folder-title';
            titleDiv.innerHTML = `<span class="folder-icon">▼</span> 📁 ${file.name}`;
            folderDiv.appendChild(titleDiv);
            
            // 创建子文件容器
            const childContainer = document.createElement('div');
            childContainer.className = 'folder-content';
            renderFileTree(file.children, childContainer);
            folderDiv.appendChild(childContainer);
            
            // 添加点击事件处理折叠
            titleDiv.onclick = (e) => {
                e.stopPropagation();
                const icon = titleDiv.querySelector('.folder-icon');
                const content = titleDiv.parentElement.querySelector('.folder-content');
                
                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    icon.textContent = '▼';
                } else {
                    content.style.display = 'none';
                    icon.textContent = '▶';
                }
            };
            
            div.appendChild(folderDiv);
        } else {
            div.className = 'file-item';
            div.style.marginLeft = '20px';
            div.textContent = `📄 ${file.name.replace(/\.txt$/i, '')}`;
            div.onclick = () => {
                document.querySelectorAll('.file-item').forEach(item => {
                    item.classList.remove('selected');
                });
                div.classList.add('selected');
                currentFile = file.path;
                ipcRenderer.send('preview-file', file.path);
            };
        }
        
        container.appendChild(div);
    });
}

// 添加主题切换处理
ipcRenderer.on('theme-changed', (event, theme) => {
    const themeLink = document.getElementById('theme-style');
    themeLink.href = `styles/${theme}.css`;
});

// 监听设置更新
ipcRenderer.on('settings-updated', (event, settings) => {
    // 如果当前有预览的文件，则重新加载预览
    if (currentFile) {
        ipcRenderer.send('preview-file', currentFile);
    }
});

// 监听文件变动
ipcRenderer.on('files-changed', () => {
    loadFiles();
});

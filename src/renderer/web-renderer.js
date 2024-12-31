const API_BASE = 'http://localhost:3000/api';
let currentFilePath = null;
let currentViewType = 'list'; // 或 'tree'

// 初始化界面
document.addEventListener('DOMContentLoaded', () => {
    // 绑定事件
    document.getElementById('toggleView').addEventListener('click', toggleView);
    document.getElementById('download').addEventListener('click', downloadCurrentFile);
    document.getElementById('searchInput').addEventListener('input', handleSearch);
    document.getElementById('clearSearch').addEventListener('click', clearSearch);
    document.getElementById('scrollTopBtn').addEventListener('click', scrollToTop);
    document.getElementById('previewClose').addEventListener('click', closePreview);

    // 监听滚动事件
    document.getElementById('fileTree').addEventListener('scroll', handleScroll);

    // 监听预览窗口的点击事件，点击遮罩层关闭预览
    document.getElementById('previewModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('previewModal')) {
            closePreview();
        }
    });

    // 监听ESC键关闭预览
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closePreview();
        }
    });

    // 初始化数据
    refreshFileList();
    setInterval(refreshFileList, 30000); // 每30秒刷新一次

    // 添加移动端触摸滑动支持
    setupTouchEvents();
});

// 设置触摸事件
function setupTouchEvents() {
    let startX, startY;
    const container = document.querySelector('.container');
    const previewContent = document.querySelector('.preview-content');

    container.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, false);

    container.addEventListener('touchmove', (e) => {
        if (!startX || !startY) return;

        const diffX = startX - e.touches[0].clientX;
        const diffY = startY - e.touches[0].clientY;

        // 如果横向滑动大于纵向滑动，阻止默认行为（防止误触发系统返回）
        if (Math.abs(diffX) > Math.abs(diffY)) {
            e.preventDefault();
        }
    }, { passive: false });

    // 防止预览内容的滚动传递到外层
    previewContent.addEventListener('touchmove', (e) => {
        e.stopPropagation();
    }, { passive: true });
}

// 切换视图
function toggleView() {
    currentViewType = currentViewType === 'list' ? 'tree' : 'list';
    const button = document.getElementById('toggleView');
    button.textContent = currentViewType === 'list' ? '切换到树形视图' : '切换到列表视图';
    refreshFileList();
}

// 刷新文件列表
async function refreshFileList() {
    try {
        const response = await fetch(`${API_BASE}/files?viewType=${currentViewType}`);
        const files = await response.json();
        displayFiles(files);
    } catch (error) {
        console.error('获取文件列表失败:', error);
    }
}

// 显示文件列表
function displayFiles(files) {
    const fileTree = document.getElementById('fileTree');
    if (!files.length) {
        fileTree.innerHTML = '<div class="file-item">没有找到TXT文件</div>';
        return;
    }

    if (currentViewType === 'list') {
        displayFilesList(files, fileTree);
    } else {
        displayFilesTree(files, fileTree);
    }

    // 恢复之前选中的文件
    if (currentFilePath) {
        const selectedItem = fileTree.querySelector(`[data-path="${currentFilePath}"]`);
        if (selectedItem) {
            selectedItem.classList.add('selected');
        }
    }
}

// 列表视图
function displayFilesList(files, container) {
    container.innerHTML = files
        .map(file => `
            <div class="file-item" data-path="${file.path}" onclick="selectFile('${file.path}')">
                ${file.name}
            </div>
        `).join('');
}

// 树形视图
function displayFilesTree(files, container) {
    function buildTree(items) {
        return items.map(item => {
            if (item.type === 'directory') {
                return `
                    <div class="directory-item">
                        <div class="folder-title" onclick="toggleFolder(this)">
                            <span class="folder-icon">▶</span> ${item.name}
                        </div>
                        <div class="folder-content" style="display: none; padding-left: 20px;">
                            ${buildTree(item.children)}
                        </div>
                    </div>
                `;
            } else {
                return `
                    <div class="file-item" data-path="${item.path}" onclick="selectFile('${item.path}')">
                        ${item.name}
                    </div>
                `;
            }
        }).join('');
    }

    container.innerHTML = buildTree(files);
}

// 选择文件
async function selectFile(filePath) {
    currentFilePath = filePath;
    const fileName = filePath.split('/').pop();

    try {
        const response = await fetch(`${API_BASE}/preview/${encodeURIComponent(fileName)}`);
        const data = await response.json();
        
        // 更新预览内容
        const previewElement = document.getElementById('preview');
        previewElement.textContent = data.preview;
        
        // 更新标题
        document.getElementById('previewTitle').textContent = fileName;
        
        // 显示预览窗口
        const previewModal = document.getElementById('previewModal');
        previewModal.style.display = 'block';
        
        // 高亮选中的文件
        document.querySelectorAll('.file-item').forEach(item => {
            item.classList.remove('selected');
            if (item.dataset.path === filePath) {
                item.classList.add('selected');
            }
        });

        // 启用下载按钮
        document.getElementById('download').disabled = false;

        // 禁止背景滚动
        document.body.style.overflow = 'hidden';

        // 滚动预览内容到顶部
        previewElement.scrollTop = 0;
    } catch (error) {
        console.error('获取文件预览失败:', error);
        alert('获取文件预览失败');
    }
}

// 关闭预览
function closePreview() {
    document.getElementById('previewModal').style.display = 'none';
    document.body.style.overflow = '';
}

// 下载当前文件
function downloadCurrentFile() {
    if (!currentFilePath) {
        alert('请先选择一个文件');
        return;
    }
    const fileName = currentFilePath.split('/').pop();
    window.location.href = `${API_BASE}/download/${encodeURIComponent(fileName)}`;
}

// 搜索功能
function handleSearch(event) {
    const searchText = event.target.value.toLowerCase();
    const items = document.querySelectorAll('.file-item');
    
    items.forEach(item => {
        const fileName = item.textContent.trim().toLowerCase();
        item.style.display = fileName.includes(searchText) ? '' : 'none';
    });
}

// 清除搜索
function clearSearch() {
    document.getElementById('searchInput').value = '';
    document.querySelectorAll('.file-item').forEach(item => {
        item.style.display = '';
    });
}

// 切换文件夹展开/折叠
function toggleFolder(element) {
    const content = element.nextElementSibling;
    const icon = element.querySelector('.folder-icon');
    
    if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.style.transform = 'rotate(90deg)';
    } else {
        content.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
    }
}

// 处理滚动
function handleScroll() {
    const scrollBtn = document.getElementById('scrollTopBtn');
    const fileTree = document.getElementById('fileTree');
    
    if (fileTree.scrollTop > 300) {
        scrollBtn.style.display = 'flex';
    } else {
        scrollBtn.style.display = 'none';
    }
}

// 滚动到顶部
function scrollToTop() {
    document.getElementById('fileTree').scrollTo({
        top: 0,
        behavior: 'smooth'
    });
} 
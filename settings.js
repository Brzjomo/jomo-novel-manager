const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    // 监听初始设置
    ipcRenderer.on('init-settings', (event, settings) => {
        updateEditorPath(settings.editor);
        document.getElementById('themeSelect').value = settings.theme;
        document.getElementById('previewLength').value = settings.previewLength;
        // 应用主题
        const themeLink = document.getElementById('theme-style');
        themeLink.href = `styles/${settings.theme}.css`;
    });

    document.getElementById('selectEditor').addEventListener('click', () => {
        ipcRenderer.send('select-editor');
    });

    document.getElementById('resetEditor').addEventListener('click', () => {
        ipcRenderer.send('reset-editor');
    });

    document.getElementById('themeSelect').addEventListener('change', (e) => {
        const theme = e.target.value;
        ipcRenderer.send('change-theme', theme);
    });

    document.getElementById('previewLength').addEventListener('change', (e) => {
        const length = parseInt(e.target.value);
        if (length >= 100 && length <= 10000) {
            ipcRenderer.send('update-settings', { previewLength: length });
        }
    });
});

// 监听编辑器选择结果
ipcRenderer.on('editor-selected', (event, editorPath) => {
    updateEditorPath(editorPath);
});

function updateEditorPath(path) {
    const editorPathDiv = document.getElementById('editorPath');
    editorPathDiv.textContent = path || '未设置（使用系统默认编辑器）';
}

// 监听主题变化
ipcRenderer.on('theme-changed', (event, theme) => {
    const themeLink = document.getElementById('theme-style');
    themeLink.href = `styles/${theme}.css`;
});
// Theme Toggle – Force Dark Theme Only
(function () {
    const STORAGE_KEY = 'hirewise_theme';
    const FORCED_THEME = 'dark'; // Always use dark theme

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(STORAGE_KEY, theme);
    }

    // Apply dark theme immediately to prevent flash
    applyTheme(FORCED_THEME);

    document.addEventListener('DOMContentLoaded', function () {
        var toggle = document.getElementById('theme-toggle');
        if (toggle) {
            // Disable the toggle - dark theme only
            toggle.style.display = 'none';
        }
    });
})();

